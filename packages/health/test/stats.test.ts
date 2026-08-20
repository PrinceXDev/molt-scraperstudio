import { describe, expect, it } from 'vitest';

import { buildSnapshot, computeFieldStats, isPresent, median, observedFields } from '../src/index.js';
import type { Row } from '../src/index.js';

describe('isPresent', () => {
  it('treats null and undefined as absent', () => {
    expect(isPresent(null)).toBe(false);
    expect(isPresent(undefined)).toBe(false);
  });

  it('treats the string forms of null as absent', () => {
    // A drifted selector commonly yields the literal text rather than a JSON
    // null. Counting it as data would hide the breakage.
    expect(isPresent('null')).toBe(false);
    expect(isPresent('undefined')).toBe(false);
    expect(isPresent('NULL')).toBe(false);
    expect(isPresent('  ')).toBe(false);
    expect(isPresent('')).toBe(false);
  });

  it('treats zero and false as present', () => {
    // A price of 0 and a boolean false are real values. An all-zero field is
    // caught by distortion detection, not by presence.
    expect(isPresent(0)).toBe(true);
    expect(isPresent(false)).toBe(true);
  });

  it('treats NaN as absent', () => {
    expect(isPresent(Number.NaN)).toBe(false);
  });

  it('treats empty collections as absent and populated ones as present', () => {
    expect(isPresent([])).toBe(false);
    expect(isPresent({})).toBe(false);
    expect(isPresent(['a'])).toBe(true);
    expect(isPresent({ a: 1 })).toBe(true);
  });

  it('keeps values that only look like placeholders', () => {
    // Legitimate in real datasets, so never silently discarded.
    expect(isPresent('-')).toBe(true);
    expect(isPresent('N/A')).toBe(true);
    expect(isPresent('0')).toBe(true);
  });
});

describe('median', () => {
  it('returns null for an empty sample', () => {
    expect(median([])).toBeNull();
  });

  it('picks the middle value of an odd-length sample', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values of an even-length sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('resists outliers that would skew a mean', () => {
    expect(median([10, 10, 10, 10, 100_000])).toBe(10);
  });
});

describe('computeFieldStats', () => {
  it('reports the fill rate of a partially populated field', () => {
    const rows: Row[] = [{ price: 10 }, { price: null }, { price: 30 }, { price: '' }];

    const stats = computeFieldStats('price', rows);

    expect(stats.present).toBe(2);
    expect(stats.total).toBe(4);
    expect(stats.rate).toBe(0.5);
  });

  it('reports a rate of zero for an empty sample rather than dividing by zero', () => {
    const stats = computeFieldStats('price', []);

    expect(stats.rate).toBe(0);
    expect(stats.magnitude).toBeNull();
  });

  it('classifies numeric strings as numeric so magnitude stays comparable', () => {
    // Scrapers routinely return prices as strings; comparing them as text
    // would miss a hundredfold shift in value.
    const rows: Row[] = [{ price: '1284.00' }, { price: '1200.00' }];

    const stats = computeFieldStats('price', rows);

    expect(stats.shape).toBe('numeric');
    expect(stats.magnitude).toBe(1242);
  });

  it('uses character length as the magnitude of a text field', () => {
    const rows: Row[] = [{ title: 'abcd' }, { title: 'abcdef' }];

    const stats = computeFieldStats('title', rows);

    expect(stats.shape).toBe('text');
    expect(stats.magnitude).toBe(5);
  });

  it('uses element count as the magnitude of a list field', () => {
    const rows: Row[] = [{ tags: ['a', 'b'] }, { tags: ['a', 'b', 'c', 'd'] }];

    const stats = computeFieldStats('tags', rows);

    expect(stats.shape).toBe('list');
    expect(stats.magnitude).toBe(3);
  });

  it('marks genuinely inconsistent fields as mixed and declines to guess a magnitude', () => {
    const rows: Row[] = [{ v: 1 }, { v: 'text' }, { v: [1] }];

    const stats = computeFieldStats('v', rows);

    expect(stats.shape).toBe('mixed');
    expect(stats.magnitude).toBeNull();
  });

  it('does not call a field mixed merely because some rows are blank', () => {
    const rows: Row[] = [{ v: 1 }, { v: null }, { v: 3 }];

    expect(computeFieldStats('v', rows).shape).toBe('numeric');
  });
});

describe('observedFields', () => {
  it('unions keys across rows and excludes Bright Data envelope fields', () => {
    const rows: Row[] = [
      { title: 'a', input: { url: 'u' }, warning: null },
      { price: 1, error: 'boom' },
    ];

    expect(observedFields(rows)).toEqual(['price', 'title']);
  });
});

describe('buildSnapshot', () => {
  const capturedAt = '2026-08-20T09:00:00.000Z';

  it('summarises a run into per-field statistics', () => {
    const rows: Row[] = [
      { title: 'One', points: 10 },
      { title: 'Two', points: null },
    ];

    const snapshot = buildSnapshot({ collectorId: 'c_test', capturedAt, rows });

    expect(snapshot.rowCount).toBe(2);
    expect(snapshot.fields.map((f) => f.field)).toEqual(['points', 'title']);
    expect(snapshot.fields.find((f) => f.field === 'points')?.rate).toBe(0.5);
  });

  it('includes declared schema fields that no row returned', () => {
    // Without the schema, a field absent from every row is indistinguishable
    // from a field that was never declared — so the disappearance is invisible.
    const rows: Row[] = [{ title: 'One' }];

    const snapshot = buildSnapshot({
      collectorId: 'c_test',
      capturedAt,
      rows,
      declaredFields: ['title', 'price', 'input', 'error'],
    });

    const price = snapshot.fields.find((f) => f.field === 'price');
    expect(price).toBeDefined();
    expect(price?.rate).toBe(0);

    // Envelope fields are never scored as data.
    expect(snapshot.fields.map((f) => f.field)).toEqual(['price', 'title']);
  });

  it('counts rows carrying a scraper error', () => {
    const rows: Row[] = [{ title: 'a' }, { title: null, error: 'timeout' }];

    expect(buildSnapshot({ collectorId: 'c_test', capturedAt, rows }).errorRows).toBe(1);
  });
});
