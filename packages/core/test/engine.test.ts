import type { CommandRecord, UnknownRecord } from '@molt/brightdata';
import { openDatabase, Repository, type Database } from '@molt/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Engine } from '../src/engine.js';
import {
  tickingClock,
  type ApproveOutcome,
  type CreateOutcome,
  type HealOutcome,
  type RunOutcome,
  type ScraperPort,
} from '../src/ports.js';

/**
 * The whole incident lifecycle, offline.
 *
 * A fake {@link ScraperPort} stands in for the `bdata` CLI, so the approval gate,
 * a rejected fix, a failed heal, and — most importantly — an approved fix that
 * did not actually work are all exercised without an API key, a network call or
 * a single credit spent.
 */

const COLLECTOR = 'c_mt0zo92haylntlolg';
const URL = 'https://molt-chaos.vercel.app';
const CANARY_URL = 'https://molt-chaos.vercel.app/canary';

/** Rows shaped like the chaos collector's real output. */
function healthyRows(count = 20): UnknownRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    changelog_entries: [
      {
        title: `A perfectly ordinary release note number ${i}`,
        version: `v1.${100 - i}.0`,
        category: 'service',
        download_count: 24_000 + i,
        comment_count: 3 + i,
      },
    ],
  }));
}

/** The v2 breakage: rows still arrive, two numeric fields come back null. */
function brokenRows(count = 20): UnknownRecord[] {
  return healthyRows(count).map((row) => ({
    changelog_entries: (row['changelog_entries'] as UnknownRecord[]).map((entry) => ({
      ...entry,
      download_count: null,
      comment_count: null,
    })),
  }));
}

function command(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    argv: ['node', 'bdata', 'scraper', 'run'],
    display: 'bdata scraper run c_mt0zo92haylntlolg https://molt-chaos.vercel.app --json',
    startedAt: '2026-08-21T03:00:00.000Z',
    finishedAt: '2026-08-21T03:00:04.000Z',
    durationMs: 4000,
    exitCode: 0,
    stdout: '[]',
    stderr: '',
    failed: false,
    timedOut: false,
    ...overrides,
  };
}

interface FakeConfig {
  /** Consumed one per `run` call; the last entry repeats once exhausted. */
  readonly runs: UnknownRecord[][];
  readonly healMode?: 'gate' | 'done' | 'fail' | 'blocked';
  readonly approveFails?: boolean;
  /** Rows the held-out canary URL returns. Defaults to healthy rows. */
  readonly canaryRows?: UnknownRecord[];
  readonly createFails?: boolean;
  /**
   * Zero-indexed `run` call numbers (against the primary target only) that
   * should come back as a failed command — a crash or timeout, not an empty
   * harvest. Simulates the real batch-mode timeout that motivated this test.
   */
  readonly runFailsAt?: readonly number[];
}

class FakeScraper implements ScraperPort {
  readonly calls: string[] = [];
  private runIndex = 0;

  constructor(private readonly config: FakeConfig) {}

  async run(request: { url: string }): Promise<RunOutcome> {
    if (request.url === CANARY_URL) {
      this.calls.push('run:canary');
      return { rows: this.config.canaryRows ?? healthyRows(5), command: command(), ok: true };
    }

    this.calls.push('run');

    const index = this.runIndex;
    this.runIndex += 1;

    if (this.config.runFailsAt?.includes(index) === true) {
      // A real failure: the CLI process died or timed out. `rows` mirrors
      // what a truncated `stdout` would parse to — empty — same as a genuine
      // empty harvest, which is exactly why `ok: false` has to be load-bearing.
      return {
        rows: [],
        command: command({ exitCode: 1, failed: true, stderr: 'timed out in batch mode' }),
        ok: false,
      };
    }

    const { runs } = this.config;
    const rows = runs[Math.min(index, runs.length - 1)] ?? [];

    return { rows, command: command(), ok: true };
  }

  async heal(request: { prompt: string }): Promise<HealOutcome> {
    this.calls.push('heal');

    const mode = this.config.healMode ?? 'gate';

    if (mode === 'fail') {
      return {
        envelope: { collector_id: COLLECTOR, status: 'failed', error: 'AI generation failed' },
        command: command({ exitCode: 1, failed: true, stderr: 'AI generation failed' }),
        previewRows: [],
      };
    }

    if (mode === 'blocked') {
      // The real 409: one refactor job per collector.
      return {
        envelope: { collector_id: COLLECTOR, status: 'heal_trigger_failed' },
        command: command({
          exitCode: 1,
          failed: true,
          stderr:
            'Failed to start self-healing for collector c_x: Error: Another refactor job is still in progress\n  Status: 409',
        }),
        previewRows: [],
      };
    }

    // Assert the engine passed a real generated prompt rather than a placeholder.
    expect(request.prompt.length).toBeGreaterThan(40);
    expect(request.prompt).toContain('Re-capture');

    return {
      envelope: {
        collector_id: COLLECTOR,
        status: mode === 'gate' ? 'awaiting_approval' : 'done',
        prompt: request.prompt,
        preview_result: mode === 'gate' ? healthyRows(3) : undefined,
      },
      command: command({ display: 'bdata scraper heal c_mt0zo92haylntlolg "…" --json' }),
      previewRows: mode === 'gate' ? healthyRows(3) : [],
    };
  }

  async create(request: { url: string; description: string }): Promise<CreateOutcome> {
    this.calls.push('create');

    if (this.config.createFails === true) {
      // The observed failure shape: a collector id exists even though
      // generation failed, because the template is created first.
      return {
        envelope: {
          collector_id: 'c_orphaned01',
          status: 'failed',
          completed_steps: ['prepare_intent_analyzer'],
          error: 'AI generation finished with status "failed".',
        },
        command: command({
          display: `bdata scraper create ${request.url} "…" --json`,
          exitCode: 1,
          failed: true,
        }),
      };
    }

    return {
      envelope: { collector_id: 'c_generated01', status: 'done', name: 'generated' },
      command: command({ display: `bdata scraper create ${request.url} "…" --json` }),
    };
  }

  async approve(request: { reject?: boolean }): Promise<ApproveOutcome> {
    this.calls.push(request.reject === true ? 'reject' : 'approve');

    if (this.config.approveFails === true) {
      return {
        envelope: { collector_id: COLLECTOR, status: 'failed', error: 'resume failed' },
        command: command({
          display: `bdata scraper ${request.reject === true ? 'reject' : 'approve'} ${COLLECTOR} --json`,
          exitCode: 1,
          failed: true,
          stderr: 'resume failed',
        }),
      };
    }

    return {
      envelope: { collector_id: COLLECTOR, status: 'done' },
      command: command({ display: 'bdata scraper approve c_mt0zo92haylntlolg --json' }),
    };
  }
}

let db: Database;
let repo: Repository;

async function setup(config: FakeConfig, maxAttempts = 2) {
  const scraper = new FakeScraper(config);
  const engine = new Engine({
    repo,
    scraper,
    clock: tickingClock('2026-08-21T03:00:00.000Z'),
    maxAttempts,
  });
  return { scraper, engine };
}

beforeEach(async () => {
  db = await openDatabase({ url: ':memory:' });
  repo = new Repository(db);

  await repo.saveCollector({
    id: COLLECTOR,
    name: 'molt-chaos',
    targetUrl: URL,
    kind: 'chaos',
    recordPath: 'changelog_entries',
    inherit: [],
    createdAt: '2026-08-20T00:00:00.000Z',
  });
});

afterEach(() => {
  db.close();
});

describe('detection', () => {
  it('treats the first run as the baseline and returns no verdict', async () => {
    const { engine } = await setup({ runs: [healthyRows()] });

    const first = await engine.check(COLLECTOR);

    expect(first.baselineEstablished).toBe(true);
    expect(first.report).toBeNull();
    expect(first.incident).toBeNull();
    // Projection unwrapped the nested arrays: 20 wrappers, one entry each.
    expect(first.rowCount).toBe(20);
  });

  it('does not establish a baseline from a run that failed to execute', async () => {
    const { engine } = await setup({ runs: [healthyRows()], runFailsAt: [0] });

    const first = await engine.check(COLLECTOR);

    expect(first.ok).toBe(false);
    expect(first.baselineEstablished).toBe(false);
    expect(first.snapshotId).toBeNull();
    expect(first.report).toBeNull();
    // The bug this guards: a failed run must never be recorded as though it
    // were a genuine empty harvest, or every real run after it would be
    // compared against a baseline that was never actually taken.
    expect(await repo.getBaseline(COLLECTOR)).toBeNull();

    // The next, successful run establishes the baseline correctly.
    const second = await engine.check(COLLECTOR);
    expect(second.ok).toBe(true);
    expect(second.baselineEstablished).toBe(true);
    expect(second.rowCount).toBe(20);
    expect(await repo.getBaseline(COLLECTOR)).not.toBeNull();
  });

  it('opens no incident while the collector is healthy', async () => {
    const { engine } = await setup({ runs: [healthyRows(), healthyRows()] });

    await engine.check(COLLECTOR);
    const second = await engine.check(COLLECTOR);

    expect(second.report?.status).toBe('healthy');
    expect(second.incident).toBeNull();
    expect(await repo.getOpenIncident(COLLECTOR)).toBeNull();
  });

  it('opens an incident when fields die but rows keep arriving', async () => {
    const { engine } = await setup({ runs: [healthyRows(), brokenRows()] });

    await engine.check(COLLECTOR);
    const second = await engine.check(COLLECTOR);

    expect(second.report?.status).toBe('broken');
    // The signature of the failure: nothing about the transport looks wrong.
    expect(second.report?.candidateRowCount).toBe(20);
    expect(second.report?.emptyHarvest).toBe(false);
    expect(second.incident?.state).toBe('detected');
    expect(second.report?.summary).toContain('comment_count');
    expect(second.report?.summary).toContain('download_count');
  });

  it('does not open a second incident for the same breakage', async () => {
    const { engine } = await setup({ runs: [healthyRows(), brokenRows(), brokenRows()] });

    await engine.check(COLLECTOR);
    const first = await engine.check(COLLECTOR);
    const second = await engine.check(COLLECTOR);

    expect(second.incident?.id).toBe(first.incident?.id);
    expect(await repo.listIncidents()).toHaveLength(1);
  });

  it('closes the incident if the site comes good on its own', async () => {
    const { engine } = await setup({ runs: [healthyRows(), brokenRows(), healthyRows()] });

    await engine.check(COLLECTOR);
    const broken = await engine.check(COLLECTOR);
    const recovered = await engine.check(COLLECTOR);

    expect(recovered.incident?.id).toBe(broken.incident?.id);
    expect(recovered.incident?.state).toBe('resolved');
    expect(recovered.incident?.closedAt).not.toBeNull();
  });

  it('records the run as a command, linked to the run row', async () => {
    const { engine } = await setup({ runs: [healthyRows()] });

    const result = await engine.check(COLLECTOR);

    const run = await repo.getRun(result.runId);
    expect(run?.commandId).not.toBeNull();

    const commands = await repo.listRecentCommands();
    expect(commands[0]?.display).toContain('bdata scraper run');
  });
});

describe('the full loop, through the approval gate', () => {
  it('walks detected → resolved and promotes the recovered baseline', async () => {
    // Broken twice (detect, then still-broken during nothing), then healthy for
    // the verify run.
    const { scraper, engine } = await setup({
      runs: [healthyRows(), brokenRows(), healthyRows()],
    });

    await engine.check(COLLECTOR);
    const detected = await engine.check(COLLECTOR);
    const incidentId = detected.incident?.id ?? '';
    expect(incidentId).not.toBe('');

    // Diagnose.
    const afterDiagnose = await engine.advance(incidentId);
    expect(afterDiagnose.performed).toBe('diagnose.start');
    expect(afterDiagnose.incident.state).toBe('diagnosing');
    expect(afterDiagnose.incident.healPrompt).toContain('Re-capture');
    expect(afterDiagnose.incident.healPrompt).toContain('unaffected');

    // Heal, which stops at the gate.
    const afterHeal = await engine.advance(incidentId);
    expect(afterHeal.performed).toBe('heal.start');
    expect(afterHeal.incident.state).toBe('awaiting_approval');
    expect(afterHeal.incident.attempts).toBe(1);
    expect(afterHeal.incident.previewResult).not.toBeNull();

    // And stops. This is the product, not an obstacle.
    const atGate = await engine.advance(incidentId);
    expect(atGate.performed).toBeNull();
    expect(atGate.note).toContain('awaiting a human decision');

    // A person approves.
    const approved = await engine.decide(incidentId, 'approve');
    expect(approved.state).toBe('approved');

    // Verify, which finds the data restored.
    const verified = await engine.advance(incidentId);
    expect(verified.performed).toBe('verify.start');
    expect(verified.incident.state).toBe('resolved');
    expect(verified.incident.closedAt).not.toBeNull();
    expect(verified.incident.verifiedRunId).not.toBeNull();

    // The recovered snapshot is now the reference, so later runs are not
    // compared against a pre-breakage world forever.
    const baseline = await repo.getBaseline(COLLECTOR);
    expect(baseline?.isBaseline).toBe(true);
    expect(baseline?.capturedAt).toBe(verified.incident.report.candidateCapturedAt);

    expect(scraper.calls).toEqual(['run', 'run', 'heal', 'approve', 'run']);
  });

  it('records a legible timeline', async () => {
    const { engine } = await setup({ runs: [healthyRows(), brokenRows(), healthyRows()] });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    await engine.advanceUntilBlocked(incidentId);

    const kinds = (await repo.listEvents(incidentId)).map((e) => e.kind);

    expect(kinds).toEqual([
      'detected',
      'diagnose.start',
      'diagnosed',
      'heal.start',
      'heal.gate',
      'approve.accepted',
      'verify.start',
      'observed.healthy',
      'verify.recovered',
    ]);
  });

  it('records the cost of silence on the resolving event', async () => {
    // Two still-broken observations before the fix lands: the baseline check,
    // detected, one unattended re-check while nothing was attempted, then the
    // recovery. "Bad runs" should count the checks that actually observed the
    // breakage, not every check ever made.
    const { engine } = await setup({
      runs: [healthyRows(), brokenRows(), brokenRows(), healthyRows()],
    });

    await engine.check(COLLECTOR); // baseline
    await engine.check(COLLECTOR); // detected
    await engine.check(COLLECTOR); // observed.still-broken
    const incidentId = (await repo.getOpenIncident(COLLECTOR))?.id ?? '';

    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    await engine.advanceUntilBlocked(incidentId);

    const events = await repo.listEvents(incidentId);
    const resolvedEvent = events.find((e) => e.kind === 'verify.recovered');

    expect(resolvedEvent?.detail).toContain('data was wrong for');
    // detected + one observed.still-broken = 2 bad runs.
    expect(resolvedEvent?.detail).toContain('2 runs');
  });

  it('stops the unattended walk at the gate rather than approving itself', async () => {
    const { engine } = await setup({ runs: [healthyRows(), brokenRows()] });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    const parked = await engine.advanceUntilBlocked(incidentId);

    expect(parked.state).toBe('awaiting_approval');
    expect(parked.closedAt).toBeNull();
  });
});

describe('an approved fix that did not work', () => {
  it('reopens instead of closing, then escalates when attempts run out', async () => {
    // Every run after the baseline stays broken, so no heal can ever succeed.
    const { engine } = await setup({ runs: [healthyRows(), brokenRows()] }, 2);

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    // Attempt 1.
    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    const afterFirstVerify = await engine.advance(incidentId);

    // Approval was not success. The data is still wrong, so it reopens.
    expect(afterFirstVerify.incident.state).toBe('detected');
    expect(afterFirstVerify.incident.closedAt).toBeNull();

    // Attempt 2.
    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    const afterSecondVerify = await engine.advance(incidentId);

    expect(afterSecondVerify.incident.state).toBe('escalated');
    expect(afterSecondVerify.incident.closedAt).not.toBeNull();
    expect(afterSecondVerify.incident.attempts).toBe(2);
  });
});

describe('rejection', () => {
  it('returns the incident to the diagnosable set', async () => {
    const { scraper, engine } = await setup({ runs: [healthyRows(), brokenRows()] });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';
    await engine.advanceUntilBlocked(incidentId);

    const rejected = await engine.decide(incidentId, 'reject');

    expect(rejected.state).toBe('rejected');
    expect(rejected.closedAt).toBeNull();
    expect(scraper.calls).toContain('reject');

    // And it can be diagnosed again.
    const retried = await engine.advance(incidentId);
    expect(retried.incident.state).toBe('diagnosing');
  });

  it('refuses to decide on an incident that is not at the gate', async () => {
    const { engine } = await setup({ runs: [healthyRows(), brokenRows()] });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await expect(engine.decide(incidentId, 'approve')).rejects.toThrow('not awaiting approval');
  });
});

describe('a transport failure on approve or reject', () => {
  // Real bug, real cause: when the `bdata scraper approve` call itself failed
  // (a crash, a network error, the CLI not resolving under a bundler — see
  // `resolveCliEntry`), the engine responded with the `heal.failed` trigger.
  // That trigger is only legal from `healing`, not `awaiting_approval`, so the
  // transition machine correctly refused it and logged
  // `refused.heal.failed` — and the incident was left silently stuck at the
  // gate with no indication anything had gone wrong. First caught when the web
  // UI's Approve button produced no visible effect at all.
  it('throws rather than silently leaving the incident stuck', async () => {
    const { engine } = await setup({
      runs: [healthyRows(), brokenRows()],
      healMode: 'gate',
      approveFails: true,
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';
    await engine.advanceUntilBlocked(incidentId);

    await expect(engine.decide(incidentId, 'approve')).rejects.toThrow(
      'bdata scraper approve failed',
    );
  });

  it('leaves the incident retryable at the gate rather than corrupting its state', async () => {
    const { engine } = await setup({
      runs: [healthyRows(), brokenRows()],
      healMode: 'gate',
      approveFails: true,
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';
    await engine.advanceUntilBlocked(incidentId);

    await expect(engine.decide(incidentId, 'approve')).rejects.toThrow();

    const incident = await repo.getIncident(incidentId);
    expect(incident?.state).toBe('awaiting_approval');
    expect(incident?.closedAt).toBeNull();
  });

  it('still records the failed command for the transcript', async () => {
    const { engine } = await setup({
      runs: [healthyRows(), brokenRows()],
      healMode: 'gate',
      approveFails: true,
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';
    await engine.advanceUntilBlocked(incidentId);

    await expect(engine.decide(incidentId, 'approve')).rejects.toThrow();

    const [command] = await repo.listRecentCommands(1);
    expect(command?.display).toContain('scraper approve');
    expect(command?.failed).toBe(true);
  });
});

describe('a failing heal call', () => {
  it('is recorded as heal_failed and stays retryable', async () => {
    const { engine } = await setup({ runs: [healthyRows(), brokenRows()], healMode: 'fail' });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await engine.advance(incidentId); // diagnose
    const failed = await engine.advance(incidentId); // heal

    expect(failed.incident.state).toBe('heal_failed');
    expect(failed.incident.attempts).toBe(1);
    expect(failed.incident.closedAt).toBeNull();

    const commands = await repo.listCommandsForIncident(incidentId);
    expect(commands.some((c) => c.failed)).toBe(true);
  });
});

describe('a heal blocked by another pending heal', () => {
  it('escalates without spending the retry budget', async () => {
    // Observed for real: a 409 arrived in 1.7 seconds, and because it was treated
    // as an ordinary failure it burned both attempts almost instantly and
    // escalated for entirely the wrong reason.
    const { engine } = await setup({ runs: [healthyRows(), brokenRows()], healMode: 'blocked' });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await engine.advance(incidentId); // diagnose
    const blocked = await engine.advance(incidentId); // heal → 409

    expect(blocked.incident.state).toBe('escalated');
    expect(blocked.incident.closedAt).not.toBeNull();
    // heal.start spent one, heal.blocked refunded it.
    expect(blocked.incident.attempts).toBe(0);

    const kinds = (await repo.listEvents(incidentId)).map((e) => e.kind);
    expect(kinds).toContain('heal.blocked');
    expect(kinds).not.toContain('heal.failed');
  });

  it('does not keep retrying a condition retrying cannot fix', async () => {
    const { scraper, engine } = await setup(
      { runs: [healthyRows(), brokenRows()], healMode: 'blocked' },
      2,
    );

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await engine.advanceUntilBlocked(incidentId);

    expect(scraper.calls.filter((c) => c === 'heal')).toHaveLength(1);
  });
});

describe('unblocking a collector', () => {
  it('rejects the pending heal so a later one can start', async () => {
    const { scraper, engine } = await setup({ runs: [healthyRows()] });

    const command = await engine.unblock(COLLECTOR);

    expect(scraper.calls).toContain('reject');
    expect(command.failed).toBe(false);

    // Recorded in the transcript like any other command.
    const commands = await repo.listRecentCommands();
    expect(commands[0]?.display).toContain('approve');
  });
});

describe('an auto-approved heal', () => {
  it('skips the gate and still has to pass verification', async () => {
    const { engine } = await setup({
      runs: [healthyRows(), brokenRows(), healthyRows()],
      healMode: 'done',
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    const resolved = await engine.advanceUntilBlocked(incidentId);

    expect(resolved.state).toBe('resolved');
    expect(resolved.closedAt).not.toBeNull();
  });
});

describe('canary verification', () => {
  /** Re-register the collector with a held-out canary URL. */
  async function withCanary(): Promise<void> {
    await repo.saveCollector({
      id: COLLECTOR,
      name: 'molt-chaos',
      targetUrl: URL,
      kind: 'chaos',
      recordPath: 'changelog_entries',
      inherit: [],
      canaryUrl: CANARY_URL,
      createdAt: '2026-08-20T00:00:00.000Z',
    });
  }

  it('closes the incident only after the fix also works on the canary', async () => {
    await withCanary();
    const { scraper, engine } = await setup({
      runs: [healthyRows(), brokenRows(), healthyRows()],
      canaryRows: healthyRows(5),
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    const verified = await engine.advanceUntilBlocked(incidentId);

    expect(verified.state).toBe('resolved');
    // The canary run happened, against the held-out URL.
    expect(scraper.calls).toContain('run:canary');

    const events = await repo.listEvents(incidentId);
    const canaryEvent = events.find((e) => e.kind === 'verify.canary');
    expect(canaryEvent?.detail).toContain('recovers on');
  });

  it('refuses to close when the fix overfits the primary page', async () => {
    await withCanary();
    // Primary target recovers after the heal, but the canary page still shows
    // the broken extraction — the signature of an overfitted fix.
    const { engine } = await setup({
      runs: [healthyRows(), brokenRows(), healthyRows()],
      canaryRows: brokenRows(5),
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    const verified = await engine.advance(incidentId);

    // verify.failed, not resolved: the incident reopens for another attempt.
    expect(verified.incident.state).toBe('detected');
    expect(verified.incident.closedAt).toBeNull();

    const events = await repo.listEvents(incidentId);
    const failed = events.find((e) => e.kind === 'verify.failed');
    expect(failed?.detail).toContain('canary');
  });

  it('treats an empty canary harvest as a failure, not a pass', async () => {
    await withCanary();
    const { engine } = await setup({
      runs: [healthyRows(), brokenRows(), healthyRows()],
      canaryRows: [],
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    const verified = await engine.advance(incidentId);

    expect(verified.incident.state).not.toBe('resolved');

    const events = await repo.listEvents(incidentId);
    expect(events.find((e) => e.kind === 'verify.canary')?.detail).toContain('0 rows');
  });

  it('does not pollute the collector history with canary snapshots', async () => {
    await withCanary();
    const { engine } = await setup({
      runs: [healthyRows(), brokenRows(), healthyRows()],
      canaryRows: healthyRows(5),
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';
    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    await engine.advanceUntilBlocked(incidentId);

    // baseline + broken + verify — the canary run must not appear here.
    const snapshots = await repo.listSnapshots(COLLECTOR);
    expect(snapshots).toHaveLength(3);
  });

  it('skips the canary entirely when none is configured', async () => {
    const { scraper, engine } = await setup({
      runs: [healthyRows(), brokenRows(), healthyRows()],
    });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';
    await engine.advanceUntilBlocked(incidentId);
    await engine.decide(incidentId, 'approve');
    const verified = await engine.advanceUntilBlocked(incidentId);

    expect(verified.state).toBe('resolved');
    expect(scraper.calls).not.toContain('run:canary');
  });
});

describe('onboarding a new collector', () => {
  it('registers the generated collector and records the command', async () => {
    const { engine } = await setup({ runs: [healthyRows()] });

    const result = await engine.createCollector({
      url: 'https://example.com/listing',
      description: 'Extract every entry with title and count.',
      canaryUrl: 'https://example.com/listing/page/2',
    });

    expect(result.collector?.id).toBe('c_generated01');
    expect(result.collector?.kind).toBe('custom');
    expect(result.collector?.canaryUrl).toBe('https://example.com/listing/page/2');
    // Defaulted from the URL, since no name was given.
    expect(result.collector?.name).toBe('example.com');

    expect((await repo.listRecentCommands(1))[0]?.display).toContain('scraper create');

    // And the collector is immediately checkable: first run baselines it.
    const check = await engine.check('c_generated01');
    expect(check.baselineEstablished).toBe(true);
  });

  it('registers nothing when generation fails, but keeps the evidence', async () => {
    const { engine } = await setup({ runs: [healthyRows()], createFails: true });

    const result = await engine.createCollector({
      url: 'https://example.com/huge-page',
      description: 'Extract everything.',
    });

    expect(result.collector).toBeNull();
    // The orphan's id is preserved in the envelope for the cleanup note.
    expect(result.envelope.collector_id).toBe('c_orphaned01');
    expect(result.envelope.error).toContain('failed');

    // No phantom collector in the fleet…
    expect(await repo.getCollector('c_orphaned01')).toBeNull();
    // …but the failed command is in the transcript.
    expect((await repo.listRecentCommands(1))[0]?.failed).toBe(true);
  });
});

describe('guards', () => {
  it('never heals without a prompt, recomputing one if it has gone missing', async () => {
    // The prompt is a pure function of the stored report, so it is derived rather
    // than failed on. An earlier version refused instead, and because
    // `heal.failed` is not legal from `diagnosing` the refusal was silently
    // dropped and the unattended walk span to its step cap.
    const { scraper, engine } = await setup({ runs: [healthyRows(), brokenRows()] });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    await engine.advance(incidentId); // diagnose, which writes a prompt
    await repo.patchIncident(incidentId, { healPrompt: null });

    const result = await engine.advance(incidentId);

    // It healed, and the fake asserts the prompt it received was real.
    expect(scraper.calls).toContain('heal');
    expect(result.incident.state).toBe('awaiting_approval');
    expect(result.incident.healPrompt).toContain('Re-capture');

    const kinds = (await repo.listEvents(incidentId)).map((e) => e.kind);
    expect(kinds).toContain('diagnosed.recomputed');
  });

  it('makes progress on every unattended step, so the walk cannot spin', async () => {
    // Guards the class of bug above: if `advance` ever reports an action while
    // leaving the state untouched, the loop burns its whole step budget.
    const { engine } = await setup({ runs: [healthyRows(), brokenRows()] });

    await engine.check(COLLECTOR);
    const incidentId = (await engine.check(COLLECTOR)).incident?.id ?? '';

    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const before = (await repo.getIncident(incidentId))?.state ?? '';
      const step = await engine.advance(incidentId);
      if (step.performed === null) break;

      expect(step.incident.state, `step ${i} performed ${step.performed} but stayed put`).not.toBe(
        before,
      );
      seen.push(step.performed);
    }

    expect(seen).toEqual(['diagnose.start', 'heal.start']);
  });

  it('rejects an unknown collector', async () => {
    const { engine } = await setup({ runs: [healthyRows()] });
    await expect(engine.check('c_missing')).rejects.toThrow('unknown collector');
  });

  it('rejects an unknown incident', async () => {
    const { engine } = await setup({ runs: [healthyRows()] });
    await expect(engine.advance('i_missing')).rejects.toThrow('unknown incident');
  });
});
