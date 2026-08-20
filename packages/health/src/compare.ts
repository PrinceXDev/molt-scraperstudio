import {
  DEFAULT_THRESHOLDS,
  type FaultFinding,
  type FieldFinding,
  type FieldStats,
  type HealthReport,
  type HealthStatus,
  type HealthThresholds,
  type Snapshot,
} from './types.js';

/**
 * Severity ordering for presentation and for choosing what to tell the healer
 * about first. `collapsed` outranks `vanished` because it is the more
 * actionable of the two: the field is still declared, so a heal prompt has
 * something concrete to re-target.
 */
const SEVERITY: Record<FaultFinding['kind'], number> = {
  collapsed: 4,
  vanished: 3,
  distorted: 2,
  degraded: 1,
};

/**
 * Ratio between two magnitudes, smoothed so a magnitude of zero is comparable.
 *
 * Magnitudes are prices, character counts and list lengths, so they are
 * non-negative and `+1` smoothing is monotone and well behaved: a median price
 * falling from 1284 to 0 yields 1285, while 100 to 90 yields 1.11. Without the
 * smoothing, any collapse to zero would divide by zero, and `Infinity` does not
 * survive a round trip through JSON.
 */
export function magnitudeRatio(a: number, b: number): number {
  const x = Math.abs(a) + 1;
  const y = Math.abs(b) + 1;
  return x >= y ? x / y : y / x;
}

function byName(fields: readonly FieldStats[]): Map<string, FieldStats> {
  return new Map(fields.map((f) => [f.field, f]));
}

/**
 * Classify one field by comparing its baseline stats to its current stats.
 *
 * The order of these checks is the rule precedence, and it matters: a field
 * that collapsed is reported as `collapsed`, never as `degraded`, even though
 * it satisfies both predicates.
 */
export function classifyField(
  baseline: FieldStats,
  current: FieldStats,
  thresholds: HealthThresholds,
): FieldFinding {
  const { field } = baseline;
  const wasReliable = baseline.rate >= thresholds.baselineConfidence;

  if (wasReliable && current.rate <= thresholds.collapseCeiling) {
    return {
      kind: 'collapsed',
      field,
      baselineRate: baseline.rate,
      currentRate: current.rate,
    };
  }

  const drop = baseline.rate - current.rate;
  if (wasReliable && drop >= thresholds.degradeDrop) {
    return {
      kind: 'degraded',
      field,
      baselineRate: baseline.rate,
      currentRate: current.rate,
      drop,
    };
  }

  // Still filling — but are the values still the same kind of thing?
  if (baseline.magnitude !== null && current.magnitude !== null) {
    const ratio = magnitudeRatio(baseline.magnitude, current.magnitude);
    if (ratio >= thresholds.distortionFactor) {
      return {
        kind: 'distorted',
        field,
        rate: current.rate,
        baselineMagnitude: baseline.magnitude,
        currentMagnitude: current.magnitude,
        ratio,
      };
    }
  }

  return { kind: 'healthy', field, rate: current.rate };
}

function isFault(finding: FieldFinding): finding is FaultFinding {
  return finding.kind !== 'healthy' && finding.kind !== 'appeared';
}

/**
 * Fraction of total health lost to a single fault, where 1 means the field is
 * entirely gone. Used to build the presentational score.
 */
function lossWeight(finding: FaultFinding): number {
  switch (finding.kind) {
    case 'collapsed':
    case 'vanished':
      return 1;
    case 'distorted':
      // A field zeroed out is entirely lost, whatever a null check thinks.
      return isZeroed(finding) ? 1 : 0.5;
    case 'degraded':
      return Math.min(1, finding.drop);
  }
}

function describe(
  status: HealthStatus,
  faults: readonly FaultFinding[],
  fieldCount: number,
  emptyHarvest: boolean,
  candidateRowCount: number,
  baselineRowCount: number,
): string {
  if (emptyHarvest) {
    return `Empty harvest: ${candidateRowCount} rows returned, baseline was ${baselineRowCount}`;
  }

  if (status === 'healthy') {
    return `All ${fieldCount} fields extracting normally`;
  }

  const emptied = faults.filter((f) => f.kind === 'collapsed' || f.kind === 'vanished');

  if (emptied.length > 0) {
    const names = emptied.map((f) => f.field).join(', ');
    return `${emptied.length} of ${fieldCount} fields stopped extracting: ${names}`;
  }

  // Reported separately from "stopped extracting", because the distinction is
  // the point: these fields still return a value, and the value is a lie.
  const zeroed = faults.filter(isZeroed);
  if (zeroed.length > 0) {
    const names = zeroed.map((f) => f.field).join(', ');
    return `${zeroed.length} of ${fieldCount} fields returned only zeros: ${names}`;
  }

  const names = faults.map((f) => f.field).join(', ');
  return `${faults.length} of ${fieldCount} fields degraded: ${names}`;
}

/**
 * Compare a candidate snapshot against a known-good baseline.
 *
 * This is the whole of Molt's detection strategy, and it is a pure function:
 * the same two snapshots always produce the same report, which is why the rules
 * can be pinned by fixtures rather than verified against a live website.
 */
export function compareSnapshots(
  baseline: Snapshot,
  candidate: Snapshot,
  thresholds: HealthThresholds = DEFAULT_THRESHOLDS,
): HealthReport {
  const baseFields = byName(baseline.fields);
  const currFields = byName(candidate.fields);

  const findings: FieldFinding[] = [];

  for (const [field, baseStats] of baseFields) {
    const currStats = currFields.get(field);

    if (currStats === undefined) {
      findings.push({ kind: 'vanished', field, baselineRate: baseStats.rate });
      continue;
    }

    findings.push(classifyField(baseStats, currStats, thresholds));
  }

  for (const [field, currStats] of currFields) {
    if (!baseFields.has(field)) {
      findings.push({ kind: 'appeared', field, currentRate: currStats.rate });
    }
  }

  findings.sort((a, b) => {
    const sa = isFault(a) ? SEVERITY[a.kind] : 0;
    const sb = isFault(b) ? SEVERITY[b.kind] : 0;
    return sb - sa || a.field.localeCompare(b.field);
  });

  const faults = findings.filter(isFault);

  const emptyHarvest =
    baseline.rowCount > 0 &&
    candidate.rowCount <= Math.floor(baseline.rowCount * thresholds.emptyHarvestFloor);

  const status = resolveStatus(faults, emptyHarvest);

  // Weight each field equally, so losing `price` from a 4-field scraper hurts
  // more than losing it from a 40-field one.
  const fieldCount = Math.max(baseFields.size, 1);
  const loss = faults.reduce((total, fault) => total + lossWeight(fault) / fieldCount, 0);
  const score = emptyHarvest ? 0 : Math.round(Math.max(0, 1 - loss) * 100);

  return {
    collectorId: candidate.collectorId,
    status,
    score,
    findings,
    faults,
    summary: describe(
      status,
      faults,
      baseFields.size,
      emptyHarvest,
      candidate.rowCount,
      baseline.rowCount,
    ),
    baselineCapturedAt: baseline.capturedAt,
    candidateCapturedAt: candidate.capturedAt,
    baselineRowCount: baseline.rowCount,
    candidateRowCount: candidate.rowCount,
    emptyHarvest,
  };
}

/**
 * A field whose values have all become zero, from a meaningfully non-zero
 * baseline.
 *
 * This is a hard failure dressed as a soft one, and it is the most dangerous
 * shape a breakage can take. When a relocated field yields `0` rather than
 * `null`, every null check passes and the value looks entirely legitimate —
 * `download_count: 0` is a plausible number. Observed for real: a median of
 * 20,251 went to 0 across all 60 rows while the row count never moved.
 */
function isZeroed(fault: FaultFinding): boolean {
  return (
    fault.kind === 'distorted' && fault.currentMagnitude === 0 && fault.baselineMagnitude !== 0
  );
}

function resolveStatus(faults: readonly FaultFinding[], emptyHarvest: boolean): HealthStatus {
  if (emptyHarvest) return 'broken';

  const hasHardFailure = faults.some(
    (f) => f.kind === 'collapsed' || f.kind === 'vanished' || isZeroed(f),
  );
  if (hasHardFailure) return 'broken';

  return faults.length > 0 ? 'degraded' : 'healthy';
}
