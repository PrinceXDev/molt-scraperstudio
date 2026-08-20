import { projectRows, type UnknownRecord } from '@molt/brightdata';
import { needsHuman } from '@molt/core';
import { buildReviewRows, isSampleTooSmallToCompare } from '@molt/diagnose';
import { buildSnapshot, type Row } from '@molt/health';
import type { IncidentRecord } from '@molt/store';

import { resolveCollector, type Context } from './context.js';
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
      createdAt: new Date().toISOString(),
    });

    write(
      `  ${green('✓')} ${bold(config.alias.padEnd(8))} ${brand(config.id)}\n` +
        `    ${dim(config.targetUrl)}\n` +
        `    ${dim(`records at .${config.recordPath ?? '(flat)'}`)}`,
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
  const config = resolveCollector(context, selector);
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

  const events = await context.repo.listEvents(incident.id);
  if (events.length > 0) {
    write(`\n  ${bold('Timeline')}`);
    for (const event of events) {
      const time = event.at.slice(11, 19);
      write(`  ${dim(time)}  ${event.kind.padEnd(22)} ${dim(event.detail ?? '')}`);
    }
  }

  const commands = await context.repo.listCommandsForIncident(incident.id);
  if (commands.length > 0) {
    write(`\n  ${bold('Commands run')}`);
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
  const config = resolveCollector(context, selector);
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
