import { describe, expect, it } from 'vitest';

import { diagnose, HEAL_PROMPT_MAX_CHARS } from '@molt/diagnose';
import { buildSnapshot, compareSnapshots } from '@molt/health';

import { findExample, REPLAY_EXAMPLES } from '../content/playground/examples.js';

/**
 * The bundled drift-replay examples, run through the real detection core.
 *
 * Each example claims to demonstrate one specific classification. That claim is
 * a label in a data file, and a label is exactly the kind of thing that rots:
 * tweak a magnitude or drop a row and the example silently starts demonstrating
 * something else, or nothing at all. These tests assert the claim actually
 * holds against `compareSnapshots`.
 *
 * The pipeline here mirrors `runReplay` in the playground's server actions
 * deliberately — same fixed timestamps, same `declaredFields` derived from the
 * baseline — so what passes here is what a visitor sees.
 */

function replay(example: (typeof REPLAY_EXAMPLES)[number]) {
  const baseline = buildSnapshot({
    collectorId: 'c_playground',
    capturedAt: '2026-01-01T00:00:00.000Z',
    rows: example.baseline,
  });
  const candidate = buildSnapshot({
    collectorId: 'c_playground',
    capturedAt: '2026-01-02T00:00:00.000Z',
    rows: example.current,
    declaredFields: baseline.fields.map((field) => field.field),
  });
  return compareSnapshots(baseline, candidate);
}

describe('REPLAY_EXAMPLES', () => {
  it('has unique ids', () => {
    const ids = REPLAY_EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is findable by id, and not by a wrong one', () => {
    expect(findExample('zeroed')?.label).toBe('Field zeroed');
    expect(findExample('nope')).toBeNull();
  });

  it.each(REPLAY_EXAMPLES.filter((e) => e.expectedKind !== 'healthy'))(
    '$label actually produces a fault',
    (example) => {
      const report = replay(example);
      expect(report.status).not.toBe('healthy');
      expect(report.faults.length).toBeGreaterThan(0);
    },
  );

  it('the zeroed example is classified distorted, not degraded', () => {
    // The product's central claim. Fill rate is untouched at 100%; only the
    // magnitude comparison catches it.
    const report = replay(findExample('zeroed') as (typeof REPLAY_EXAMPLES)[number]);
    const finding = report.findings.find((f) => f.field === 'comment_count');

    expect(finding?.kind).toBe('distorted');
    if (finding?.kind === 'distorted') {
      expect(finding.rate).toBe(1);
      expect(finding.currentMagnitude).toBe(0);
    }
  });

  it('the collapsed example is classified collapsed', () => {
    const report = replay(findExample('collapsed') as (typeof REPLAY_EXAMPLES)[number]);
    expect(report.findings.find((f) => f.field === 'comment_count')?.kind).toBe('collapsed');
  });

  it('the degraded example is classified degraded, not collapsed', () => {
    // Half the rows still fill, which is above the 0.1 collapse ceiling but past
    // the 0.3 degrade drop. The two verdicts are one threshold apart, so this
    // guards the example from drifting across the line.
    const report = replay(findExample('degraded') as (typeof REPLAY_EXAMPLES)[number]);
    expect(report.findings.find((f) => f.field === 'comment_count')?.kind).toBe('degraded');
  });

  it('no example claims a verdict this pipeline cannot produce', () => {
    // `vanished` needs the field absent from the candidate's stats, which cannot
    // happen while `declaredFields` is derived from the baseline. An example
    // labelled `vanished` would be permanently wrong, so none exists.
    expect(REPLAY_EXAMPLES.map((e) => e.expectedKind)).not.toContain('vanished');
  });

  it('the flatlined example is classified flatlined', () => {
    // Needs at least 5 distinct baseline values to fire at all, which is why
    // that example carries six rows.
    const report = replay(findExample('flatlined') as (typeof REPLAY_EXAMPLES)[number]);
    expect(report.findings.find((f) => f.field === 'category')?.kind).toBe('flatlined');
  });

  it('the empty-harvest example sets the emptyHarvest flag', () => {
    const report = replay(findExample('empty-harvest') as (typeof REPLAY_EXAMPLES)[number]);
    expect(report.emptyHarvest).toBe(true);
  });

  it('the healthy example produces no faults at all', () => {
    // A detector that cannot stay quiet is useless, and this is the example that
    // proves the others are not just firing on everything.
    const report = replay(findExample('healthy') as (typeof REPLAY_EXAMPLES)[number]);
    expect(report.status).toBe('healthy');
    expect(report.faults).toHaveLength(0);
  });

  it.each(REPLAY_EXAMPLES.filter((e) => e.expectedKind !== 'healthy'))(
    '$label yields a heal prompt within the CLI character cap',
    (example) => {
      const report = replay(example);
      const diagnosis = diagnose(report);

      expect(diagnosis.prompt.length).toBeGreaterThan(0);
      expect(diagnosis.charCount).toBeLessThanOrEqual(HEAL_PROMPT_MAX_CHARS);
      expect(diagnosis.charCount).toBe(diagnosis.prompt.length);
    },
  );
});
