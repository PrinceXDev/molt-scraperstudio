import { compareSnapshots, type FieldFinding, type Snapshot } from '@molt/health';
import type { SnapshotRecord } from '@molt/store';

/**
 * Build the field × run matrix.
 *
 * The single most legible argument this product has: fields down, runs across,
 * each cell classified against the baseline. A terminal can print one run's
 * fill rate; it cannot make you *see* the run where two columns turn red among
 * a dozen healthy ones. That is this screen's entire reason to exist.
 *
 * Colouring by raw fill rate would miss the most dangerous failure this project
 * found in its own testing: a field that returns 0 instead of null still fills
 * on every row. So each cell is classified with the same `compareSnapshots`
 * logic that drives incidents — baseline vs. every run in the window, field by
 * field — not by fill rate alone.
 */

export type CellKind = FieldFinding['kind'];

export interface Cell {
  readonly kind: CellKind;
  readonly rate: number;
  readonly magnitude: number | null;
}

export interface HeatmapColumn {
  readonly capturedAt: string;
  readonly rowCount: number;
  readonly isBaseline: boolean;
  readonly cells: ReadonlyMap<string, Cell>;
}

export interface Heatmap {
  readonly fields: readonly string[];
  readonly columns: readonly HeatmapColumn[];
}

function toSnapshot(record: SnapshotRecord, collectorId: string): Snapshot {
  return {
    collectorId,
    capturedAt: record.capturedAt,
    rowCount: record.rowCount,
    fields: record.fields,
    declaredFields: record.declaredFields,
    errorRows: record.errorRows,
  };
}

export function buildHeatmap(
  collectorId: string,
  baseline: SnapshotRecord,
  history: readonly SnapshotRecord[],
): Heatmap {
  const baselineSnapshot = toSnapshot(baseline, collectorId);

  const fieldSet = new Set<string>(baseline.fields.map((f) => f.field));
  for (const record of history) {
    for (const field of record.fields) fieldSet.add(field.field);
  }
  const fields = [...fieldSet].sort();

  const columns: HeatmapColumn[] = history.map((record) => {
    const snapshot = toSnapshot(record, collectorId);
    const report = compareSnapshots(baselineSnapshot, snapshot);

    const cells = new Map<string, Cell>();
    for (const finding of report.findings) {
      const stat = record.fields.find((f) => f.field === finding.field);
      cells.set(finding.field, {
        kind: finding.kind,
        rate: stat?.rate ?? 0,
        magnitude: stat?.magnitude ?? null,
      });
    }

    return {
      capturedAt: record.capturedAt,
      rowCount: record.rowCount,
      isBaseline: record.id === baseline.id,
      cells,
    };
  });

  return { fields, columns };
}

/**
 * Cell classification, expressed as static Tailwind classes.
 *
 * This is the *only* place the rule lives. It previously existed three times —
 * a `cellColor` here returning CSS-variable strings, plus a `barColorClass` in
 * the Fleet page and a `heatCellClass` in the collector page that each
 * reimplemented it as classes, because Tailwind's scanner cannot see a class
 * name assembled at runtime. The two page-local copies were the real ones and
 * this one was dead, which is exactly the arrangement in which the copies drift
 * apart. Returning finished class strings from a lookup keyed by a closed union
 * gives the scanner literal classes to find *and* keeps one definition.
 *
 * `severity` is the honest name for what this returns: not a colour, a verdict.
 */
export type CellSeverity = 'unknown' | 'good' | 'info' | 'warn' | 'bad';

const SEVERITY: Record<CellKind, CellSeverity> = {
  healthy: 'good',
  // A field that appeared is not a fault, but it is not "as baselined" either.
  appeared: 'info',
  degraded: 'warn',
  distorted: 'warn',
  flatlined: 'warn',
  collapsed: 'bad',
  vanished: 'bad',
};

const SEVERITY_BG: Record<CellSeverity, string> = {
  unknown: 'bg-line-soft',
  good: 'bg-good',
  info: 'bg-info',
  warn: 'bg-warn',
  bad: 'bg-bad',
};

/**
 * The verdict for one cell.
 *
 * The `distorted` + `magnitude === 0` special case is the whole reason this
 * function exists rather than a bare lookup: a field returning 0 instead of its
 * real value is *present* on every row, so it fills at 100% and every
 * fill-rate-based reading calls it healthy. This shipped as a false-green on
 * the Fleet page once already. It is a `bad`, not a `warn`.
 */
export function cellSeverity(cell: Cell | undefined): CellSeverity {
  if (cell === undefined) return 'unknown';
  if (cell.kind === 'distorted' && cell.magnitude === 0) return 'bad';
  return SEVERITY[cell.kind];
}

/** Background class for a cell or sparkline bar. */
export function cellBgClass(cell: Cell | undefined): string {
  return SEVERITY_BG[cellSeverity(cell)];
}

/**
 * Opacity class, so healthy runs recede and faults come forward.
 *
 * A grid where every cell is fully saturated makes the reader do the work of
 * finding the two red columns. Holding "fine" at 55% means a fault is the only
 * thing at full strength on the screen.
 */
export function cellOpacityClass(cell: Cell | undefined): string {
  const severity = cellSeverity(cell);
  if (severity === 'unknown') return 'opacity-30';
  if (severity === 'good' || severity === 'info') return 'opacity-55';
  return 'opacity-100';
}

/** Background and opacity together — what a heat cell wants. */
export function cellClasses(cell: Cell | undefined): string {
  return `${cellBgClass(cell)} ${cellOpacityClass(cell)}`;
}

/**
 * A short label for a cell, fit for a compact fill-rate strip.
 *
 * Deliberately not always a percentage: a zeroed field reads 100% fill and a
 * bare number there would repeat the exact false-green signal this project
 * exists to catch — a field zeroed out is broken, not degraded. Anywhere a
 * fill rate is displayed next to a classified cell, this is what should be
 * shown instead of the raw rate.
 */
export function cellLabel(cell: Cell | undefined): string {
  if (cell === undefined) return '—';
  if (cell.kind === 'distorted' && cell.magnitude === 0) return 'ZEROED';
  if (cell.kind === 'flatlined') return 'FLAT';
  if (cell.kind === 'vanished') return 'GONE';
  return `${Math.round(cell.rate * 100)}%`;
}
