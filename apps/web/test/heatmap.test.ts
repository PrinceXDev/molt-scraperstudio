import { describe, expect, it } from 'vitest';

import {
  cellBgClass,
  cellClasses,
  cellLabel,
  cellOpacityClass,
  cellSeverity,
  type Cell,
  type CellKind,
} from '../lib/heatmap.js';

function cell(kind: CellKind, rate = 1, magnitude: number | null = 42): Cell {
  return { kind, rate, magnitude };
}

const ALL_KINDS: readonly CellKind[] = [
  'healthy',
  'appeared',
  'degraded',
  'distorted',
  'flatlined',
  'collapsed',
  'vanished',
];

/**
 * The rule these tests protect is the product's central claim, and it has
 * already shipped broken once — the web UI's own Fleet page showed a
 * false-green fill rate for a zeroed field.
 *
 * It was also, until this phase, implemented three times: once in `lib/heatmap`
 * (dead) and once per page. These tests exist so the single surviving copy
 * cannot regress quietly.
 */
describe('cellSeverity', () => {
  it('classifies a zeroed field as bad, not warn', () => {
    // A field returning 0 instead of its real value is present on every row.
    // Fill rate says 100%. It is broken.
    expect(cellSeverity(cell('distorted', 1, 0))).toBe('bad');
    expect(cellBgClass(cell('distorted', 1, 0))).toBe('bg-bad');
    expect(cellOpacityClass(cell('distorted', 1, 0))).toBe('opacity-100');
  });

  it('still treats a non-zero magnitude distortion as a warning', () => {
    // The zeroing case is special. Ordinary magnitude drift is not.
    expect(cellSeverity(cell('distorted', 1, 19.99))).toBe('warn');
  });

  it('does not mistake a null magnitude for zero', () => {
    // `null` means "not a numeric field", which is not the same claim as
    // "this number collapsed to zero". A loose == check here would conflate them.
    expect(cellSeverity(cell('distorted', 1, null))).toBe('warn');
  });

  it('maps every kind to a severity', () => {
    for (const kind of ALL_KINDS) {
      expect(cellSeverity(cell(kind))).not.toBe('unknown');
    }
  });

  it('reports a missing cell as unknown rather than healthy', () => {
    // Gaps in the run history are absence of evidence, and must not read green.
    expect(cellSeverity(undefined)).toBe('unknown');
    expect(cellBgClass(undefined)).toBe('bg-line-soft');
    expect(cellOpacityClass(undefined)).toBe('opacity-30');
  });

  it('holds healthy and appeared back so faults are the loudest thing on screen', () => {
    expect(cellOpacityClass(cell('healthy'))).toBe('opacity-55');
    expect(cellOpacityClass(cell('appeared'))).toBe('opacity-55');
    expect(cellOpacityClass(cell('collapsed'))).toBe('opacity-100');
  });
});

describe('cellBgClass', () => {
  it('returns literal class names, not computed values', () => {
    // Tailwind's scanner reads source text. A class assembled at runtime from a
    // token would never make it into the stylesheet, which is why these are
    // fixed strings and why this assertion is worth having.
    for (const kind of ALL_KINDS) {
      expect(cellBgClass(cell(kind))).toMatch(/^bg-(good|info|warn|bad)$/);
    }
  });
});

describe('cellClasses', () => {
  it('combines background and opacity', () => {
    expect(cellClasses(cell('healthy'))).toBe('bg-good opacity-55');
    expect(cellClasses(cell('distorted', 1, 0))).toBe('bg-bad opacity-100');
    expect(cellClasses(undefined)).toBe('bg-line-soft opacity-30');
  });
});

describe('cellLabel', () => {
  it('never shows a percentage for a zeroed field', () => {
    // 100% is technically the fill rate and is exactly the wrong thing to print.
    expect(cellLabel(cell('distorted', 1, 0))).toBe('ZEROED');
  });

  it('names the other non-numeric verdicts', () => {
    expect(cellLabel(cell('flatlined'))).toBe('FLAT');
    expect(cellLabel(cell('vanished', 0))).toBe('GONE');
    expect(cellLabel(undefined)).toBe('—');
  });

  it('shows a rounded fill rate for everything else', () => {
    expect(cellLabel(cell('healthy', 1))).toBe('100%');
    expect(cellLabel(cell('degraded', 0.416))).toBe('42%');
  });
});
