/**
 * Prompt learning — what past heals teach the next diagnosis.
 *
 * Every incident already records its heal prompt, how many attempts it burned,
 * and whether it resolved. That history is a labelled dataset: prompts that
 * landed on the first attempt versus prompts that needed retries or escalated.
 * This module mines it for one deterministic signal and feeds the result back
 * into `diagnose()` as a preference.
 *
 * Deliberately modest. There is exactly one learnable feature today — whether
 * the prompt named the *unaffected* fields — because it is the one section the
 * template can legitimately vary (it is the only optional section, and the
 * budget logic already drops it under pressure). Learning a weight for a
 * section that is `required` would be theatre.
 *
 * Pure, like everything else in this package: outcomes in, preference out.
 * The same history always yields the same preference, so the behaviour is
 * pinned by fixtures rather than by faith.
 */

/** One finished heal, reduced to what the learner needs. */
export interface HealAttemptOutcome {
  /** The prompt that was sent to `bdata scraper heal`. */
  readonly prompt: string;
  /** True when the incident closed as `resolved` (measured recovery). */
  readonly resolved: boolean;
  /** Heal attempts the incident consumed. */
  readonly attempts: number;
}

/** Features of a prompt the learner can currently distinguish. */
export interface PromptFeatures {
  /** Did the prompt name the fields that still work? */
  readonly mentionsUnaffected: boolean;
}

/**
 * What history says the next prompt should look like.
 *
 * `null` means "no opinion": the history is too thin, or the feature made no
 * measurable difference. A null preference leaves `diagnose()` exactly as it
 * was, which is the safe default — the template path must never get worse
 * because the learner is uncertain.
 */
export interface PromptPreferences {
  readonly preferUnaffected: boolean | null;
  /** How many outcomes the preference was learned from. */
  readonly sampleSize: number;
}

export const NO_PREFERENCES: PromptPreferences = { preferUnaffected: null, sampleSize: 0 };

/**
 * Outcomes required on *each side* of a feature before it earns an opinion.
 *
 * Three-versus-three is the floor at which a difference in success rate stops
 * being a coin flip worth acting on. Below it the learner stays silent.
 */
export const MIN_LEARNING_SAMPLE = 3;

/** Extract the learnable features of a prompt. */
export function promptFeaturesOf(prompt: string): PromptFeatures {
  return {
    // The template's own wording ("…are unaffected and still extracting
    // normally") — and any human-authored prompt that uses the word.
    mentionsUnaffected: /unaffected/i.test(prompt),
  };
}

/**
 * A heal that landed first time: resolved without spending a second attempt.
 *
 * This is the metric that matters. A prompt that resolved on attempt two still
 * cost a full heal's worth of credits and a second trip through the gate.
 */
export function isFirstTrySuccess(outcome: HealAttemptOutcome): boolean {
  return outcome.resolved && outcome.attempts <= 1;
}

/**
 * Learn preferences from past heal outcomes.
 *
 * The rule: compare first-try success rates with and without each feature.
 * Only express an opinion when both sides have at least
 * {@link MIN_LEARNING_SAMPLE} outcomes *and* the rates actually differ —
 * otherwise the honest answer is "no opinion", never a guess.
 */
export function learnPromptPreferences(outcomes: readonly HealAttemptOutcome[]): PromptPreferences {
  const withFeature: HealAttemptOutcome[] = [];
  const withoutFeature: HealAttemptOutcome[] = [];

  for (const outcome of outcomes) {
    (promptFeaturesOf(outcome.prompt).mentionsUnaffected ? withFeature : withoutFeature).push(
      outcome,
    );
  }

  if (withFeature.length < MIN_LEARNING_SAMPLE || withoutFeature.length < MIN_LEARNING_SAMPLE) {
    return { preferUnaffected: null, sampleSize: outcomes.length };
  }

  const rateWith = successRate(withFeature);
  const rateWithout = successRate(withoutFeature);

  return {
    preferUnaffected: rateWith === rateWithout ? null : rateWith > rateWithout,
    sampleSize: outcomes.length,
  };
}

function successRate(outcomes: readonly HealAttemptOutcome[]): number {
  return outcomes.filter(isFirstTrySuccess).length / outcomes.length;
}
