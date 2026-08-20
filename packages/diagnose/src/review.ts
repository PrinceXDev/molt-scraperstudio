import {
  magnitudeRatio,
  DEFAULT_THRESHOLDS,
  type FieldStats,
  type HealthReport,
} from '@molt/health';

/**
 * The three-column review of a proposed fix: baseline, broken, preview.
 *
 * Extracted from the CLI's `molt review` command because it is shared with the
 * web UI's heal-review screen, and because this exact logic has already
 * produced two real bugs (see `docs/DECISIONS.md`, 2026-08-20): comparing the
 * wrong pair of numbers, and judging recovery at a stricter threshold than
 * detection. A single tested implementation is the fix for "drift between two
 * copies of the same judgement", which is precisely the failure mode this whole
 * project exists to catch elsewhere.
 */

export interface ReviewRow {
  readonly field: string;
  /** `fill` compares presence; `value` compares the typical magnitude. */
  readonly measure: 'fill' | 'value';
  readonly baseline: number;
  readonly broken: number;
  readonly preview: number;
  readonly recovered: boolean;
  readonly wasFaulty: boolean;
}

/**
 * Recovery is the negation of the fault condition, deliberately using the very
 * same threshold that detected it.
 *
 * Using a stricter bar for recovery than for detection is incoherent, and it
 * bit: a preview that restored `download_count` from 0 to 1,688 was marked as
 * still broken because 1,688 is not within 2× of the baseline median of
 * 20,251. It was never within 2× and did not need to be — the preview carries a
 * handful of rows and the baseline was computed over the whole page, so medians
 * across samples that different in size are not comparable. A field that was
 * *zeroed* has recovered when it is no longer zero; a field that was *rescaled*
 * has recovered when it is back inside the detection factor.
 */
const DISTORTION_FACTOR = DEFAULT_THRESHOLDS.distortionFactor;

/** Fill rate at or above this counts as recovered. */
const FILL_RECOVERY_THRESHOLD = 0.9;

/**
 * Below this ratio of preview rows to baseline rows, magnitude comparisons carry
 * a caveat for callers rather than being presented as equivalent.
 */
export const COMPARABLE_SAMPLE_RATIO = 0.25;

/**
 * Build the three-column review from a health report and the preview rows a
 * proposed fix would produce.
 *
 * The per-field choice of measure is the important part: a field that was
 * zeroed fills on every row in all three columns, so only its typical value can
 * show either the fault or the repair.
 */
export function buildReviewRows(
  report: HealthReport,
  previewFields: readonly FieldStats[],
): ReviewRow[] {
  const previewByField = new Map(previewFields.map((f) => [f.field, f]));

  const rows: ReviewRow[] = report.findings.map((finding) => {
    const stat = previewByField.get(finding.field);
    const previewRate = stat?.rate ?? 0;
    const previewMagnitude = stat?.magnitude ?? 0;

    switch (finding.kind) {
      case 'distorted': {
        const wasZeroed = finding.currentMagnitude === 0 && finding.baselineMagnitude !== 0;

        return {
          field: finding.field,
          measure: 'value',
          baseline: finding.baselineMagnitude,
          broken: finding.currentMagnitude,
          preview: previewMagnitude,
          recovered: wasZeroed
            ? previewMagnitude !== 0
            : magnitudeRatio(finding.baselineMagnitude, previewMagnitude) < DISTORTION_FACTOR,
          wasFaulty: true,
        };
      }

      case 'flatlined':
        // Detection and recovery use the same bar: the fault is "one distinct
        // value", so the field has recovered when the preview shows more than
        // one. Distinct counts are not comparable across sample sizes the way
        // medians are not, which is exactly why the threshold is 2, not
        // "back to baseline variety".
        return {
          field: finding.field,
          measure: 'value',
          baseline: finding.baselineDistinct,
          broken: finding.currentDistinct,
          preview: stat?.distinct ?? 0,
          recovered: (stat?.distinct ?? 0) > 1,
          wasFaulty: true,
        };

      case 'collapsed':
        return {
          field: finding.field,
          measure: 'fill',
          baseline: finding.baselineRate,
          broken: finding.currentRate,
          preview: previewRate,
          recovered: previewRate >= FILL_RECOVERY_THRESHOLD,
          wasFaulty: true,
        };

      case 'degraded':
        return {
          field: finding.field,
          measure: 'fill',
          baseline: finding.baselineRate,
          broken: finding.currentRate,
          preview: previewRate,
          recovered: previewRate >= FILL_RECOVERY_THRESHOLD,
          wasFaulty: true,
        };

      case 'vanished':
        return {
          field: finding.field,
          measure: 'fill',
          baseline: finding.baselineRate,
          broken: 0,
          preview: previewRate,
          recovered: previewRate >= FILL_RECOVERY_THRESHOLD,
          wasFaulty: true,
        };

      case 'healthy':
      case 'appeared': {
        const rate = finding.kind === 'healthy' ? finding.rate : finding.currentRate;
        return {
          field: finding.field,
          measure: 'fill',
          baseline: rate,
          broken: rate,
          preview: previewRate,
          // Not a fault, but a regression here would still matter — a heal that
          // fixes two fields and breaks a third is not a success.
          recovered: previewRate >= FILL_RECOVERY_THRESHOLD,
          wasFaulty: false,
        };
      }
    }
  });

  return rows.sort(
    (a, b) => Number(b.wasFaulty) - Number(a.wasFaulty) || a.field.localeCompare(b.field),
  );
}

/**
 * Whether the preview sample is small enough relative to baseline that a
 * "typical value" comparison needs a caveat attached, rather than being shown
 * as directly equivalent.
 */
export function isSampleTooSmallToCompare(
  previewRowCount: number,
  baselineRowCount: number,
): boolean {
  if (baselineRowCount <= 0) return false;
  return previewRowCount / baselineRowCount < COMPARABLE_SAMPLE_RATIO;
}
