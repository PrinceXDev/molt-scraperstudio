import { buildSnapshot, compareSnapshots } from '@molt/health';
import type { Row } from '@molt/health';
import { describe, expect, it } from 'vitest';

import { buildReviewRows, isSampleTooSmallToCompare } from '../src/review.js';

const BASELINE_AT = '2026-08-20T04:00:00.000Z';
const CANDIDATE_AT = '2026-08-20T04:30:00.000Z';
const COLLECTOR = 'c_mt101cvbc0o34ghzh';

function snap(rows: readonly Row[], capturedAt: string) {
  return buildSnapshot({ collectorId: COLLECTOR, capturedAt, rows });
}

/** 60 healthy chaos rows, matching the real fixture's shape. */
function healthyRows(count = 60): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Release note number ${i}`,
    category: 'service',
    download_count: 1200 + i * 300,
    comment_count: 3 + i,
  }));
}

describe('buildReviewRows — the zeroed-field case that shipped broken twice', () => {
  // Reproduces the exact incident: two fields zeroed out, a 2-row preview
  // against a 60-row baseline.
  const baseline = snap(healthyRows(60), BASELINE_AT);
  const broken = snap(
    healthyRows(60).map((r) => ({ ...r, download_count: 0, comment_count: 0 })),
    CANDIDATE_AT,
  );
  const report = compareSnapshots(baseline, broken);

  it('chooses the value measure for a zeroed field, not fill rate', () => {
    // Fill rate is 100% in baseline, broken, and preview alike for a zeroed
    // field -- it is the one measure that cannot show the fault or the fix.
    const preview = snap(
      [
        { download_count: 1200, comment_count: 3 },
        { download_count: 1500, comment_count: 4 },
      ],
      CANDIDATE_AT,
    );

    const rows = buildReviewRows(report, preview.fields);
    const downloads = rows.find((r) => r.field === 'download_count');

    expect(downloads?.measure).toBe('value');
    expect(downloads?.baseline).toBeGreaterThan(0);
    expect(downloads?.broken).toBe(0);
  });

  it('marks a zeroed field recovered once it is merely non-zero, regardless of magnitude', () => {
    // The actual bug: a preview of 1,688 was marked still-broken because it was
    // not within the detection factor of a baseline median of 20,251. It never
    // needed to be -- a 2-row preview cannot reproduce a 60-row median, and the
    // only thing that matters for a zeroed field is that zero is gone.
    const preview = snap(
      [
        { download_count: 1688, comment_count: 18 },
        { download_count: 1690, comment_count: 19 },
      ],
      CANDIDATE_AT,
    );

    const rows = buildReviewRows(report, preview.fields);
    const downloads = rows.find((r) => r.field === 'download_count');

    expect(downloads?.recovered).toBe(true);
  });

  it('does not mark a field recovered while it is still exactly zero', () => {
    const preview = snap([{ download_count: 0, comment_count: 0 }], CANDIDATE_AT);

    const rows = buildReviewRows(report, preview.fields);
    const downloads = rows.find((r) => r.field === 'download_count');

    expect(downloads?.recovered).toBe(false);
  });

  it('flags a genuinely small preview sample as not directly comparable', () => {
    expect(isSampleTooSmallToCompare(2, 60)).toBe(true);
    expect(isSampleTooSmallToCompare(30, 60)).toBe(false);
    expect(isSampleTooSmallToCompare(2, 0)).toBe(false);
  });
});

describe('buildReviewRows — a rescaled (not zeroed) field', () => {
  it('requires the ratio to fall back inside the detection factor', () => {
    const baseline = snap(
      Array.from({ length: 20 }, () => ({ price: 12_000 })),
      BASELINE_AT,
    );
    const broken = snap(
      Array.from({ length: 20 }, () => ({ price: 120 })),
      CANDIDATE_AT,
    );
    const report = compareSnapshots(baseline, broken);

    const stillOff = snap([{ price: 200 }], CANDIDATE_AT);
    const recovered = snap([{ price: 11_500 }], CANDIDATE_AT);

    expect(buildReviewRows(report, stillOff.fields)[0]?.recovered).toBe(false);
    expect(buildReviewRows(report, recovered.fields)[0]?.recovered).toBe(true);
  });
});

describe('buildReviewRows — collapsed, degraded, vanished', () => {
  it('uses fill rate and a 90% bar for a collapsed field', () => {
    const baseline = snap(healthyRows(20), BASELINE_AT);
    const broken = snap(
      healthyRows(20).map((r) => ({ ...r, category: null })),
      CANDIDATE_AT,
    );
    const report = compareSnapshots(baseline, broken);

    const partiallyBack = snap(
      Array.from({ length: 10 }, (_, i) => (i < 5 ? { category: 'service' } : {})),
      CANDIDATE_AT,
    );
    const fullyBack = snap(
      Array.from({ length: 10 }, () => ({ category: 'service' })),
      CANDIDATE_AT,
    );

    expect(buildReviewRows(report, partiallyBack.fields)[0]?.recovered).toBe(false);
    expect(buildReviewRows(report, fullyBack.fields)[0]?.recovered).toBe(true);
  });

  it('treats a vanished field as broken=0 in the review', () => {
    const baseline = snap(healthyRows(10), BASELINE_AT);
    const withoutCategory = healthyRows(10).map(({ category: _drop, ...rest }) => rest);
    const report = compareSnapshots(baseline, snap(withoutCategory, CANDIDATE_AT));

    const preview = snap(
      Array.from({ length: 10 }, () => ({ category: 'service' })),
      CANDIDATE_AT,
    );
    const row = buildReviewRows(report, preview.fields).find((r) => r.field === 'category');

    expect(row?.broken).toBe(0);
    expect(row?.recovered).toBe(true);
  });
});

describe('buildReviewRows — healthy and appeared fields are not faults', () => {
  it('marks unaffected fields wasFaulty=false, but still tracks their preview rate', () => {
    const baseline = snap(healthyRows(20), BASELINE_AT);
    const broken = snap(
      healthyRows(20).map((r) => ({ ...r, download_count: 0 })),
      CANDIDATE_AT,
    );
    const report = compareSnapshots(baseline, broken);

    const preview = snap(healthyRows(5), CANDIDATE_AT);
    const rows = buildReviewRows(report, preview.fields);

    const title = rows.find((r) => r.field === 'title');
    expect(title?.wasFaulty).toBe(false);
    expect(title?.recovered).toBe(true);
  });

  it('would flag a regression in a previously-healthy field', () => {
    // A heal that fixes the target fields but breaks a third one is not a
    // success, so a wasFaulty=false row must still report recovered=false when
    // its preview rate collapses.
    const baseline = snap(healthyRows(20), BASELINE_AT);
    const broken = snap(
      healthyRows(20).map((r) => ({ ...r, download_count: 0 })),
      CANDIDATE_AT,
    );
    const report = compareSnapshots(baseline, broken);

    const previewWithRegression = snap(
      Array.from({ length: 5 }, () => ({ download_count: 1200, comment_count: 3 })),
      CANDIDATE_AT,
    );
    const rows = buildReviewRows(report, previewWithRegression.fields);

    const title = rows.find((r) => r.field === 'title');
    expect(title?.wasFaulty).toBe(false);
    expect(title?.recovered).toBe(false);
  });
});

describe('buildReviewRows — sorting', () => {
  it('lists faulty fields before healthy ones, alphabetically within each group', () => {
    const baseline = snap(healthyRows(10), BASELINE_AT);
    const broken = snap(
      healthyRows(10).map((r) => ({ ...r, comment_count: null, download_count: 0 })),
      CANDIDATE_AT,
    );
    const report = compareSnapshots(baseline, broken);

    const preview = snap(healthyRows(3), CANDIDATE_AT);
    const rows = buildReviewRows(report, preview.fields);

    expect(rows.filter((r) => r.wasFaulty).map((r) => r.field)).toEqual([
      'comment_count',
      'download_count',
    ]);
    expect(rows.filter((r) => !r.wasFaulty).map((r) => r.field)).toEqual(['category', 'title']);
  });
});

describe('buildReviewRows — no preview data at all', () => {
  it('treats every field as absent from the preview rather than throwing', () => {
    const baseline = snap(healthyRows(10), BASELINE_AT);
    const broken = snap(
      healthyRows(10).map((r) => ({ ...r, download_count: 0 })),
      CANDIDATE_AT,
    );
    const report = compareSnapshots(baseline, broken);

    const rows = buildReviewRows(report, []);
    const downloads = rows.find((r) => r.field === 'download_count');

    expect(downloads?.preview).toBe(0);
    expect(downloads?.recovered).toBe(false);
  });
});
