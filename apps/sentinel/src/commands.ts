import {
  preflightTarget,
  projectRows,
  resolveCliEntry,
  summariseCredits,
  type UnknownRecord,
} from '@molt/brightdata';
import { CREATE_DESCRIPTION_MAX_CHARS, needsHuman } from '@molt/core';
import {
  buildReviewRows,
  costOfSilence,
  describeCostOfSilence,
  isSampleTooSmallToCompare,
} from '@molt/diagnose';
import { buildSnapshot, type Row } from '@molt/health';
import type { IncidentRecord } from '@molt/store';

import { resolveCollector, type CollectorConfig, type Context } from './context.js';
import {
  amber,
  bold,
  brand,
  cyan,
  dim,
  green,
  heading,
  red,
  renderCommand,
  renderFaults,
  renderReview,
  scoreBar,
  stateBadge,
  statusBadge,
  write,
  writeError,
} from './ui.js';

/** Register the configured collectors so runs have somewhere to land. */
export async function cmdInit(context: Context): Promise<number> {
  if (context.collectors.length === 0) {
    writeError(
      red('No collectors configured.') +
        '\n  Set MOLT_COLLECTOR_PRIMARY and MOLT_COLLECTOR_CHAOS in .env',
    );
    return 1;
  }

  write(heading('Registering collectors'));

  for (const config of context.collectors) {
    await context.repo.saveCollector({
      id: config.id,
      name: config.name,
      targetUrl: config.targetUrl,
      kind: config.kind,
      recordPath: config.recordPath,
      inherit: config.inherit,
      canaryUrl: config.canaryUrl,
      createdAt: new Date().toISOString(),
    });

    write(
      `  ${green('✓')} ${bold(config.alias.padEnd(8))} ${brand(config.id)}\n` +
        `    ${dim(config.targetUrl)}\n` +
        `    ${dim(`records at .${config.recordPath ?? '(flat)'}`)}` +
        (config.canaryUrl === null ? '' : `\n    ${dim(`canary ${config.canaryUrl}`)}`),
    );
  }

  write(`\n${dim('Next:')} molt check ${context.collectors[0]?.alias ?? ''}`);
  return 0;
}

/**
 * Run a collector and report on its health.
 *
 * This is the command that does the actual work of the product: trigger the
 * production endpoint, project the rows, compare against baseline, and open or
 * close an incident accordingly.
 */
export async function cmdCheck(context: Context, selector?: string): Promise<number> {
  const config = await resolveTarget(context, selector);
  if (config === null) {
    writeError(red(`Unknown collector "${selector ?? ''}". Try: primary, chaos, or a c_* id.`));
    return 1;
  }

  write(heading(`Checking ${config.alias}`));
  write(`  ${dim('collector')}  ${brand(config.id)}`);
  write(`  ${dim('target')}     ${config.targetUrl}`);
  write(dim('\n  running…'));

  const result = await context.engine.check(config.id);

  const commands = await context.repo.listRecentCommands(1);
  const command = commands[0];
  if (command !== undefined) {
    write('');
    write(renderCommand(command.display, `${command.durationMs} ms`));
  }

  write(`\n  ${dim('rows')}  ${bold(String(result.rowCount))}`);

  if (result.baselineEstablished) {
    write(
      `\n  ${cyan('BASELINE')} established. Nothing to compare against yet —\n` +
        `  ${dim('run check again after the site changes.')}`,
    );
    return 0;
  }

  const { report } = result;
  if (report === null) return 0;

  write(`  ${dim('score')} ${scoreBar(report.score)}`);
  write(`  ${dim('status')}  ${statusBadge(report.status)}  ${report.summary}`);

  if (report.faults.length > 0) {
    write('');
    write(renderFaults(report.faults));
  }

  if (result.incident !== null) {
    write(
      `\n  ${dim('incident')}  ${result.incident.id}  ${stateBadge(result.incident.state)}` +
        (result.incident.state === 'resolved' ? '' : `\n  ${dim('Next:')} molt watch`),
    );
  }

  // Non-zero for a broken collector, so CI can gate on it.
  return report.status === 'broken' ? 2 : 0;
}

/** Fleet overview: every collector, its latest verdict, its open incident. */
export async function cmdStatus(context: Context): Promise<number> {
  const collectors = await context.repo.listCollectors();

  if (collectors.length === 0) {
    write(dim('No collectors registered yet. Run: molt init'));
    return 0;
  }

  write(heading('Fleet'));

  for (const collector of collectors) {
    const snapshots = await context.repo.listSnapshots(collector.id, 8);
    const latest = snapshots.at(-1);
    const open = await context.repo.getOpenIncident(collector.id);

    write(`\n  ${bold(collector.name)}  ${brand(collector.id)}  ${dim(collector.kind)}`);
    write(`  ${dim(collector.targetUrl)}`);

    if (latest === undefined) {
      write(`  ${dim('never run')}`);
      continue;
    }

    write(
      `  ${dim('last run')}  ${latest.capturedAt}  ${dim(`${latest.rowCount} rows`)}` +
        (latest.errorRows > 0 ? `  ${red(`${latest.errorRows} error rows`)}` : ''),
    );

    // A compact fill-rate strip per field: the terminal ancestor of the UI's
    // field-by-run heatmap.
    for (const field of latest.fields) {
      const strip = snapshots
        .map((snapshot) => {
          const stat = snapshot.fields.find((f) => f.field === field.field);
          if (stat === undefined) return dim('·');
          if (stat.rate >= 0.9) return green('█');
          if (stat.rate >= 0.1) return amber('▄');
          return red('░');
        })
        .join('');

      write(`    ${field.field.padEnd(20)} ${strip}`);
    }

    write(
      open === null
        ? `  ${green('no open incident')}`
        : `  ${stateBadge(open.state)}  ${open.id}  ${dim(open.report.summary ?? '')}`,
    );

    if (open !== null) {
      const events = await context.repo.listEvents(open.id);
      const badRuns = events.filter(
        (e) => e.kind === 'detected' || e.kind === 'observed.still-broken',
      ).length;
      const cost = costOfSilence({
        openedAt: open.openedAt,
        closedAt: open.closedAt,
        now: new Date().toISOString(),
        badRuns,
      });
      write(`  ${amber(describeCostOfSilence(cost))}`);
    }

    const commands = await context.repo.listCommandsForCollector(collector.id);
    if (commands.length > 0) {
      const credits = summariseCredits(commands);
      write(
        `  ${dim('credits')}  ~${credits.total} ${dim(`(estimate, ${credits.commandCount} commands)`)}`,
      );
    }
  }

  return 0;
}

/**
 * The credits ledger: how expensive each collector has been to keep healthy.
 *
 * Bright Data does not publish per-operation pricing, so every number here is
 * explicitly labelled an estimate — see `@molt/brightdata/credits.ts` for the
 * reasoning. The point is relative, not absolute: which collector burns the
 * most AI-Flow jobs keeping itself alive.
 */
export async function cmdCredits(context: Context, selector?: string): Promise<number> {
  if (selector === undefined || selector === '') {
    const collectors = await context.repo.listCollectors();

    if (collectors.length === 0) {
      write(dim('No collectors registered yet. Run: molt init'));
      return 0;
    }

    write(heading('Credits (estimated)'));
    write(
      dim(
        '  Bright Data publishes no per-operation price list — see molt credits <collector>\n  for the breakdown, or @molt/brightdata/credits.ts for how the estimate is built.',
      ),
    );

    let fleetTotal = 0;

    for (const collector of collectors) {
      const commands = await context.repo.listCommandsForCollector(collector.id);
      const credits = summariseCredits(commands);
      fleetTotal += credits.total;

      write(
        `\n  ${bold(collector.name)}  ${brand(collector.id)}  ` +
          `${dim(`~${credits.total} credits, ${credits.commandCount} commands`)}`,
      );
    }

    write(`\n  ${bold('Fleet total')}  ~${fleetTotal} credits`);
    return 0;
  }

  const config = await resolveTarget(context, selector);
  if (config === null) {
    writeError(red(`Unknown collector "${selector}". Try: primary, chaos, or a c_* id.`));
    return 1;
  }

  const commands = await context.repo.listCommandsForCollector(config.id);
  const credits = summariseCredits(commands);

  write(heading(`Credits for ${config.alias}`));
  write(`  ${dim('collector')}  ${brand(config.id)}`);

  if (commands.length === 0) {
    write(`\n  ${dim('No commands recorded yet.')}`);
    return 0;
  }

  write(
    `\n  ${bold('Total')}  ~${credits.total} ${dim(`(estimate, ${credits.commandCount} commands)`)}`,
  );
  write('');
  for (const kind of ['run', 'heal', 'create', 'approve', 'reject', 'unknown'] as const) {
    if (credits.byKind[kind] === 0 && kind === 'unknown') continue;
    write(`    ${kind.padEnd(10)} ${dim('~')}${credits.byKind[kind]}`);
  }

  return 0;
}

/**
 * Drive every open incident as far as it can go unattended.
 *
 * Stops at the approval gate by design. That is the whole product: a person sees
 * the data diff before a fix reaches production.
 */
export async function cmdWatch(context: Context): Promise<number> {
  const incidents = (await context.repo.listIncidents(50)).filter((i) => i.closedAt === null);

  if (incidents.length === 0) {
    write(dim('No open incidents.'));
    return 0;
  }

  write(heading(`Advancing ${incidents.length} open incident(s)`));

  let blocked = 0;

  for (const incident of incidents) {
    write(`\n  ${bold(incident.id)}  ${stateBadge(incident.state)}`);

    let current: IncidentRecord = incident;

    for (let step = 0; step < 8; step += 1) {
      const result = await context.engine.advance(current.id);
      current = result.incident;

      if (result.performed === null) {
        write(`    ${dim('⏸')} ${result.note}`);
        break;
      }

      write(`    ${dim('→')} ${result.performed.padEnd(16)} ${stateBadge(current.state)}`);
    }

    if (needsHuman(current.state)) {
      blocked += 1;
      write(`    ${cyan('review:')} molt review ${current.id}`);
    }
  }

  return blocked > 0 ? 3 : 0;
}

/**
 * The terminal review screen.
 *
 * Shows the last-good fill rates against the rates the proposed fix would
 * produce, field by field. This is the same comparison the web UI renders as a
 * side-by-side row diff — a terminal can carry the summary, but not twenty rows
 * of twelve fields, which is exactly why the web UI exists.
 */
export async function cmdReview(context: Context, incidentId?: string): Promise<number> {
  const incident = await findIncident(context, incidentId);
  if (incident === null) return 1;

  const collector = await context.repo.getCollector(incident.collectorId);

  write(heading(`Incident ${incident.id}`));
  write(`  ${dim('collector')}  ${brand(incident.collectorId)}`);
  write(`  ${dim('state')}      ${stateBadge(incident.state)}`);
  write(`  ${dim('attempts')}   ${incident.attempts}`);
  write(`  ${dim('opened')}     ${incident.openedAt}`);

  const events = await context.repo.listEvents(incident.id);
  const badRuns = events.filter(
    (e) => e.kind === 'detected' || e.kind === 'observed.still-broken',
  ).length;
  const cost = costOfSilence({
    openedAt: incident.openedAt,
    closedAt: incident.closedAt,
    now: new Date().toISOString(),
    badRuns,
  });
  write(`  ${dim('cost')}       ${amber(describeCostOfSilence(cost))}`);

  write(`\n  ${bold('What broke')}`);
  write(`  ${incident.report.summary}`);
  if (incident.report.faults.length > 0) {
    write(renderFaults(incident.report.faults));
  }

  if (incident.healPrompt !== null) {
    write(
      `\n  ${bold('Heal prompt')} ${dim(`(${incident.healPrompt.length}/1000 chars, generated)`)}`,
    );
    for (const line of wrap(incident.healPrompt, 76)) write(`  ${dim('│')} ${line}`);
  }

  const preview = projectRows(asRows(incident.previewResult), {
    ...(collector?.recordPath == null ? {} : { recordPath: collector.recordPath }),
    inherit: collector?.inherit ?? [],
  }) as Row[];

  if (preview.length > 0) {
    const previewSnapshot = buildSnapshot({
      collectorId: incident.collectorId,
      capturedAt: new Date().toISOString(),
      rows: preview,
    });

    const rows = buildReviewRows(incident.report, previewSnapshot.fields);

    write(`\n  ${bold('Proposed fix')} ${dim(`(${preview.length} preview rows)`)}`);
    write(renderReview(rows));

    // A preview is a sample, not a run. Saying so keeps the reviewer from reading
    // a smaller median as a regression.
    const baselineRows = incident.report.baselineRowCount;
    if (
      rows.some((r) => r.measure === 'value') &&
      isSampleTooSmallToCompare(preview.length, baselineRows)
    ) {
      write(
        dim(
          `\n  Typical values come from ${preview.length} preview rows against ` +
            `${baselineRows} at baseline, so expect them to differ in size even when correct. ` +
            `What matters is that a zeroed field is no longer zero.`,
        ),
      );
    }

    const unrecovered = rows.filter((r) => r.wasFaulty && !r.recovered);
    write(
      unrecovered.length === 0
        ? `\n  ${green('Every broken field recovers in the preview.')}`
        : `\n  ${red(`${unrecovered.length} field(s) still wrong in the preview:`)} ${unrecovered
            .map((r) => r.field)
            .join(', ')}`,
    );
  } else if (incident.state === 'awaiting_approval') {
    write(`\n  ${amber('The heal returned no preview rows to review.')}`);
  }

  if (events.length > 0) {
    write(`\n  ${bold('Timeline')}`);
    for (const event of events) {
      const time = event.at.slice(11, 19);
      write(`  ${dim(time)}  ${event.kind.padEnd(22)} ${dim(event.detail ?? '')}`);
    }
  }

  const commands = await context.repo.listCommandsForIncident(incident.id);
  if (commands.length > 0) {
    const credits = summariseCredits(commands);
    write(`\n  ${bold('Commands run')} ${dim(`(~${credits.total} credits estimated)`)}`);
    for (const command of commands) {
      write(
        renderCommand(
          command.display,
          `${command.durationMs} ms, exit ${String(command.exitCode)}`,
        ),
      );
    }
  }

  if (incident.state === 'awaiting_approval') {
    write(
      `\n  ${bold('Decide')}\n` +
        `    molt approve ${incident.id}\n` +
        `    molt reject  ${incident.id}`,
    );
  }

  return 0;
}

/** Commit or decline a proposed fix, then verify it if committed. */
export async function cmdDecide(
  context: Context,
  decision: 'approve' | 'reject',
  incidentId?: string,
): Promise<number> {
  const incident = await findIncident(context, incidentId);
  if (incident === null) return 1;

  if (incident.state !== 'awaiting_approval') {
    writeError(red(`Incident ${incident.id} is ${incident.state}, not awaiting approval.`));
    return 1;
  }

  write(heading(decision === 'approve' ? 'Approving fix' : 'Rejecting fix'));

  const decided = await context.engine.decide(incident.id, decision);
  write(`  ${stateBadge(decided.state)}  ${decided.id}`);

  const commands = await context.repo.listCommandsForIncident(decided.id);
  const last = commands.at(-1);
  if (last !== undefined) write(renderCommand(last.display, `${last.durationMs} ms`));

  if (decision === 'approve') {
    write(dim('\n  verifying that the data actually recovered…'));
    const verified = await context.engine.advanceUntilBlocked(decided.id);

    write(`  ${stateBadge(verified.state)}  ${verified.id}`);
    write(
      verified.state === 'resolved'
        ? `\n  ${green('Resolved.')} Fill rates recovered, and the collector ID never changed:\n` +
            `  ${brand(verified.collectorId)}`
        : `\n  ${amber('Not resolved.')} ${dim('Run molt watch, or molt review for detail.')}`,
    );
  } else {
    write(`\n  ${dim('Rejected. Run molt watch to try a sharper prompt.')}`);
  }

  return 0;
}

/**
 * Clear an outstanding heal so later ones can start.
 *
 * Scraper Studio allows one refactor job per collector; a heal left at the
 * approval gate blocks every subsequent one with a 409. Rejecting the pending
 * heal releases the lock.
 */
export async function cmdUnblock(context: Context, selector?: string): Promise<number> {
  const config = await resolveTarget(context, selector);
  if (config === null) {
    writeError(red(`Unknown collector "${selector ?? ''}". Try: primary, chaos, or a c_* id.`));
    return 1;
  }

  write(heading(`Clearing pending heal on ${config.alias}`));
  write(`  ${dim('collector')}  ${brand(config.id)}`);
  write(
    dim(
      '\n  This rejects whatever heal is currently awaiting approval on this\n' +
        '  collector. Any fix you were part-way through reviewing is discarded.',
    ),
  );

  const command = await context.engine.unblock(config.id);
  write('');
  write(
    renderCommand(command.display, `${command.durationMs} ms, exit ${String(command.exitCode)}`),
  );

  if (command.failed) {
    write(`\n  ${amber('Nothing to clear, or the reject was refused.')}`);
    write(dim('  Run molt log 1 for the output.'));
    return 1;
  }

  write(`\n  ${green('Cleared.')} ${dim('A new heal can now start. Run: molt watch')}`);
  return 0;
}

/**
 * Show, pin, or un-pin a collector's baseline.
 *
 * The engine already falls back to the earliest snapshot when nothing is
 * explicitly pinned (`Repository.getBaseline`), which is enough for the
 * common case — but a legitimate redesign of the target site needs a human
 * to say "this is normal now, stop comparing against the old shape", and an
 * accidental heal onto the wrong page needs the opposite: forget the pin and
 * fall back to history. `set` and `reset` are exactly those two decisions,
 * kept deliberately explicit rather than automatic — silently moving the
 * baseline is the last thing a reliability tool should do without being
 * asked.
 */
export async function cmdBaseline(context: Context, args: readonly string[]): Promise<number> {
  const [action, selector, snapshotIdArg] = args;

  if (action !== 'show' && action !== 'set' && action !== 'reset') {
    writeError(`${red('Usage:')} molt baseline <show|set|reset> [collector] [snapshotId]`);
    return 1;
  }

  const config = await resolveTarget(context, selector);
  if (config === null) {
    writeError(red(`Unknown collector "${selector ?? ''}". Try: primary, chaos, or a c_* id.`));
    return 1;
  }

  write(heading(`Baseline ${action} — ${config.alias}`));
  write(`  ${dim('collector')}  ${brand(config.id)}`);

  if (action === 'show') {
    const baseline = await context.repo.getBaseline(config.id);

    if (baseline === null) {
      write(`\n  ${dim(`No snapshots yet. Run: molt check ${config.alias}`)}`);
      return 0;
    }

    const pinned = await context.repo.hasPinnedBaseline(config.id);

    write(
      `\n  ${dim('captured')}  ${baseline.capturedAt}\n` +
        `  ${dim('rows')}      ${baseline.rowCount}\n` +
        `  ${dim('fields')}    ${baseline.fields.length}\n` +
        `  ${dim('source')}    ${
          pinned ? cyan('explicitly pinned') : dim('earliest snapshot (fallback)')
        }\n` +
        `  ${dim('id')}        ${baseline.id}`,
    );
    return 0;
  }

  if (action === 'reset') {
    await context.repo.clearBaseline(config.id);
    const fallback = await context.repo.getBaseline(config.id);

    write(
      `\n  ${green('Cleared.')} ${
        fallback === null
          ? dim('No snapshots remain to fall back to.')
          : dim(`The earliest snapshot (${fallback.capturedAt}) is the baseline again.`)
      }`,
    );
    return 0;
  }

  // action === 'set'
  let target = null;

  if (snapshotIdArg !== undefined && snapshotIdArg !== '') {
    target = await context.repo.getSnapshot(snapshotIdArg);
    if (target === null || target.collectorId !== config.id) {
      writeError(red(`Snapshot "${snapshotIdArg}" does not belong to ${config.alias}.`));
      return 1;
    }
  } else {
    const [latest] = await context.repo.listSnapshots(config.id, 1);
    if (latest === undefined) {
      writeError(red(`${config.alias} has no snapshots yet. Run: molt check ${config.alias}`));
      return 1;
    }
    target = latest;
  }

  await context.repo.setBaseline(target.id);
  write(
    `\n  ${green('Pinned.')} ${dim(
      `${target.capturedAt} (${target.rowCount} rows) is now the baseline.`,
    )}`,
  );
  return 0;
}

/**
 * Onboard a brand-new collector: preflight the target, generate, baseline.
 *
 * The preflight encodes every target-selection lesson this project paid for:
 * the ~200 KB size ceiling the intent analyser enforces by dying, the robots
 * check, and the link-graph warning (a page with internal navigation tends to
 * become a crawler rather than a single-page extractor). A failed create
 * leaves an orphan collector that cannot be deleted programmatically, so the
 * blockers are hard stops unless `--force` says otherwise.
 */
export async function cmdAdd(context: Context, args: readonly string[]): Promise<number> {
  const { url, description, name, canaryUrl, force } = parseAddArgs(args);

  if (url === null || description === '') {
    writeError(
      `${red('Usage:')} molt add <url> <description…> [--name <name>] [--canary <url>] [--force]`,
    );
    return 1;
  }

  if (description.length > CREATE_DESCRIPTION_MAX_CHARS) {
    writeError(
      red(
        `Description is ${description.length} chars; the CLI caps it at ${CREATE_DESCRIPTION_MAX_CHARS}.`,
      ),
    );
    return 1;
  }

  write(heading('Preflighting target'));
  write(`  ${dim('target')}  ${url}`);

  const report = await preflightTarget(url);

  write(
    `  ${dim('size')}    ${Math.round(report.bytes / 1024)} KB ${
      report.withinSizeLimit ? green('within the ~200 KB ceiling') : red('OVER the ~200 KB ceiling')
    }`,
  );
  write(
    `  ${dim('robots')}  ${
      report.robotsFound
        ? report.robotsAllowed
          ? green('path permitted')
          : red('path disallowed')
        : dim('no robots.txt found')
    }`,
  );
  write(
    `  ${dim('links')}   ${report.links.internalLinks} internal, ${report.links.anchorIds} id anchors`,
  );

  for (const warning of report.warnings) {
    write(`  ${amber('▲')} ${warning}`);
  }

  if (report.blockers.length > 0) {
    write('');
    for (const blocker of report.blockers) {
      write(`  ${red('✗')} ${blocker}`);
    }

    if (!force) {
      write(
        `\n  ${red('Refusing to create.')} ${dim(
          'A failed generation leaves an orphan collector that must be deleted by hand. Pass --force to proceed anyway.',
        )}`,
      );
      return 1;
    }

    write(`\n  ${amber('Proceeding despite blockers (--force).')}`);
  }

  write(heading('Generating collector'));
  write(
    dim('  this is an AI-Flow job — expect 5–25 minutes, serialised behind any other heal/create…'),
  );

  const result = await context.engine.createCollector({
    url,
    description,
    ...(name === null ? {} : { name }),
    canaryUrl,
  });

  write('');
  write(renderCommand(result.command.display, `${result.command.durationMs} ms`));

  if (result.collector === null) {
    write(
      `\n  ${red('Generation failed.')} ${dim(result.envelope.error ?? result.envelope.status)}`,
    );
    write(
      dim(
        `  Orphaned template ${result.envelope.collector_id} may need manual deletion in the dashboard.`,
      ),
    );
    return 1;
  }

  write(`\n  ${green('✓')} ${bold(result.collector.name)}  ${brand(result.collector.id)}`);
  if (result.collector.canaryUrl !== null) {
    write(`    ${dim(`canary ${result.collector.canaryUrl}`)}`);
  }

  write(heading('Establishing baseline'));
  const check = await context.engine.check(result.collector.id);
  write(`  ${dim('rows')}  ${bold(String(check.rowCount))}`);
  write(
    check.baselineEstablished
      ? `  ${cyan('BASELINE')} established — this collector is now monitored.`
      : `  ${amber('unexpected:')} a baseline already existed for a brand-new collector`,
  );

  write(`\n  ${dim('Next:')} molt check ${result.collector.id}`);
  return 0;
}

interface AddArgs {
  readonly url: string | null;
  readonly description: string;
  readonly name: string | null;
  readonly canaryUrl: string | null;
  readonly force: boolean;
}

function parseAddArgs(args: readonly string[]): AddArgs {
  let url: string | null = null;
  let name: string | null = null;
  let canaryUrl: string | null = null;
  let force = false;
  const descriptionWords: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';

    if (arg === '--force') {
      force = true;
    } else if (arg === '--name') {
      name = args[i + 1] ?? null;
      i += 1;
    } else if (arg === '--canary') {
      canaryUrl = args[i + 1] ?? null;
      i += 1;
    } else if (url === null) {
      url = arg;
    } else {
      descriptionWords.push(arg);
    }
  }

  return { url, description: descriptionWords.join(' '), name, canaryUrl, force };
}

/** The raw transcript of every `bdata` invocation Molt has made. */
export async function cmdLog(context: Context, limitArg?: string): Promise<number> {
  const limit = Number.parseInt(limitArg ?? '20', 10);
  const commands = await context.repo.listRecentCommands(Number.isFinite(limit) ? limit : 20);

  if (commands.length === 0) {
    write(dim('Nothing has run yet.'));
    return 0;
  }

  write(heading('Command transcript'));

  for (const command of [...commands].reverse()) {
    const status = command.failed ? red('fail') : green(' ok ');
    write(`  ${dim(command.startedAt)}  ${status}  ${command.display}`);

    // A failed command's output is the only thing anyone actually wants from a
    // transcript, so it is never hidden behind a flag.
    if (!command.failed) continue;

    const detail = [command.stderr, command.stdout]
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .join('\n');

    for (const line of detail.split('\n').slice(0, 12)) {
      write(`         ${red('│')} ${line.slice(0, 160)}`);
    }
  }

  return 0;
}

/* ------------------------------------------------------------------ */

type DoctorStatus = 'pass' | 'warn' | 'fail';

interface DoctorCheck {
  readonly label: string;
  readonly status: DoctorStatus;
  readonly detail: string;
}

/** Kept in sync with `engines.node` in the workspace root `package.json`. */
const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 11;

function doctorBadge(status: DoctorStatus): string {
  if (status === 'pass') return green('✓');
  if (status === 'warn') return amber('▲');
  return red('✗');
}

/**
 * Preflight the environment itself, rather than a target.
 *
 * `molt add` already preflights a *target page* before generation. This
 * answers the earlier, more basic question — "is this machine even set up to
 * run Molt at all" — so a missing env var or an unresolvable CLI surfaces as
 * one clear line here instead of a stack trace three layers deep the first
 * time a judge or a teammate runs `molt check`.
 */
export async function cmdDoctor(context: Context): Promise<number> {
  write(heading('Doctor'));

  const checks: DoctorCheck[] = [];

  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
  checks.push({
    label: 'Node.js version',
    status: nodeOk ? 'pass' : 'fail',
    detail: nodeOk
      ? process.version
      : `${process.version} — requires >=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`,
  });

  try {
    await context.repo.listCollectors();
    checks.push({ label: 'Database', status: 'pass', detail: 'reachable' });
  } catch (error) {
    checks.push({
      label: 'Database',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const entry = resolveCliEntry();
    checks.push({ label: 'Bright Data CLI', status: 'pass', detail: entry });
  } catch (error) {
    checks.push({
      label: 'Bright Data CLI',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Not fatal on its own: `bdata login` may have stored credentials outside
  // the environment (a config file under the user's home directory), which
  // this check has no visibility into either way.
  const hasCredential = ['BRIGHTDATA_API_KEY', 'BRIGHT_DATA_API_TOKEN'].some((key) => {
    const value = process.env[key];
    return value !== undefined && value !== '';
  });
  checks.push({
    label: 'Bright Data credential',
    status: hasCredential ? 'pass' : 'warn',
    detail: hasCredential
      ? 'found in environment'
      : 'not set in env — fine if `bdata login` has already run',
  });

  const collectors = await context.repo.listCollectors();
  checks.push({
    label: 'Collectors registered',
    status: collectors.length > 0 ? 'pass' : 'warn',
    detail:
      collectors.length > 0
        ? `${collectors.length} registered`
        : 'none yet — run molt init or molt add',
  });

  for (const check of checks) {
    write(`  ${doctorBadge(check.status)}  ${bold(check.label.padEnd(24))} ${dim(check.detail)}`);
  }

  // Per-collector target reachability, reusing the exact preflight `molt
  // add` runs before generation. A target that stopped resolving, started
  // disallowing robots, or grew past the size ceiling since it was
  // registered is environment drift indistinguishable from a Molt bug until
  // something checks the target directly.
  let anyTargetFailed = false;

  for (const collector of collectors) {
    write(`\n  ${bold(collector.name)}  ${brand(collector.id)}`);

    const targets: Array<{ label: string; url: string | null }> = [
      { label: 'target', url: collector.targetUrl },
      { label: 'canary', url: collector.canaryUrl },
    ];

    for (const { label, url } of targets) {
      if (url === null) continue;

      try {
        const report = await preflightTarget(url);
        const ok = report.blockers.length === 0;
        if (!ok) anyTargetFailed = true;

        write(
          `    ${doctorBadge(ok ? 'pass' : 'fail')}  ${label.padEnd(8)} ${dim(url)}\n` +
            `           ${dim(
              `${String(Math.round(report.bytes / 1024))} KB, robots ${
                report.robotsAllowed ? 'ok' : 'DISALLOWED'
              }${report.blockers.length > 0 ? `, ${report.blockers.join('; ')}` : ''}`,
            )}`,
        );
      } catch (error) {
        anyTargetFailed = true;
        write(
          `    ${doctorBadge('fail')}  ${label.padEnd(8)} ${dim(url)}\n` +
            `           ${red(error instanceof Error ? error.message : String(error))}`,
        );
      }
    }
  }

  const hasFailure = checks.some((c) => c.status === 'fail') || anyTargetFailed;

  write(`\n  ${hasFailure ? red('Some checks failed.') : green('All checks passed.')}`);

  return hasFailure ? 1 : 0;
}

/* ------------------------------------------------------------------ */

/**
 * Resolve a selector against the env-configured collectors first, then the
 * database — collectors onboarded at runtime through `molt add` exist only in
 * the latter.
 */
async function resolveTarget(
  context: Context,
  selector: string | undefined,
): Promise<CollectorConfig | null> {
  const configured = resolveCollector(context, selector);
  if (configured !== null) return configured;

  if (selector === undefined || selector === '') return null;

  const record = await context.repo.getCollector(selector);
  if (record === null) return null;

  return {
    alias: record.name,
    id: record.id,
    targetUrl: record.targetUrl,
    name: record.name,
    kind: record.kind,
    recordPath: record.recordPath,
    inherit: record.inherit,
    canaryUrl: record.canaryUrl,
  };
}

async function findIncident(context: Context, incidentId?: string): Promise<IncidentRecord | null> {
  if (incidentId !== undefined && incidentId !== '') {
    const found = await context.repo.getIncident(incidentId);
    if (found === null) writeError(red(`Unknown incident ${incidentId}`));
    return found;
  }

  // Default to the incident that needs attention, so the common case needs no id.
  const open = (await context.repo.listIncidents(50)).filter((i) => i.closedAt === null);
  const gated = open.find((i) => i.state === 'awaiting_approval') ?? open[0];

  if (gated === undefined) {
    writeError(dim('No open incidents.'));
    return null;
  }

  return gated;
}

function asRows(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is UnknownRecord => v !== null && typeof v === 'object');
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      if (line !== '') lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }

  if (line !== '') lines.push(line);
  return lines;
}
