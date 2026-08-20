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

const CELL_COLOR: Record<CellKind, string> = {
  healthy: 'var(--good)',
  appeared: '#5a96ff',
  degraded: 'var(--warn)',
  distorted: 'var(--warn)',
  collapsed: 'var(--bad)',
  vanished: 'var(--bad)',
};

/** A field zeroed out fills on every row, so it must not read as healthy. */
export function cellColor(cell: Cell | undefined): string {
  if (cell === undefined) return 'var(--line-soft)';
  if (cell.kind === 'distorted' && cell.magnitude === 0) return 'var(--bad)';
  return CELL_COLOR[cell.kind];
}

export function cellOpacity(cell: Cell | undefined): number {
  if (cell === undefined) return 0.3;
  if (cell.kind === 'healthy' || cell.kind === 'appeared') return 0.55;
  return 1;
}

/**
 * A short label for a cell, fit for a compact fill-rate strip.
 *
 * Deliberately not always a percentage: a zeroed field reads 100% fill and a
 * bare number there would repeat the exact false-green signal this project
 * exists to catch (see the Fleet page, and `docs/DECISIONS.md`, "A field
 * zeroed out is broken, not degraded"). Anywhere a fill rate is displayed
 * next to a classified cell, this is what should be shown instead of the raw
 * rate.
 */
export function cellLabel(cell: Cell | undefined): string {
  if (cell === undefined) return '—';
  if (cell.kind === 'distorted' && cell.magnitude === 0) return 'ZEROED';
  if (cell.kind === 'vanished') return 'GONE';
  return `${Math.round(cell.rate * 100)}%`;
}
