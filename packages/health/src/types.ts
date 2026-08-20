/**
 * Domain vocabulary for scraper health.
 *
 * Everything in `@molt/health` is a pure function over these types. There is no
 * network, no filesystem, no clock and no randomness anywhere in this package —
 * which is what makes the drift rules exhaustively testable from fixtures.
 */

/** A single scraped record, exactly as Bright Data returns it. */
export type Row = Readonly<Record<string, unknown>>;

/**
 * Field names Bright Data adds to every Scraper Studio output schema as
 * envelope metadata rather than scraped data.
 *
 * These are excluded from data-health scoring: `input` echoes the trigger
 * payload, and `error` / `warning` are diagnostics. Counting them as "fields
 * that stopped filling" would make a healthy scraper look broken.
 *
 * @see https://docs.brightdata.com/api-reference/scraper-studio-api/list-scrapers
 */
export const ENVELOPE_FIELDS = ['input', 'error', 'warning', 'error_code', 'timestamp'] as const;

export type EnvelopeField = (typeof ENVELOPE_FIELDS)[number];

/** Coarse shape of the values seen in a field, used for distribution drift. */
export type ValueShape = 'numeric' | 'text' | 'boolean' | 'list' | 'object' | 'empty' | 'mixed';

/**
 * Presence and shape statistics for one field across a sample of rows.
 *
 * `rate` is the metric that matters: a scraper that returns HTTP 200 with
 * `price: null` on every row is broken, and only fill rate reveals it.
 */
export interface FieldStats {
  readonly field: string;
  /** Rows where the value was meaningfully present (see `isPresent`). */
  readonly present: number;
  /** Rows examined. Equal to the snapshot's `rowCount`. */
  readonly total: number;
  /** `present / total`, or 0 when `total` is 0. Always finite, always 0..1. */
  readonly rate: number;
  readonly shape: ValueShape;
  /**
   * Central tendency of the field's values, when one is meaningful:
   * the median for numbers, the median character length for text, the median
   * element count for lists. `null` for shapes with no useful magnitude.
   *
   * Median rather than mean so a handful of outliers cannot mask a collapse.
   */
  readonly magnitude: number | null;
}

/**
 * The observable health of one collector at a point in time.
 *
 * Built from a scraper run plus the collector's declared `output_schema`.
 * Comparing two snapshots is the entire detection strategy.
 */
export interface Snapshot {
  /** Bright Data Collector ID, always `c_*`. This is the production endpoint. */
  readonly collectorId: string;
  /** ISO-8601. Supplied by the caller — this package never reads the clock. */
  readonly capturedAt: string;
  /** Number of records the run produced. */
  readonly rowCount: number;
  /** Per-field stats, excluding envelope fields. */
  readonly fields: readonly FieldStats[];
  /**
   * Field names declared in the collector's `output_schema`, if known.
   * Lets Molt distinguish "the site stopped providing this" from
   * "someone removed the field from the scraper".
   */
  readonly declaredFields: readonly string[] | null;
  /** Rows that carried a non-empty `error` value. */
  readonly errorRows: number;
}

/**
 * A per-field judgement produced by comparing a candidate snapshot to a
 * known-good baseline.
 *
 * Modelled as a discriminated union so the UI, the scorer and the heal-prompt
 * writer can each exhaustively handle every case with no default branch.
 */
export type FieldFinding =
  /** Filling at or near its baseline rate. Nothing to do. */
  | {
      readonly kind: 'healthy';
      readonly field: string;
      readonly rate: number;
    }
  /**
   * Was reliably present, now almost never is. The signature of a renamed
   * class or a relocated value — the exact failure `bdata scraper heal` fixes.
   */
  | {
      readonly kind: 'collapsed';
      readonly field: string;
      readonly baselineRate: number;
      readonly currentRate: number;
    }
  /** Measurably worse but still partly working. Often partial pagination. */
  | {
      readonly kind: 'degraded';
      readonly field: string;
      readonly baselineRate: number;
      readonly currentRate: number;
      readonly drop: number;
    }
  /**
   * Still filling, but the values changed character — every price is now `0`,
   * or every title is 4 characters long. Passes a null check; still wrong.
   */
  | {
      readonly kind: 'distorted';
      readonly field: string;
      readonly rate: number;
      readonly baselineMagnitude: number;
      readonly currentMagnitude: number;
      readonly ratio: number;
    }
  /** Present in the baseline, absent from the candidate's schema entirely. */
  | {
      readonly kind: 'vanished';
      readonly field: string;
      readonly baselineRate: number;
    }
  /** New since the baseline. Not a fault — worth showing, never worth healing. */
  | {
      readonly kind: 'appeared';
      readonly field: string;
      readonly currentRate: number;
    };

/** Findings that represent something actually wrong. */
export type FaultFinding = Extract<
  FieldFinding,
  { kind: 'collapsed' | 'degraded' | 'distorted' | 'vanished' }
>;

/** Overall health of a collector, worst-case across its fields. */
export type HealthStatus = 'healthy' | 'degraded' | 'broken';

/**
 * The result of comparing a candidate snapshot to a baseline.
 *
 * `status` drives Molt's state machine: `broken` opens an incident and triggers
 * a heal, `degraded` warns, `healthy` closes any open incident.
 */
export interface HealthReport {
  readonly collectorId: string;
  readonly status: HealthStatus;
  /** 0–100. 100 is a perfect match to baseline. Presentational, not a gate. */
  readonly score: number;
  readonly findings: readonly FieldFinding[];
  /** Just the findings that indicate a fault, worst first. */
  readonly faults: readonly FaultFinding[];
  /** Human-readable one-liner. Also the incident title. */
  readonly summary: string;
  readonly baselineCapturedAt: string;
  readonly candidateCapturedAt: string;
  readonly baselineRowCount: number;
  readonly candidateRowCount: number;
  /** True when the run produced no rows at all but the baseline had some. */
  readonly emptyHarvest: boolean;
}

/**
 * Tunable thresholds. Defaults are deliberately conservative: Molt would rather
 * miss a marginal wobble than cry wolf and burn credits on a needless heal.
 */
export interface HealthThresholds {
  /**
   * A field must have filled at least this often in the baseline before Molt
   * will treat a drop as a fault. Stops flaky optional fields opening
   * incidents. Default `0.8`.
   */
  readonly baselineConfidence: number;
  /**
   * At or below this current rate, a confident baseline field counts as
   * `collapsed`. Default `0.1`.
   */
  readonly collapseCeiling: number;
  /**
   * An absolute drop in fill rate at or above this counts as `degraded`.
   * Default `0.3`.
   */
  readonly degradeDrop: number;
  /**
   * Magnitude must change by at least this factor either way to count as
   * `distorted`. Default `4` — a 4x shift in median price or title length is
   * not natural variation.
   */
  readonly distortionFactor: number;
  /**
   * Row count must fall to at most this fraction of baseline to count as an
   * empty harvest. Default `0.1`.
   */
  readonly emptyHarvestFloor: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  baselineConfidence: 0.8,
  collapseCeiling: 0.1,
  degradeDrop: 0.3,
  distortionFactor: 4,
  emptyHarvestFloor: 0.1,
};
