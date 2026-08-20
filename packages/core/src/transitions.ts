import type { IncidentState } from '@molt/store';

/**
 * The incident state machine, as a pure function.
 *
 * Separated from the engine that performs the effects, so every path — including
 * retry exhaustion and the rejection loop — is testable without a network, a
 * database or a clock. The engine's job is only to perform an action and feed
 * the outcome back in here.
 */

/** What just happened. Named for the outcome, not for the intent. */
export type Trigger =
  /** Begin composing a heal prompt from the evidence. */
  | 'diagnose.start'
  /** A prompt exists; the heal call is about to be made. */
  | 'heal.start'
  /** Heal stopped at the approval gate with a preview to review. */
  | 'heal.gate'
  /** Heal ran through to completion, because it was auto-approved. */
  | 'heal.done'
  /** The heal call itself failed, as distinct from proposing a bad fix. */
  | 'heal.failed'
  /**
   * The heal was refused because the collector already has an outstanding one
   * (HTTP 409). Nothing ran, so this is not a failed attempt — and retrying
   * cannot succeed until the pending heal is approved or rejected.
   */
  | 'heal.blocked'
  | 'approve.accepted'
  | 'approve.rejected'
  /** Re-running to find out whether the fix worked. */
  | 'verify.start'
  /** Fill rates recovered. */
  | 'verify.recovered'
  /** The fix did not work. */
  | 'verify.failed'
  /**
   * A check found the collector healthy while an incident was open — the site
   * was rolled back, or the breakage was transient.
   */
  | 'observed.healthy';

export interface TransitionRequest {
  readonly state: IncidentState;
  readonly trigger: Trigger;
  /** Heal attempts already spent on this incident. */
  readonly attempts: number;
  /** Ceiling on heal attempts. An unbounded loop is a credit incinerator. */
  readonly maxAttempts: number;
}

export type TransitionResult =
  | {
      readonly ok: true;
      readonly next: IncidentState;
      /** True when the incident should be stamped closed. */
      readonly closes: boolean;
      /** Added to the incident's attempt counter. */
      readonly attemptsDelta: number;
      readonly reason: string;
    }
  | {
      readonly ok: false;
      /** The trigger does not apply in this state; the caller should not act. */
      readonly reason: string;
    };

/** States from which no trigger is meaningful. */
const TERMINAL: readonly IncidentState[] = ['resolved', 'escalated'];

/** States a fresh diagnosis may start from. */
const DIAGNOSABLE: readonly IncidentState[] = ['detected', 'rejected', 'heal_failed'];

function advance(
  next: IncidentState,
  reason: string,
  options: { closes?: boolean; attemptsDelta?: number } = {},
): TransitionResult {
  return {
    ok: true,
    next,
    closes: options.closes ?? false,
    attemptsDelta: options.attemptsDelta ?? 0,
    reason,
  };
}

function refuse(reason: string): TransitionResult {
  return { ok: false, reason };
}

/**
 * Decide the next state.
 *
 * ```
 * detected → diagnosing → healing → awaiting_approval → approved → verifying → resolved
 *                            │              │                          │
 *                            │              └── rejected ──┐           │
 *                            └── heal_failed ──────────────┤           │
 *                                                          ↓           │
 *                                              diagnosing (retry) ←────┘
 *                                                          │
 *                                              escalated ←─┘ (attempts spent)
 * ```
 *
 * Written as an exhaustive `switch` over `Trigger` with no `default`, so adding a
 * trigger fails to compile until it is handled here.
 */
export function transition(request: TransitionRequest): TransitionResult {
  const { state, trigger, attempts, maxAttempts } = request;

  if (TERMINAL.includes(state)) {
    return refuse(`incident is already ${state}`);
  }

  // A collector that has come good outranks whatever was in progress. Checked
  // before the switch because it is valid from every non-terminal state.
  if (trigger === 'observed.healthy') {
    return advance('resolved', 'collector observed healthy while the incident was open', {
      closes: true,
    });
  }

  switch (trigger) {
    case 'diagnose.start':
      return DIAGNOSABLE.includes(state)
        ? advance('diagnosing', 'composing a heal prompt from the drift evidence')
        : refuse(`cannot start a diagnosis from ${state}`);

    case 'heal.start':
      if (state !== 'diagnosing') return refuse(`cannot heal from ${state}`);
      // Counted here rather than on completion, so a heal that crashes still
      // consumes an attempt and cannot loop forever.
      return attempts >= maxAttempts
        ? advance('escalated', `heal attempts exhausted (${attempts}/${maxAttempts})`, {
            closes: true,
          })
        : advance('healing', 'running bdata scraper heal', { attemptsDelta: 1 });

    case 'heal.gate':
      return state === 'healing'
        ? advance('awaiting_approval', 'heal stopped at the approval gate with a preview')
        : refuse(`no heal is in flight in ${state}`);

    case 'heal.done':
      return state === 'healing'
        ? advance('approved', 'heal completed without stopping at the gate')
        : refuse(`no heal is in flight in ${state}`);

    case 'heal.blocked':
      if (state !== 'healing') return refuse(`no heal is in flight in ${state}`);
      // Escalates immediately, and refunds the attempt that `heal.start` spent.
      // Nothing was attempted and no credits were used, so charging for it would
      // exhaust the budget on a condition that retrying cannot resolve. It needs
      // a person — or `molt unblock` — to clear the outstanding heal first.
      return advance(
        'escalated',
        'another heal is already pending on this collector; approve or reject it first',
        { closes: true, attemptsDelta: -1 },
      );

    case 'heal.failed':
      if (state !== 'healing') return refuse(`no heal is in flight in ${state}`);
      return attempts >= maxAttempts
        ? advance(
            'escalated',
            `heal failed and attempts are exhausted (${attempts}/${maxAttempts})`,
            {
              closes: true,
            },
          )
        : advance('heal_failed', 'the heal call failed; a retry is available');

    case 'approve.accepted':
      return state === 'awaiting_approval'
        ? advance('approved', 'fix approved')
        : refuse(`nothing is awaiting approval in ${state}`);

    case 'approve.rejected':
      if (state !== 'awaiting_approval') {
        return refuse(`nothing is awaiting approval in ${state}`);
      }
      // A rejection is a judgement about this fix, not about the incident. It
      // returns to the diagnosable set so a sharper prompt can be tried.
      return attempts >= maxAttempts
        ? advance(
            'escalated',
            `fix rejected and attempts are exhausted (${attempts}/${maxAttempts})`,
            {
              closes: true,
            },
          )
        : advance('rejected', 'fix rejected; re-diagnose with a sharper prompt');

    case 'verify.start':
      return state === 'approved'
        ? advance('verifying', 'checking whether fill rates actually recovered')
        : refuse(`cannot verify from ${state}`);

    case 'verify.recovered':
      return state === 'verifying'
        ? advance('resolved', 'fill rates recovered', { closes: true })
        : refuse(`no verification is in flight in ${state}`);

    case 'verify.failed':
      if (state !== 'verifying') return refuse(`no verification is in flight in ${state}`);
      // The crucial rule: an approved heal that did not restore the data is not
      // a success. The incident reopens for another attempt, or escalates.
      return attempts >= maxAttempts
        ? advance(
            'escalated',
            `the fix did not restore the data and attempts are exhausted (${attempts}/${maxAttempts})`,
            { closes: true },
          )
        : advance('detected', 'the fix did not restore the data; trying again');
  }
}

/** Whether an incident is waiting on a person. */
export function needsHuman(state: IncidentState): boolean {
  return state === 'awaiting_approval';
}

/**
 * The trigger that moves an incident forward unattended, if there is one.
 *
 * This is what `molt watch` consults: it walks each open incident and performs
 * the next action until the incident either closes or reaches the approval gate.
 * `awaiting_approval` deliberately returns null — the gate is the point.
 */
export function nextAutomaticTrigger(state: IncidentState): Trigger | null {
  switch (state) {
    case 'detected':
    case 'rejected':
    case 'heal_failed':
      return 'diagnose.start';
    case 'diagnosing':
      return 'heal.start';
    case 'approved':
      return 'verify.start';
    case 'healing':
    case 'verifying':
      // An action is already in flight; its outcome supplies the next trigger.
      return null;
    case 'awaiting_approval':
    case 'resolved':
    case 'escalated':
      return null;
  }
}
