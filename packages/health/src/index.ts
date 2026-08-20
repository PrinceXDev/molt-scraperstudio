/**
 * `@molt/health` — the pure drift-detection core.
 *
 * Rows in, health verdict out. No network, no filesystem, no clock, no
 * randomness. Every rule in here is pinned by fixtures, so `pnpm test` proves
 * the detection logic without a Bright Data API key or a live website.
 */

export {
  DEFAULT_THRESHOLDS,
  ENVELOPE_FIELDS,
  type EnvelopeField,
  type FaultFinding,
  type FieldFinding,
  type FieldStats,
  type HealthReport,
  type HealthStatus,
  type HealthThresholds,
  type Row,
  type Snapshot,
  type ValueShape,
} from './types.js';

export {
  buildSnapshot,
  computeFieldStats,
  isPresent,
  median,
  observedFields,
  type SnapshotInput,
} from './stats.js';

export { classifyField, compareSnapshots, magnitudeRatio } from './compare.js';
