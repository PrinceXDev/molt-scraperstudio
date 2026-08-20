import type { ReviewRow } from '@molt/diagnose';
import type { FaultFinding, HealthReport } from '@molt/health';
import type { IncidentState } from '@molt/store';

/**
 * Terminal rendering.
 *
 * The CLI is the primary interface — the hackathon's first best practice is that
 * the terminal is the UI — so its output is treated as a designed surface rather
 * than as debug logging.
 */

/** Respect NO_COLOR, and drop colour when piped. */
const useColour =
  process.env['NO_COLOR'] === undefined &&
  process.env['TERM'] !== 'dumb' &&
  process.stdout.isTTY === true;

function paint(open: string, text: string): string {
  return useColour ? `[${open}m${text}[0m` : text;
}

export const bold = (t: string): string => paint('1', t);
export const dim = (t: string): string => paint('2', t);
export const red = (t: string): string => paint('31', t);
export const green = (t: string): string => paint('32', t);
export const amber = (t: string): string => paint('33', t);
export const blue = (t: string): string => paint('34', t);
export const cyan = (t: string): string => paint('36', t);

/** Bright Data red, so the sponsor is present even in the terminal. */
export const brand = (t: string): string => paint('38;5;167', t);

export function heading(text: string): string {
  return `\n${bold(text)}\n${dim('─'.repeat(Math.min(text.length + 8, 72)))}`;
}

const STATUS_STYLE = {
  healthy: green,
  degraded: amber,
  broken: red,
} as const;

export function statusBadge(status: HealthReport['status']): string {
  return STATUS_STYLE[status](status.toUpperCase());
}

const STATE_STYLE: Record<IncidentState, (t: string) => string> = {
  detected: red,
  diagnosing: amber,
  healing: amber,
  awaiting_approval: cyan,
  approved: blue,
  verifying: blue,
  resolved: green,
  rejected: amber,
  heal_failed: red,
  escalated: red,
};

export function stateBadge(state: IncidentState): string {
  return STATE_STYLE[state](state);
}

/** A 0–100 score as a compact bar, coloured by band. */
export function scoreBar(score: number, width = 20): string {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * width);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
  const colour = score >= 90 ? green : score >= 60 ? amber : red;
  return `${colour(bar)} ${String(score).padStart(3)}`;
}

export function percent(rate: number): string {
  const pct = rate * 100;
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

/** One line per fault, aligned, worst first. */
export function renderFaults(faults: readonly FaultFinding[]): string {
  if (faults.length === 0) return dim('  no faults');

  const width = Math.max(...faults.map((f) => f.field.length));

  return faults
    .map((fault) => {
      const name = fault.field.padEnd(width);

      switch (fault.kind) {
        case 'collapsed':
          return `  ${red('✗')} ${name}  ${dim(
            `${percent(fault.baselineRate)} → ${percent(fault.currentRate)}`,
          )}  ${red('collapsed')}`;
        case 'degraded':
          return `  ${amber('▾')} ${name}  ${dim(
            `${percent(fault.baselineRate)} → ${percent(fault.currentRate)}`,
          )}  ${amber('degraded')}`;
        case 'distorted':
          return `  ${amber('≠')} ${name}  ${dim(
            `${fault.baselineMagnitude} → ${fault.currentMagnitude}`,
          )}  ${amber('distorted')}`;
        case 'vanished':
          return `  ${red('∅')} ${name}  ${dim(percent(fault.baselineRate))}  ${red('vanished')}`;
      }
    })
    .join('\n');
}

/**
 * A field-by-field review of a proposed fix.
 *
 * Three columns, not two: **baseline**, **broken**, **preview**. Two columns
 * cannot express recovery, because "before" is ambiguous — is it the last-good
 * state or the broken one? Showing both makes the question the reviewer actually
 * has ("does the preview look like the baseline again?") answerable at a glance.
 *
 * The `measure` distinction is equally load-bearing. For a field that stopped
 * filling, fill rate tells the story. For a field that was *zeroed*, fill rate is
 * 100% in all three columns and says nothing — the typical value is the only
 * thing that reveals the fault, and therefore the only thing that can show it
 * repaired.
 *
 * The row shape itself lives in `@molt/diagnose` — the web UI renders the same
 * rows in its heal-review screen, and this logic has already produced two real
 * bugs, so there is exactly one implementation rather than two that can drift.
 */
function cell(value: number, measure: ReviewRow['measure'], width: number): string {
  const text = measure === 'fill' ? percent(value) : formatNumber(value);
  return text.padStart(width);
}

function formatNumber(value: number): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return rounded.toLocaleString('en-US');
}

export function renderReview(rows: readonly ReviewRow[]): string {
  if (rows.length === 0) return dim('  nothing to compare');

  const nameWidth = Math.max(...rows.map((r) => r.field.length), 5);
  const col = 11;

  const header =
    `  ${'field'.padEnd(nameWidth)}  ${'baseline'.padStart(col)}  ` +
    `${'broken'.padStart(col)}  ${'preview'.padStart(col)}`;

  const body = rows.map((row) => {
    const mark = !row.wasFaulty ? dim('·') : row.recovered ? green('✓') : red('✗');

    const preview = cell(row.preview, row.measure, col);
    const previewPainted = !row.wasFaulty
      ? dim(preview)
      : row.recovered
        ? green(preview)
        : red(preview);

    const broken = cell(row.broken, row.measure, col);
    const brokenPainted = row.wasFaulty ? red(broken) : dim(broken);

    return (
      `  ${row.field.padEnd(nameWidth)}  ${dim(cell(row.baseline, row.measure, col))}  ` +
      `${brokenPainted}  ${previewPainted}  ${mark}` +
      (row.measure === 'value' ? `  ${dim('typical value')}` : '')
    );
  });

  return [dim(header), ...body].join('\n');
}

/** The exact command that ran, presented as something you could have typed. */
export function renderCommand(display: string, meta?: string): string {
  const suffix = meta === undefined ? '' : dim(`  ${meta}`);
  return `  ${brand('$')} ${display}${suffix}`;
}

export function write(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function writeError(text: string): void {
  process.stderr.write(`${text}\n`);
}
