import {
  ENVELOPE_FIELDS,
  type FieldStats,
  type Row,
  type Snapshot,
  type ValueShape,
} from './types.js';

/**
 * Strings that scrapers emit to mean "nothing here".
 *
 * A drifted selector frequently yields the literal text `"null"` rather than a
 * JSON null, and counting that as data would hide the exact breakage Molt
 * exists to catch. Kept deliberately short: `"-"`, `"0"` and `"N/A"` are all
 * legitimate values in some datasets, so they are treated as present.
 */
const ABSENT_SENTINELS: ReadonlySet<string> = new Set(['', 'null', 'undefined']);

const ENVELOPE: ReadonlySet<string> = new Set<string>(ENVELOPE_FIELDS);

/**
 * Whether a scraped value counts as data.
 *
 * Note that `0` and `false` are present. They are real values, and a field that
 * is genuinely all-zeros is caught by distortion detection rather than by
 * presence — conflating the two would make every boolean field look broken.
 */
export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value === 'string') {
    return !ABSENT_SENTINELS.has(value.trim().toLowerCase());
  }

  // NaN is the arithmetic equivalent of a failed extraction.
  if (typeof value === 'number') return Number.isFinite(value);

  if (Array.isArray(value)) return value.length > 0;

  if (typeof value === 'object') return Object.keys(value).length > 0;

  return true;
}

/** Median of a non-empty numeric sample. Returns `null` for an empty sample. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;

  if (sorted.length % 2 === 1) return sorted[mid] ?? null;

  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return null;

  return (lower + upper) / 2;
}

/** Classify a value into a coarse shape bucket. */
function shapeOf(value: unknown): ValueShape {
  if (!isPresent(value)) return 'empty';
  if (typeof value === 'number') return 'numeric';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'string') {
    // A numeric string is numeric for drift purposes: scrapers routinely return
    // prices as `"1284.00"`, and comparing those as text would miss a 100x
    // shift in magnitude.
    return isNumericString(value) ? 'numeric' : 'text';
  }
  if (typeof value === 'object') return 'object';
  return 'mixed';
}

function isNumericString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  return Number.isFinite(Number(trimmed));
}

/**
 * Reduce a set of observed shapes to the one that characterises the field.
 * Ignores `empty` — a field is not "mixed" merely because some rows are blank.
 */
function dominantShape(shapes: readonly ValueShape[]): ValueShape {
  const meaningful = shapes.filter((s) => s !== 'empty');
  if (meaningful.length === 0) return 'empty';

  const first = meaningful[0];
  if (first === undefined) return 'empty';

  return meaningful.every((s) => s === first) ? first : 'mixed';
}

/**
 * The comparable magnitude of a value: the number itself, the character length
 * of text, or the element count of a list.
 *
 * This is what catches a field that still fills but has gone wrong — every
 * price reading `0`, or every title truncated to a fragment.
 */
function magnitudeOf(value: unknown, shape: ValueShape): number | null {
  switch (shape) {
    case 'numeric':
      return typeof value === 'number' ? value : Number(String(value).trim());
    case 'text':
      return typeof value === 'string' ? value.trim().length : null;
    case 'list':
      return Array.isArray(value) ? value.length : null;
    case 'boolean':
    case 'object':
    case 'empty':
    case 'mixed':
      return null;
  }
}

/** Compute presence and shape statistics for one field across `rows`. */
export function computeFieldStats(field: string, rows: readonly Row[]): FieldStats {
  const total = rows.length;

  let present = 0;
  const shapes: ValueShape[] = [];
  const values: unknown[] = [];

  for (const row of rows) {
    const value = row[field];
    if (!isPresent(value)) continue;

    present += 1;
    shapes.push(shapeOf(value));
    values.push(value);
  }

  const shape = dominantShape(shapes);

  const magnitudes = values
    .map((value) => magnitudeOf(value, shapeOf(value)))
    .filter((m): m is number => m !== null && Number.isFinite(m));

  return {
    field,
    present,
    total,
    rate: total === 0 ? 0 : present / total,
    shape,
    magnitude: shape === 'mixed' ? null : median(magnitudes),
  };
}

/** Every non-envelope key appearing across `rows`, in stable sorted order. */
export function observedFields(rows: readonly Row[]): string[] {
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!ENVELOPE.has(key)) seen.add(key);
    }
  }

  return [...seen].sort();
}

export interface SnapshotInput {
  readonly collectorId: string;
  /** ISO-8601 timestamp. Passed in so this package stays clock-free. */
  readonly capturedAt: string;
  readonly rows: readonly Row[];
  /**
   * Field names from the collector's `output_schema`, when available.
   *
   * Supplying this lets Molt score fields the schema promises but the run never
   * returned — a whole-field disappearance that row inspection alone misses,
   * because a field absent from every row is indistinguishable from a field
   * that was never declared.
   */
  readonly declaredFields?: readonly string[] | null;
}

/** Build a {@link Snapshot} from a completed scraper run. */
export function buildSnapshot(input: SnapshotInput): Snapshot {
  const { collectorId, capturedAt, rows } = input;
  const declaredFields = input.declaredFields ?? null;

  const declaredDataFields = (declaredFields ?? []).filter((f) => !ENVELOPE.has(f));

  // Union of what the schema promises and what the run actually produced, so a
  // silently-absent field still gets a stats entry with rate 0.
  const fieldNames = [...new Set([...observedFields(rows), ...declaredDataFields])].sort();

  const errorRows = rows.filter((row) => isPresent(row['error'])).length;

  return {
    collectorId,
    capturedAt,
    rowCount: rows.length,
    fields: fieldNames.map((field) => computeFieldStats(field, rows)),
    declaredFields,
    errorRows,
  };
}
