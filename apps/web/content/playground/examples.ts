/**
 * Bundled drift-replay examples.
 *
 * Each one is a baseline/current row pair chosen to produce exactly one
 * classification from `compareSnapshots`, so a reader can see the rule fire in
 * isolation rather than untangling three faults at once.
 *
 * The field names and magnitudes are the chaos collector's real ones
 * (`comment_count` typical 60.5, `download_count` typical ~20,251) so the
 * numbers on this page match the ones in the docs, the landing page, and the
 * cockpit's own incident history. Row counts are small enough to read at a
 * glance and large enough to clear the detection thresholds — `flatlined` in
 * particular needs at least 5 distinct baseline values before it will fire at
 * all, which is why every example carries six rows.
 *
 * There is deliberately no `vanished` example. That verdict fires only when a
 * field is missing from the candidate snapshot's stats entirely, and the replay
 * pipeline passes `declaredFields` derived from the baseline (mirroring what the
 * engine does with a collector's `output_schema`) — so a baseline field always
 * gets an entry, and a field dropped from every row lands as `collapsed` at rate
 * zero instead. An earlier draft of this file claimed to demonstrate `vanished`;
 * `test/playground-examples.test.ts` proved it could not, and the example was
 * replaced rather than the label quietly left wrong.
 */

export interface ReplayExample {
  readonly id: string;
  readonly label: string;
  /** What this example is built to demonstrate. Shown under the picker. */
  readonly summary: string;
  /** The verdict `compareSnapshots` should reach. Not asserted at runtime — a label. */
  readonly expectedKind: string;
  readonly baseline: readonly Record<string, unknown>[];
  readonly current: readonly Record<string, unknown>[];
}

/** A healthy row, used as the shape every example varies from. */
function healthyRow(i: number): Record<string, unknown> {
  return {
    title: `PostgreSQL 17.${String(i)} security update`,
    category: ['security', 'release', 'advisory', 'patch', 'notice'][i % 5],
    date: `2026-0${String((i % 8) + 1)}-1${String(i % 10)}`,
    comment_count: 40 + i * 7,
    download_count: 15_000 + i * 2_600,
  };
}

const BASELINE = Array.from({ length: 6 }, (_, i) => healthyRow(i));

export const REPLAY_EXAMPLES: readonly ReplayExample[] = [
  {
    id: 'zeroed',
    label: 'Field zeroed',
    summary:
      'Two numeric fields return 0 on every row. Fill rate stays at 100% — the failure this whole project exists to catch.',
    expectedKind: 'distorted',
    baseline: BASELINE,
    current: BASELINE.map((row) => ({ ...row, comment_count: 0, download_count: 0 })),
  },
  {
    id: 'collapsed',
    label: 'Selector collapsed',
    summary:
      'A field that was reliably present is now never there — the signature of a renamed class or a relocated value. Dropping it from every row lands here too.',
    expectedKind: 'collapsed',
    baseline: BASELINE,
    current: BASELINE.map((row) => ({ ...row, comment_count: null })),
  },
  {
    id: 'degraded',
    label: 'Partially degraded',
    summary:
      'The field still fills on half the rows. Measurably worse but not dead — often the signature of partial pagination.',
    expectedKind: 'degraded',
    baseline: BASELINE,
    current: BASELINE.map((row, i) => (i % 2 === 0 ? row : { ...row, comment_count: null })),
  },
  {
    id: 'flatlined',
    label: 'Variance flatlined',
    summary:
      'Every row now carries the same value where the baseline had six distinct ones. Fill rate and magnitude both wave it through.',
    expectedKind: 'flatlined',
    baseline: BASELINE,
    current: BASELINE.map((row) => ({ ...row, category: 'security' })),
  },
  {
    id: 'empty-harvest',
    label: 'Empty harvest',
    summary:
      'The run returned no rows at all. Loud, obvious, and the easy case — included for contrast.',
    expectedKind: 'emptyHarvest',
    baseline: BASELINE,
    current: [],
  },
  {
    id: 'healthy',
    label: 'Healthy run',
    summary:
      'Different values, same shape and same magnitudes. Molt should find nothing — a detector that cannot stay quiet is useless.',
    expectedKind: 'healthy',
    baseline: BASELINE,
    current: Array.from({ length: 6 }, (_, i) => healthyRow(i + 6)),
  },
] as const;

export function findExample(id: string): ReplayExample | null {
  return REPLAY_EXAMPLES.find((example) => example.id === id) ?? null;
}

/** Pretty-printed JSON for the textareas, so the default state is readable. */
export function exampleAsJson(rows: readonly Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}
