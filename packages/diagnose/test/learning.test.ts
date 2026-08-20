import { describe, expect, it } from 'vitest';

import { buildSnapshot, compareSnapshots, type Row } from '@molt/health';

import {
  diagnose,
  isFirstTrySuccess,
  learnPromptPreferences,
  promptFeaturesOf,
  type HealAttemptOutcome,
} from '../src/index.js';

/**
 * The prompt learner.
 *
 * Outcomes in, preference out — pure, so every rule here is pinned without a
 * database or a single real incident.
 */

function outcome(overrides: Partial<HealAttemptOutcome> = {}): HealAttemptOutcome {
  return {
    prompt: 'Field `points` returns empty. Re-capture points from the current markup.',
    resolved: true,
    attempts: 1,
    ...overrides,
  };
}

const WITH_UNAFFECTED =
  'Field `points` returns empty. Re-capture points. ' +
  'Fields `title` and `url` are unaffected and still extracting normally — leave them as they are.';

describe('promptFeaturesOf', () => {
  it('recognises the unaffected-fields section', () => {
    expect(promptFeaturesOf(WITH_UNAFFECTED).mentionsUnaffected).toBe(true);
    expect(promptFeaturesOf('Re-capture points.').mentionsUnaffected).toBe(false);
  });
});

describe('isFirstTrySuccess', () => {
  it('requires resolution within a single attempt', () => {
    expect(isFirstTrySuccess(outcome())).toBe(true);
    expect(isFirstTrySuccess(outcome({ attempts: 2 }))).toBe(false);
    expect(isFirstTrySuccess(outcome({ resolved: false }))).toBe(false);
  });
});

describe('learnPromptPreferences', () => {
  it('has no opinion on an empty or thin history', () => {
    expect(learnPromptPreferences([]).preferUnaffected).toBeNull();

    // Plenty of one side, none of the other: still no opinion. A difference
    // cannot be measured against an empty control group.
    const oneSided = Array.from({ length: 10 }, () => outcome({ prompt: WITH_UNAFFECTED }));
    expect(learnPromptPreferences(oneSided).preferUnaffected).toBeNull();
  });

  it('prefers the unaffected section when history says it lands first-try', () => {
    const history: HealAttemptOutcome[] = [
      // With the section: all first-try.
      outcome({ prompt: WITH_UNAFFECTED }),
      outcome({ prompt: WITH_UNAFFECTED }),
      outcome({ prompt: WITH_UNAFFECTED }),
      // Without: needed retries or escalated.
      outcome({ attempts: 2 }),
      outcome({ resolved: false, attempts: 2 }),
      outcome({ attempts: 1 }),
    ];

    const preferences = learnPromptPreferences(history);

    expect(preferences.preferUnaffected).toBe(true);
    expect(preferences.sampleSize).toBe(6);
  });

  it('turns against the section when history says it hurts', () => {
    const history: HealAttemptOutcome[] = [
      outcome({ prompt: WITH_UNAFFECTED, resolved: false, attempts: 2 }),
      outcome({ prompt: WITH_UNAFFECTED, attempts: 2 }),
      outcome({ prompt: WITH_UNAFFECTED, resolved: false, attempts: 2 }),
      outcome(),
      outcome(),
      outcome(),
    ];

    expect(learnPromptPreferences(history).preferUnaffected).toBe(false);
  });

  it('stays silent when the feature makes no measurable difference', () => {
    const history: HealAttemptOutcome[] = [
      outcome({ prompt: WITH_UNAFFECTED }),
      outcome({ prompt: WITH_UNAFFECTED }),
      outcome({ prompt: WITH_UNAFFECTED, resolved: false }),
      outcome(),
      outcome(),
      outcome({ resolved: false }),
    ];

    expect(learnPromptPreferences(history).preferUnaffected).toBeNull();
  });
});

describe('diagnose with learned preferences', () => {
  const BASELINE_AT = '2026-08-17T03:00:00.000Z';
  const CANDIDATE_AT = '2026-08-20T03:00:00.000Z';

  function report() {
    // Three different fault families plus healthy fields, so the prompt has
    // several optional sections competing for the budget.
    const healthy: Row[] = Array.from({ length: 30 }, (_, i) => ({
      title: `Story ${i}`,
      url: `https://example.com/${i}`,
      points: 40 + i,
      downloads: 20_000 + i,
      rating: 3 + (i % 3),
    }));
    const broken = healthy.map((row, i) => ({
      ...row,
      points: null, // collapsed
      downloads: 0, // zeroed → distorted
      rating: i < 12 ? row['rating'] : null, // degraded
    }));

    return compareSnapshots(
      buildSnapshot({ collectorId: 'c_moltdemo0001', capturedAt: BASELINE_AT, rows: healthy }),
      buildSnapshot({ collectorId: 'c_moltdemo0001', capturedAt: CANDIDATE_AT, rows: broken }),
    );
  }

  it('drops the unaffected section when history says it hurts', () => {
    const withDefault = diagnose(report());
    expect(withDefault.prompt).toContain('unaffected');

    const withAversion = diagnose(report(), {
      preferences: { preferUnaffected: false, sampleSize: 8 },
    });

    expect(withAversion.prompt).not.toContain('unaffected');
    // The evidence and the instruction are untouched.
    expect(withAversion.prompt).toContain('Re-capture');
  });

  it('keeps the section under budget pressure when history favours it', () => {
    // A budget one character short of the full prompt: something has to go.
    // With the default weighting, the unaffected section (weight 10) is the
    // first sacrifice. With the learned preference it fights ahead of
    // lower-priority fault detail, which loses instead.
    const budget = diagnose(report()).charCount - 1;

    const withDefault = diagnose(report(), { maxChars: budget });
    expect(withDefault.prompt).not.toContain('unaffected');

    const withPreference = diagnose(report(), {
      maxChars: budget,
      preferences: { preferUnaffected: true, sampleSize: 8 },
    });

    expect(withPreference.prompt).toContain('unaffected');
    expect(withPreference.charCount).toBeLessThanOrEqual(budget);
  });

  it('behaves exactly as before when the learner has no opinion', () => {
    const withDefault = diagnose(report());
    const withNull = diagnose(report(), {
      preferences: { preferUnaffected: null, sampleSize: 2 },
    });

    expect(withNull.prompt).toBe(withDefault.prompt);
  });
});
