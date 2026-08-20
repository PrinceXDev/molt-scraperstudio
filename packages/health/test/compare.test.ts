import { describe, expect, it } from 'vitest';

import { buildSnapshot, compareSnapshots, magnitudeRatio } from '../src/index.js';
import type { Row, Snapshot } from '../src/index.js';

const BASELINE_AT = '2026-08-17T03:00:00.000Z';
const CANDIDATE_AT = '2026-08-20T03:00:00.000Z';

/** A healthy run of a four-field story-listing scraper. */
function healthyRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Story number ${i} with a realistic headline`,
    url: `https://example.com/item/${i}`,
    points: 40 + i,
    comment_count: 5 + i,
  }));
}

function snapshot(
  rows: Row[],
  capturedAt: string,
  declaredFields?: readonly string[],
): Snapshot {
  return buildSnapshot({
    collectorId: 'c_moltdemo0001',
    capturedAt,
    rows,
    ...(declaredFields ? { declaredFields } : {}),
  });
}

describe('magnitudeRatio', () => {
  it('is symmetric', () => {
    expect(magnitudeRatio(100, 10)).toBe(magnitudeRatio(10, 100));
  });

  it('stays finite when a magnitude collapses to zero', () => {
    // Infinity does not survive a round trip through JSON, and every magnitude
    // is non-negative, so the ratio is smoothed by one.
    const ratio = magnitudeRatio(1284, 0);

    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBe(1285);
  });

  it('reports near-parity for natural variation', () => {
    expect(magnitudeRatio(100, 90)).toBeCloseTo(1.11, 2);
  });
});

describe('compareSnapshots', () => {
  it('reports a healthy verdict when nothing has changed', () => {
    const baseline = snapshot(healthyRows(30), BASELINE_AT);
    const candidate = snapshot(healthyRows(30), CANDIDATE_AT);

    const report = compareSnapshots(baseline, candidate);

    expect(report.status).toBe('healthy');
    expect(report.score).toBe(100);
    expect(report.faults).toEqual([]);
    expect(report.summary).toBe('All 4 fields extracting normally');
  });

  it('catches the silent failure: HTTP fine, rows returned, two fields dead', () => {
    // The signature breakage. A class rename means `points` and
    // `comment_count` come back null while `title` and `url` are untouched.
    // Row count is unchanged and the job status would read "done".
    const baseline = snapshot(healthyRows(30), BASELINE_AT);
    const broken = healthyRows(30).map((row) => ({
      ...row,
      points: null,
      comment_count: null,
    }));

    const report = compareSnapshots(baseline, snapshot(broken, CANDIDATE_AT));

    expect(report.status).toBe('broken');
    expect(report.emptyHarvest).toBe(false);
    expect(report.candidateRowCount).toBe(30);

    const collapsed = report.faults.filter((f) => f.kind === 'collapsed');
    expect(collapsed.map((f) => f.field)).toEqual(['comment_count', 'points']);

    // Two of four fields lost outright.
    expect(report.score).toBe(50);
    expect(report.summary).toBe(
      '2 of 4 fields stopped extracting: comment_count, points',
    );
  });

  it('classifies a partial drop as degraded rather than broken', () => {
    const baseline = snapshot(healthyRows(20), BASELINE_AT);
    const partial = healthyRows(20).map((row, i) => ({
      ...row,
      points: i < 10 ? row['points'] : null,
    }));

    const report = compareSnapshots(baseline, snapshot(partial, CANDIDATE_AT));

    expect(report.status).toBe('degraded');

    const [fault] = report.faults;
    expect(fault?.kind).toBe('degraded');
    if (fault?.kind === 'degraded') {
      expect(fault.field).toBe('points');
      expect(fault.drop).toBeCloseTo(0.5, 5);
    }
  });

  it('reports collapsed rather than degraded when both rules match', () => {
    // Rule precedence: a total loss is never described as a partial one.
    const baseline = snapshot(healthyRows(20), BASELINE_AT);
    const dead = healthyRows(20).map((row) => ({ ...row, points: null }));

    const report = compareSnapshots(baseline, snapshot(dead, CANDIDATE_AT));

    expect(report.faults.map((f) => f.kind)).toContain('collapsed');
    expect(report.faults.map((f) => f.kind)).not.toContain('degraded');
  });

  it('catches a field that still fills but has gone wrong', () => {
    // Every price now reads 0. A null check passes; the data is worthless.
    const baseRows: Row[] = Array.from({ length: 20 }, (_, i) => ({ price: 1200 + i }));
    const zeroed: Row[] = Array.from({ length: 20 }, () => ({ price: 0 }));

    const report = compareSnapshots(
      snapshot(baseRows, BASELINE_AT),
      snapshot(zeroed, CANDIDATE_AT),
    );

    expect(report.status).toBe('degraded');

    const [fault] = report.faults;
    expect(fault?.kind).toBe('distorted');
    if (fault?.kind === 'distorted') {
      expect(fault.field).toBe('price');
      expect(fault.rate).toBe(1);
      expect(fault.currentMagnitude).toBe(0);
    }
  });

  it('catches a title truncated to a fragment', () => {
    const baseRows: Row[] = Array.from({ length: 20 }, (_, i) => ({
      title: `A perfectly ordinary headline number ${i}`,
    }));
    const truncated: Row[] = Array.from({ length: 20 }, () => ({ title: '...' }));

    const report = compareSnapshots(
      snapshot(baseRows, BASELINE_AT),
      snapshot(truncated, CANDIDATE_AT),
    );

    expect(report.faults[0]?.kind).toBe('distorted');
  });

  it('flags an empty harvest and floors the score', () => {
    const report = compareSnapshots(
      snapshot(healthyRows(30), BASELINE_AT),
      snapshot([], CANDIDATE_AT),
    );

    expect(report.status).toBe('broken');
    expect(report.emptyHarvest).toBe(true);
    expect(report.score).toBe(0);
    expect(report.summary).toBe('Empty harvest: 0 rows returned, baseline was 30');
  });

  it('reports a field missing from the candidate schema as vanished', () => {
    const baseline = snapshot(healthyRows(10), BASELINE_AT);
    const withoutPoints = healthyRows(10).map(({ points: _points, ...rest }) => rest);

    const report = compareSnapshots(baseline, snapshot(withoutPoints, CANDIDATE_AT));

    expect(report.status).toBe('broken');
    expect(report.faults.map((f) => f.kind)).toContain('vanished');
  });

  it('notes a new field without treating it as a fault', () => {
    const baseline = snapshot(healthyRows(10), BASELINE_AT);
    const enriched = healthyRows(10).map((row) => ({ ...row, author: 'someone' }));

    const report = compareSnapshots(baseline, snapshot(enriched, CANDIDATE_AT));

    expect(report.status).toBe('healthy');
    expect(report.findings.some((f) => f.kind === 'appeared' && f.field === 'author')).toBe(true);
    expect(report.faults).toEqual([]);
  });

  it('ignores a drop in a field that was never reliable', () => {
    // An optional field that only ever filled a third of the time must not be
    // allowed to open an incident and burn credits on a needless heal.
    const flaky: Row[] = Array.from({ length: 30 }, (_, i) => ({
      title: 'stable',
      badge: i % 3 === 0 ? 'sale' : null,
    }));
    const gone: Row[] = Array.from({ length: 30 }, () => ({ title: 'stable', badge: null }));

    const report = compareSnapshots(snapshot(flaky, BASELINE_AT), snapshot(gone, CANDIDATE_AT));

    expect(report.status).toBe('healthy');
    expect(report.faults).toEqual([]);
  });

  it('orders faults by severity so the worst is reported first', () => {
    const baseRows: Row[] = Array.from({ length: 20 }, (_, i) => ({
      dead: 'value',
      slipping: 'value',
      price: 1000 + i,
    }));
    const brokenRows: Row[] = Array.from({ length: 20 }, (_, i) => ({
      dead: null,
      slipping: i < 8 ? 'value' : null,
      price: 0,
    }));

    const report = compareSnapshots(
      snapshot(baseRows, BASELINE_AT),
      snapshot(brokenRows, CANDIDATE_AT),
    );

    expect(report.faults.map((f) => f.kind)).toEqual(['collapsed', 'distorted', 'degraded']);
  });

  it('honours custom thresholds', () => {
    const baseline = snapshot(healthyRows(20), BASELINE_AT);
    const partial = healthyRows(20).map((row, i) => ({
      ...row,
      points: i < 15 ? row['points'] : null,
    }));

    // A 25% drop is below the default 30% degrade threshold.
    const lenient = compareSnapshots(baseline, snapshot(partial, CANDIDATE_AT));
    expect(lenient.status).toBe('healthy');

    const strict = compareSnapshots(baseline, snapshot(partial, CANDIDATE_AT), {
      baselineConfidence: 0.8,
      collapseCeiling: 0.1,
      degradeDrop: 0.2,
      distortionFactor: 4,
      emptyHarvestFloor: 0.1,
    });
    expect(strict.status).toBe('degraded');
  });

  it('detects a schema-declared field that the run never returned', () => {
    const baseline = snapshot(healthyRows(10), BASELINE_AT, [
      'title',
      'url',
      'points',
      'comment_count',
    ]);
    const withoutPoints = healthyRows(10).map(({ points: _points, ...rest }) => rest);
    const candidate = snapshot(withoutPoints, CANDIDATE_AT, [
      'title',
      'url',
      'points',
      'comment_count',
    ]);

    const report = compareSnapshots(baseline, candidate);

    // Still declared, so it collapsed rather than vanished — and a heal prompt
    // has a concrete field name to re-target.
    expect(report.faults.map((f) => f.kind)).toContain('collapsed');
    expect(report.status).toBe('broken');
  });

  it('carries both timestamps through so an incident can be dated', () => {
    const report = compareSnapshots(
      snapshot(healthyRows(5), BASELINE_AT),
      snapshot(healthyRows(5), CANDIDATE_AT),
    );

    expect(report.baselineCapturedAt).toBe(BASELINE_AT);
    expect(report.candidateCapturedAt).toBe(CANDIDATE_AT);
    expect(report.collectorId).toBe('c_moltdemo0001');
  });
});
