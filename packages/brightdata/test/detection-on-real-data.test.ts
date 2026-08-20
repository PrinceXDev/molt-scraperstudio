import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildSnapshot, compareSnapshots } from '@molt/health';
import type { Row } from '@molt/health';
import { describe, expect, it } from 'vitest';

import { projectRows } from '../src/project.js';

/**
 * End-to-end detection, on genuine Bright Data output.
 *
 * The unit tests in `@molt/health` prove the rules against synthetic rows. This
 * file proves the same rules hold on the actual payload that collector
 * `c_mt0z2fn11aj6lk4bdz` returned from
 * `https://www.postgresql.org/support/security/` on 2026-08-20 — 70 wrapper rows
 * carrying 327 advisories, of which 8 and 36 are committed here.
 *
 * No API key, no network. The captured payload is the contract.
 */

const PROJECTION = {
  recordPath: 'security_advisories',
  inherit: ['product_page_url'],
} as const;

const raw = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'run-pg-advisories.json'), 'utf8'),
) as unknown[];

const BASELINE_AT = '2026-08-20T03:45:00.000Z';
const CANDIDATE_AT = '2026-08-21T03:45:00.000Z';

const liveRows = projectRows(raw, PROJECTION) as Row[];

function snapshotOf(rows: readonly Row[], capturedAt: string) {
  return buildSnapshot({ collectorId: 'c_mt0z2fn11aj6lk4bdz', capturedAt, rows });
}

const baseline = snapshotOf(liveRows, BASELINE_AT);

describe('baseline health of the real collector', () => {
  it('sees every advisory as a row', () => {
    expect(baseline.rowCount).toBe(36);
  });

  it('finds all eight fields filling completely', () => {
    // A dense baseline is the ideal starting point: any later collapse is
    // unambiguous rather than a judgement call.
    expect(baseline.fields).toHaveLength(8);
    for (const field of baseline.fields) {
      expect(field.rate, `${field.field} should be fully populated`).toBe(1);
    }
  });

  it('reports itself healthy against itself', () => {
    const report = compareSnapshots(baseline, snapshotOf(liveRows, CANDIDATE_AT));

    expect(report.status).toBe('healthy');
    expect(report.score).toBe(100);
  });

  it('records no scraper errors', () => {
    expect(baseline.errorRows).toBe(0);
  });
});

describe('the silent failure, reproduced on real data', () => {
  // Simulate precisely what a real site change does: the page still renders,
  // the scraper still returns 36 rows, the job still reports done — and two
  // fields come back empty.
  const brokenRows: Row[] = liveRows.map((row) => ({
    ...row,
    cvss_score: null,
    vector_string: null,
  }));

  const report = compareSnapshots(baseline, snapshotOf(brokenRows, CANDIDATE_AT));

  it('is invisible to every conventional check', () => {
    // Same row count. This is why row-count monitoring does not catch it.
    expect(report.candidateRowCount).toBe(report.baselineRowCount);
    expect(report.emptyHarvest).toBe(false);
  });

  it('is caught as broken by fill-rate analysis', () => {
    expect(report.status).toBe('broken');
  });

  it('names exactly the two dead fields and nothing else', () => {
    const collapsed = report.faults
      .filter((f) => f.kind === 'collapsed')
      .map((f) => f.field)
      .sort();

    expect(collapsed).toEqual(['cvss_score', 'vector_string']);
  });

  it('confirms the surviving fields are untouched', () => {
    // The healer needs to know what did *not* break in order to localise the
    // fix, so this has to be reliable.
    const healthy = report.findings
      .filter((f) => f.kind === 'healthy')
      .map((f) => f.field)
      .sort();

    expect(healthy).toEqual([
      'affected_version',
      'component',
      'cve_id',
      'description',
      'fixed_in',
      'product_page_url',
    ]);
  });

  it('scores the damage proportionally', () => {
    // Two of eight fields lost.
    expect(report.score).toBe(75);
  });

  it('summarises it in a sentence fit for an incident title', () => {
    expect(report.summary).toBe('2 of 8 fields stopped extracting: cvss_score, vector_string');
  });
});

describe('the nested array disappearing', () => {
  it('is reported as an empty harvest', () => {
    // If the site restructures such that the advisory array is no longer found,
    // projection yields nothing — and that must not look like success.
    const gutted = raw.map((row) => ({
      ...(row as Record<string, unknown>),
      security_advisories: [],
    }));

    const projected = projectRows(gutted, PROJECTION) as Row[];
    expect(projected).toHaveLength(0);

    const report = compareSnapshots(baseline, snapshotOf(projected, CANDIDATE_AT));

    expect(report.status).toBe('broken');
    expect(report.emptyHarvest).toBe(true);
    expect(report.score).toBe(0);
  });
});

describe('a partial regional failure', () => {
  it('is reported as degraded rather than broken', () => {
    // A plausible real scenario: some advisory pages start failing to parse
    // while others keep working.
    const partial: Row[] = liveRows.map((row, i) =>
      i % 2 === 0 ? row : { ...row, cvss_score: null },
    );

    const report = compareSnapshots(baseline, snapshotOf(partial, CANDIDATE_AT));

    expect(report.status).toBe('degraded');

    const fault = report.faults[0];
    expect(fault?.kind).toBe('degraded');
    if (fault?.kind === 'degraded') {
      expect(fault.field).toBe('cvss_score');
      expect(fault.drop).toBeCloseTo(0.5, 2);
    }
  });
});
