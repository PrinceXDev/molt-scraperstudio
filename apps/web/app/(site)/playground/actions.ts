'use server';

import { headers } from 'next/headers';

import { preflightTarget, TARGET_SIZE_LIMIT_BYTES, type PreflightReport } from '@molt/brightdata';
import { diagnose, HEAL_PROMPT_MAX_CHARS } from '@molt/diagnose';
import { buildSnapshot, compareSnapshots, type HealthReport, type Row } from '@molt/health';

import { createGuardedFetch, UnsafeUrlError } from '@/lib/guarded-fetch';
import { isCreateEnabled, isLiveCheckEnabled } from '@/lib/playground-config';
import { createLimiter, liveCheckLimiter, preflightLimiter } from '@/lib/rate-limit';
import { getRegisteredCollector } from '@/lib/registered-collector';
import { checkUrl, REJECTION_REASON } from '@/lib/url-guard';

/**
 * The playground's four server actions.
 *
 * All four return a discriminated result rather than throwing. A thrown Server
 * Action error reaches the client as an opaque digest in production — useless
 * for "your URL was refused because it is a private address", which is exactly
 * the kind of message this page exists to give. Failures are values here.
 */

/* ------------------------------------------------------------------ shared */

export interface ActionFailure {
  readonly ok: false;
  readonly message: string;
  /** Set when the failure is a rate limit, so the UI can say how long to wait. */
  readonly retryAfterSeconds?: number;
}

type ActionResult<T> = ({ readonly ok: true } & T) | ActionFailure;

function fail(message: string, retryAfterSeconds?: number): ActionFailure {
  return retryAfterSeconds === undefined
    ? { ok: false, message }
    : { ok: false, message, retryAfterSeconds };
}

/**
 * A rate-limit key for the caller.
 *
 * `x-forwarded-for`'s first entry is the client as the closest trusted proxy saw
 * it. This is spoofable if the app is ever run without a proxy in front of it,
 * which is an accepted limitation for a brake rather than a security control
 * (see `lib/rate-limit.ts`). Everything unattributable shares one bucket, so an
 * absent header cannot be used to get an unlimited one.
 */
async function callerKey(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first !== undefined && first !== '' ? first : 'unattributed';
}

/* ------------------------------------------------------------------ 1. preflight */

export interface PreflightSuccess {
  readonly report: PreflightReport;
  readonly sizeLimitBytes: number;
}

/**
 * Measure whether a URL is a viable collector target.
 *
 * Runs the real `preflightTarget` from `@molt/brightdata` — the same function
 * `molt add` runs before spending a `create` call — through a guarded fetch that
 * validates every redirect hop, caps the body, and times out. No credits, no
 * Bright Data account, about a second.
 */
export async function runPreflight(rawUrl: string): Promise<ActionResult<PreflightSuccess>> {
  const url = rawUrl.trim();
  if (url === '') return fail('Enter a URL to preflight.');

  // Checked here as well as inside the guarded fetch so an obviously-bad URL
  // gets its specific explanation without a network round trip first.
  const rejection = checkUrl(url);
  if (rejection !== null) return fail(REJECTION_REASON[rejection]);

  const limit = preflightLimiter.check(await callerKey());
  if (!limit.allowed) {
    return fail(
      `Rate limit reached. This tab makes real outbound requests, so it is capped.`,
      limit.retryAfterSeconds,
    );
  }

  try {
    const report = await preflightTarget(url, { fetchImpl: createGuardedFetch() });
    return { ok: true, report, sizeLimitBytes: TARGET_SIZE_LIMIT_BYTES };
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      // Almost always a redirect that walked somewhere it should not have — the
      // case a naive up-front-only guard would have missed entirely.
      return fail(`${error.message} (blocked at ${error.url})`);
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return fail('That target did not respond in time.');
    }
    return fail(error instanceof Error ? error.message : 'The preflight failed.');
  }
}

/* ------------------------------------------------------------------ 2. replay */

export interface ReplaySuccess {
  readonly report: HealthReport;
  readonly prompt: string | null;
  readonly promptChars: number;
  readonly promptMaxChars: number;
  readonly promptTruncated: boolean;
  readonly baselineRows: number;
  readonly currentRows: number;
}

/** Payload ceilings. Generous for hand-pasted data, bounded against a paste-bomb. */
const MAX_PAYLOAD_CHARS = 200_000;
const MAX_ROWS = 2_000;

function parseRows(label: string, raw: string): readonly Row[] | string {
  const text = raw.trim();
  if (text === '') return `The ${label} rows are empty.`;
  if (text.length > MAX_PAYLOAD_CHARS) {
    return `The ${label} payload is larger than this page accepts (${String(MAX_PAYLOAD_CHARS)} characters).`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return `The ${label} rows are not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`;
  }

  if (!Array.isArray(parsed)) return `The ${label} rows must be a JSON array of objects.`;
  if (parsed.length > MAX_ROWS) {
    return `The ${label} rows exceed ${String(MAX_ROWS)} entries.`;
  }

  const rows = parsed.filter(
    (row): row is Row => row !== null && typeof row === 'object' && !Array.isArray(row),
  );
  if (rows.length !== parsed.length) {
    return `Every entry in the ${label} rows must be an object.`;
  }

  return rows;
}

/**
 * Replay drift detection over two hand-supplied row sets.
 *
 * This runs the genuine detection core — `buildSnapshot` twice, then
 * `compareSnapshots`, then `diagnose` — with no network, no database and no
 * credits. `packages/health` is pure by design (it takes its timestamps as
 * arguments precisely so callers like this one can exist), which is what makes
 * the product's central claim demonstrable in a browser rather than only
 * assertable in prose.
 *
 * An empty current set is a legitimate input, not an error: it is how an empty
 * harvest is expressed, and the report has a dedicated flag for it.
 */
export async function runReplay(
  baselineJson: string,
  currentJson: string,
): Promise<ActionResult<ReplaySuccess>> {
  const baselineRows = parseRows('baseline', baselineJson);
  if (typeof baselineRows === 'string') return fail(baselineRows);

  const currentText = currentJson.trim();
  // `[]` has to be spelled out; a blank textarea is a mistake, not a harvest.
  const currentRows = currentText === '[]' ? [] : parseRows('current', currentJson);
  if (typeof currentRows === 'string') return fail(currentRows);

  if (baselineRows.length === 0) {
    return fail('The baseline needs at least one row to compare against.');
  }

  // Fixed timestamps. The report carries them, and a wall clock here would make
  // the same input produce a different output every run — which would undercut
  // the determinism this tab is demonstrating.
  const baseline = buildSnapshot({
    collectorId: 'c_playground',
    capturedAt: '2026-01-01T00:00:00.000Z',
    rows: baselineRows,
  });
  const candidate = buildSnapshot({
    collectorId: 'c_playground',
    capturedAt: '2026-01-02T00:00:00.000Z',
    rows: currentRows,
    // Declared from the baseline's own fields, so a field that disappears from
    // the output entirely is scored as `vanished` rather than silently ignored.
    declaredFields: baseline.fields.map((field) => field.field),
  });

  const report = compareSnapshots(baseline, candidate);

  // A heal prompt only means anything when there is a fault to describe.
  const diagnosis = report.faults.length > 0 ? diagnose(report) : null;

  return {
    ok: true,
    report,
    prompt: diagnosis?.prompt ?? null,
    promptChars: diagnosis?.charCount ?? 0,
    promptMaxChars: HEAL_PROMPT_MAX_CHARS,
    promptTruncated: diagnosis?.truncated ?? false,
    baselineRows: baselineRows.length,
    currentRows: currentRows.length,
  };
}

/* ------------------------------------------------------------------ 3. live check */

export interface LiveCheckSuccess {
  readonly collectorId: string;
  readonly rowCount: number;
  readonly baselineEstablished: boolean;
  readonly report: HealthReport | null;
  readonly incidentId: string | null;
  readonly incidentState: string | null;
  readonly command: string | null;
  readonly durationMs: number | null;
}

/**
 * Run a real `molt check` against whichever collector is registered as
 * `kind: 'chaos'` in the database — resolved fresh on every call via
 * `getRegisteredCollector`, never a copied-in id. See that function's comment
 * for the bug this replaced: a hardcoded `LIVE_COLLECTOR_ID` that could
 * silently drift from whatever `.env`'s `MOLT_COLLECTOR_CHAOS` and `molt init`
 * had actually registered.
 *
 * Off unless `MOLT_PLAYGROUND_LIVE=1`. When on, it spawns the actual Bright Data
 * CLI through the same `Engine` the cockpit and `molt check` use — so this
 * spends credits and takes tens of seconds. The rate limit is deliberately
 * severe, and the disabled state is a documented explanation rather than a dead
 * button, because "why can't I click this" is a worse experience than "here is
 * why this is off".
 */
export async function runLiveCheck(): Promise<ActionResult<LiveCheckSuccess>> {
  if (!isLiveCheckEnabled()) {
    return fail(
      'Live checks are disabled on this deployment. Set MOLT_PLAYGROUND_LIVE=1 to enable them.',
    );
  }

  const limit = liveCheckLimiter.check(await callerKey());
  if (!limit.allowed) {
    return fail(
      'Rate limit reached. Live checks spend credits, so they are capped.',
      limit.retryAfterSeconds,
    );
  }

  const chaos = await getRegisteredCollector('chaos');
  if (chaos === null) {
    return fail(
      'No chaos collector is registered in this deployment’s database. ' +
        'Set MOLT_COLLECTOR_CHAOS in .env and run `molt init` first.',
    );
  }

  try {
    // Imported lazily: `lib/context.ts` opens a libSQL connection and constructs
    // a `CliScraper` at module scope. Pulling that in at the top of this file
    // would make every preflight and replay request pay for a database
    // connection neither of them touches. `getRegisteredCollector` above also
    // calls `getContext()` internally, but that promise is memoised — this is
    // the same cached context, not a second connection.
    const { getContext } = await import('@/lib/context');
    const { engine, repo } = await getContext();

    const result = await engine.check(chaos.id);
    const [command] = await repo.listRecentCommands(1);

    return {
      ok: true,
      collectorId: result.collectorId,
      rowCount: result.rowCount,
      baselineEstablished: result.baselineEstablished,
      report: result.report,
      incidentId: result.incident?.id ?? null,
      incidentState: result.incident?.state ?? null,
      command: command?.display ?? null,
      durationMs: command?.durationMs ?? null,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'The live check failed.');
  }
}

/* ------------------------------------------------------------------ 4. create */

/** Mirrors `CREATE_DESCRIPTION_MAX_CHARS` from `@molt/core` — re-declared as a plain
 * number so this file does not have to import `@molt/core` just for a constant
 * whose value is pinned by a verified constraint in `CLAUDE.md` and is not going
 * to move independently of it. */
const DESCRIPTION_MAX_CHARS = 500;

export interface CreateSuccess {
  readonly collectorId: string;
  readonly name: string;
  readonly viewUrl: string | null;
  readonly completedSteps: readonly string[];
  readonly command: string;
  readonly durationMs: number;
  /** Present once the post-create baseline check has run. */
  readonly baseline: {
    readonly rowCount: number;
    readonly established: boolean;
  } | null;
}

/**
 * Generate a brand-new collector from a URL and a plain-language description —
 * the same thing `molt add` does at a maintainer's terminal, offered here to any
 * visitor, with every safeguard that difference demands.
 *
 * Off unless `MOLT_PLAYGROUND_CREATE=1` (`lib/playground-config.ts` has the full
 * reasoning). When on:
 *
 * 1. The description is capped at the CLI's own 500-character limit.
 * 2. The URL runs through the identical guarded preflight the "Preflight a URL"
 *    tab uses — same SSRF-safe fetch, same size/robots/link checks.
 * 3. **Any blocker refuses the request outright.** `molt add --force` exists for
 *    a maintainer who has read the blocker and decided to proceed anyway; a
 *    public page has no one in that role, so there is no equivalent here.
 * 4. Exactly one attempt per caller per hour (`createLimiter`).
 * 5. On success, the same baseline `check` `molt add` runs afterward, so a
 *    collector this creates is immediately being monitored, not left half-set-up.
 *
 * A failure is reported with whatever `collector_id` the envelope carried, in
 * plain terms — that id may now be an orphan needing manual deletion in the
 * Bright Data dashboard, and hiding it would only make that harder to act on.
 */
export async function runCreateCollector(
  rawUrl: string,
  rawDescription: string,
): Promise<ActionResult<CreateSuccess>> {
  if (!isCreateEnabled()) {
    return fail(
      'Creating collectors is disabled on this deployment. Set MOLT_PLAYGROUND_CREATE=1 to enable it.',
    );
  }

  const url = rawUrl.trim();
  const description = rawDescription.trim();

  if (url === '') return fail('Enter a URL to build a collector for.');
  if (description === '') return fail('Describe what to extract from the page.');
  if (description.length > DESCRIPTION_MAX_CHARS) {
    return fail(
      `The description is ${String(description.length)} characters; the CLI caps it at ${String(DESCRIPTION_MAX_CHARS)}.`,
    );
  }

  const rejection = checkUrl(url);
  if (rejection !== null) return fail(REJECTION_REASON[rejection]);

  const limit = createLimiter.check(await callerKey());
  if (!limit.allowed) {
    return fail(
      'Rate limit reached. Creating a collector spends a real AI-Flow job and can orphan a resource on failure, so this is capped hard.',
      limit.retryAfterSeconds,
    );
  }

  let preflight: PreflightReport;
  try {
    preflight = await preflightTarget(url, { fetchImpl: createGuardedFetch() });
  } catch (error) {
    if (error instanceof UnsafeUrlError) return fail(`${error.message} (blocked at ${error.url})`);
    if (error instanceof Error && error.name === 'TimeoutError') {
      return fail('That target did not respond in time.');
    }
    return fail(error instanceof Error ? error.message : 'The preflight failed.');
  }

  if (preflight.blockers.length > 0) {
    return fail(
      `This target failed preflight, so no collector was generated: ${preflight.blockers.join('; ')}`,
    );
  }

  try {
    // Imported lazily — see the identical comment on `runLiveCheck` above.
    const { getContext } = await import('@/lib/context');
    const { engine } = await getContext();

    const result = await engine.createCollector({ url, description });

    if (result.collector === null) {
      const orphanId = result.envelope.collector_id;
      return fail(
        `Generation failed: ${result.envelope.error ?? result.envelope.status}. ` +
          `Collector ${orphanId} was not registered and may need manual deletion in the Bright Data dashboard.`,
      );
    }

    const baseline = await engine.check(result.collector.id);

    return {
      ok: true,
      collectorId: result.collector.id,
      name: result.collector.name,
      viewUrl: result.envelope.view_url ?? null,
      completedSteps: result.envelope.completed_steps ?? [],
      command: result.command.display,
      durationMs: result.command.durationMs,
      baseline: { rowCount: baseline.rowCount, established: baseline.baselineEstablished },
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Collector generation failed.');
  }
}
