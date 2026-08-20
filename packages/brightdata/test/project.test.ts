import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectRows, readPath } from '../src/project.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'run-pg-advisories.json'), 'utf8'),
) as unknown[];

describe('readPath', () => {
  it('reads a nested value', () => {
    expect(readPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
  });

  it('returns undefined rather than throwing on a missing branch', () => {
    expect(readPath({ a: {} }, 'a.b.c')).toBeUndefined();
    expect(readPath({}, 'nope')).toBeUndefined();
  });

  it('does not walk into an array', () => {
    expect(readPath({ a: [{ b: 1 }] }, 'a.b')).toBeUndefined();
  });

  it('returns the source for an empty path', () => {
    const source = { a: 1 };
    expect(readPath(source, '')).toBe(source);
  });
});

describe('projectRows', () => {
  it('passes flat rows through untouched', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(projectRows(rows)).toEqual(rows);
  });

  it('discards non-record entries', () => {
    expect(projectRows([{ a: 1 }, null, 'text', 42, ['x']])).toEqual([{ a: 1 }]);
  });

  it('flattens a nested record array', () => {
    const rows = [{ items: [{ id: 1 }, { id: 2 }] }, { items: [{ id: 3 }] }];

    expect(projectRows(rows, { recordPath: 'items' })).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('merges inherited wrapper fields into each record', () => {
    const rows = [{ page: 'https://x/1', items: [{ id: 1 }, { id: 2 }] }];

    expect(projectRows(rows, { recordPath: 'items', inherit: ['page'] })).toEqual([
      { page: 'https://x/1', id: 1 },
      { page: 'https://x/1', id: 2 },
    ]);
  });

  it('lets a child field win a name collision with an inherited one', () => {
    const rows = [{ id: 'outer', items: [{ id: 'inner' }] }];

    expect(projectRows(rows, { recordPath: 'items', inherit: ['id'] })).toEqual([{ id: 'inner' }]);
  });

  it('contributes nothing when the nested array is missing or empty', () => {
    // Deliberate: a vanished nested array should collapse the projected row
    // count, which is exactly the empty-harvest signal Molt reports.
    const rows = [{ items: [] }, { other: 1 }, { items: 'not an array' }];

    expect(projectRows(rows, { recordPath: 'items' })).toEqual([]);
  });
});

describe('projectRows against real Bright Data output', () => {
  // Captured from collector c_mt0z2fn11aj6lk4bdz against
  // https://www.postgresql.org/support/security/ on 2026-08-20.
  const projected = projectRows(fixture, {
    recordPath: 'security_advisories',
    inherit: ['product_page_url'],
  });

  it('unwraps the wrapper rows into individual advisories', () => {
    expect(fixture).toHaveLength(8);
    expect(projected).toHaveLength(36);
  });

  it('yields the fields the collector was asked for', () => {
    const [first] = projected;

    expect(first).toBeDefined();
    expect(Object.keys(first ?? {}).sort()).toEqual([
      'affected_version',
      'component',
      'cve_id',
      'cvss_score',
      'description',
      'fixed_in',
      'product_page_url',
      'vector_string',
    ]);
  });

  it('carries the source page URL onto every record', () => {
    expect(projected.every((r) => typeof r['product_page_url'] === 'string')).toBe(true);
  });
});
