import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildSnapshot, compareSnapshots } from '@molt/health';
import type { Row } from '@molt/health';
import { describe, expect, it } from 'vitest';

import { diagnose, HEAL_PROMPT_MAX_CHARS } from '../src/index.js';
import { nameList, percent } from '../src/format.js';

const BASELINE_AT = '2026-08-20T03:45:00.000Z';
const CANDIDATE_AT = '2026-08-21T03:45:00.000Z';

/**
 * Real captured output from collector c_mt0z2fn11aj6lk4bdz against
 * https://www.postgresql.org/support/security/, flattened out of its nested
 * wrapper rows. Shared with the brightdata package's fixtures.
 */
const advisories = (
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        'brightdata',
        'test',
        'fixtures',
        'run-pg-advisories.json',
      ),
      'utf8',
    ),
  ) as Array<{ security_advisories?: unknown[]; product_page_url?: unknown }>
).flatMap((wrapper) =>
  (wrapper.security_advisories ?? []).map((record) => ({
    product_page_url: wrapper.product_page_url,
    ...(record as Record<string, unknown>),
  })),
) as Row[];

function snap(rows: readonly Row[], capturedAt: string) {
  return buildSnapshot({ collectorId: 'c_mt0z2fn11aj6lk4bdz', capturedAt, rows });
}

const baseline = snap(advisories, BASELINE_AT);

describe('format helpers', () => {
  it('renders rates without trailing noise', () => {
    expect(percent(1)).toBe('100%');
    expect(percent(0)).toBe('0%');
    expect(percent(0.982)).toBe('98.2%');
    expect(percent(0.5)).toBe('50%');
  });

  it('renders name lists as English prose', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['a'])).toBe('`a`');
    expect(nameList(['a', 'b'])).toBe('`a` and `b`');
    expect(nameList(['a', 'b', 'c'])).toBe('`a`, `b` and `c`');
  });

  it('summarises a list too long to spell out', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(nameList(many, 3)).toBe('`a`, `b`, `c` and 5 more');
  });
});

describe('diagnose — the signature collapse, on real data', () => {
  const broken = advisories.map((row) => ({
    ...row,
    cvss_score: null,
    vector_string: null,
  }));

  const report = compareSnapshots(baseline, snap(broken, CANDIDATE_AT));
  const diagnosis = diagnose(report);

  it('fits inside the CLI limit', () => {
    expect(diagnosis.charCount).toBeLessThanOrEqual(HEAL_PROMPT_MAX_CHARS);
    expect(diagnosis.truncated).toBe(false);
  });

  it('names the dead fields', () => {
    expect([...diagnosis.targetFields].sort()).toEqual(['cvss_score', 'vector_string']);
    expect(diagnosis.prompt).toContain('`cvss_score`');
    expect(diagnosis.prompt).toContain('`vector_string`');
  });

  it('quantifies the loss with rows and dates, not adjectives', () => {
    expect(diagnosis.prompt).toContain('100% of 36 rows');
    expect(diagnosis.prompt).toContain('now 0% of 36 rows');
    expect(diagnosis.prompt).toContain('2026-08-20');
    expect(diagnosis.prompt).toContain('2026-08-21');
  });

  it('tells the healer what NOT to touch', () => {
    // The highest-leverage sentence in the prompt: it localises the change and
    // stops the healer rewriting fields that still work.
    expect(diagnosis.prompt).toContain('unaffected');
    expect(diagnosis.prompt).toContain('`cve_id`');
    expect(diagnosis.unaffectedFields).toContain('description');
  });

  it('asks for a re-capture that preserves the schema', () => {
    // Downstream consumers depend on the field names, so renaming them during a
    // heal would defeat the point of keeping the same Collector ID.
    expect(diagnosis.prompt).toContain('keeping the existing field names');
  });

  it('reads as prose a human would accept', () => {
    expect(diagnosis.prompt).toMatchInlineSnapshot(
      `"Fields \`cvss_score\` and \`vector_string\` return empty on every row as of 2026-08-21. On 2026-08-20 they filled 100% of 36 rows; now 0% of 36 rows. Re-capture \`cvss_score\` and \`vector_string\` from the current markup, keeping the existing field names. Fields \`affected_version\`, \`component\`, \`cve_id\`, \`description\`, \`fixed_in\` and \`product_page_url\` are unaffected and still extracting normally — leave them as they are."`,
    );
  });
});

describe('diagnose — an empty harvest', () => {
  const report = compareSnapshots(baseline, snap([], CANDIDATE_AT));
  const diagnosis = diagnose(report);

  it('leads with the row count, not with fields', () => {
    expect(diagnosis.prompt).toContain('no rows at all');
    expect(diagnosis.prompt).toContain('against 36');
  });

  it('asks the healer to fix record discovery first', () => {
    expect(diagnosis.prompt).toContain('how records are located');
  });

  it('stays within budget', () => {
    expect(diagnosis.charCount).toBeLessThanOrEqual(HEAL_PROMPT_MAX_CHARS);
  });
});

describe('diagnose — a distortion', () => {
  it('describes values that changed scale rather than disappeared', () => {
    const numericBase: Row[] = Array.from({ length: 20 }, (_, i) => ({
      downloads: 24_000 + i,
      title: 'a perfectly ordinary title',
    }));
    const zeroed: Row[] = Array.from({ length: 20 }, () => ({
      downloads: 0,
      title: 'a perfectly ordinary title',
    }));

    const report = compareSnapshots(snap(numericBase, BASELINE_AT), snap(zeroed, CANDIDATE_AT));
    const diagnosis = diagnose(report);

    expect(diagnosis.prompt).toContain('still fills but its values changed scale');
    expect(diagnosis.prompt).toContain('24,009');
    expect(diagnosis.prompt).toContain('now 0');
    expect(diagnosis.targetFields).toEqual(['downloads']);
  });
});

describe('diagnose — a partial loss', () => {
  it('is described as partial, not as a total failure', () => {
    const partial = advisories.map((row, i) => (i % 2 === 0 ? row : { ...row, cvss_score: null }));

    const diagnosis = diagnose(compareSnapshots(baseline, snap(partial, CANDIDATE_AT)));

    expect(diagnosis.prompt).toContain('Partial loss');
    expect(diagnosis.prompt).toContain('fell from 100% to 50%');
    expect(diagnosis.prompt).not.toContain('empty on every row');
  });
});

describe('diagnose — budget enforcement', () => {
  it('drops the least important section rather than cutting a sentence', () => {
    const wide: Row[] = Array.from({ length: 10 }, () =>
      Object.fromEntries(
        Array.from({ length: 40 }, (_, f) => [`field_number_${f}_with_a_long_name`, 'value']),
      ),
    );
    const halfDead: Row[] = wide.map((row) =>
      Object.fromEntries(Object.entries(row).map(([k, v], i) => [k, i < 20 ? null : v])),
    );

    const report = compareSnapshots(snap(wide, BASELINE_AT), snap(halfDead, CANDIDATE_AT));
    const diagnosis = diagnose(report);

    // 20 dead fields with 31-character names would be ~700 characters if spelled
    // out, so every list in the prompt has to be summarised rather than
    // enumerated. It now fits without dropping anything.
    expect(diagnosis.charCount).toBeLessThanOrEqual(HEAL_PROMPT_MAX_CHARS);
    expect(diagnosis.prompt).toContain('and 14 more');

    // Whatever survived must still be whole sentences.
    expect(diagnosis.prompt.trim()).toMatch(/\.$/);
    // And the instruction must never be the thing that got dropped.
    expect(diagnosis.prompt).toContain('Re-capture');
  });

  it('honours a custom budget', () => {
    const broken = advisories.map((row) => ({ ...row, cvss_score: null }));
    const report = compareSnapshots(baseline, snap(broken, CANDIDATE_AT));

    const diagnosis = diagnose(report, { maxChars: 200 });

    expect(diagnosis.charCount).toBeLessThanOrEqual(200);
    expect(diagnosis.truncated).toBe(true);
  });
});

describe('diagnose — a healthy report', () => {
  it('produces no fault sections and asks only for verification', () => {
    const diagnosis = diagnose(compareSnapshots(baseline, snap(advisories, CANDIDATE_AT)));

    expect(diagnosis.targetFields).toEqual([]);
    expect(diagnosis.prompt).toContain('Verify the extraction');
  });
});
