import type { IncidentState } from '@molt/store';
import { describe, expect, it } from 'vitest';

import { nextAutomaticTrigger, needsHuman, transition, type Trigger } from '../src/transitions.js';

const MAX = 2;

function step(state: IncidentState, trigger: Trigger, attempts = 0) {
  return transition({ state, trigger, attempts, maxAttempts: MAX });
}

/** Assert a transition succeeded and return it narrowed. */
function ok(result: ReturnType<typeof transition>) {
  expect(result.ok, result.ok ? '' : result.reason).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('the happy path', () => {
  it('walks detected → resolved through the approval gate', () => {
    const diagnosing = ok(step('detected', 'diagnose.start'));
    expect(diagnosing.next).toBe('diagnosing');
    expect(diagnosing.attemptsDelta).toBe(0);

    const healing = ok(step('diagnosing', 'heal.start'));
    expect(healing.next).toBe('healing');
    // The attempt is spent when the heal starts, not when it finishes, so a
    // crash mid-heal still consumes one.
    expect(healing.attemptsDelta).toBe(1);

    const gate = ok(step('healing', 'heal.gate', 1));
    expect(gate.next).toBe('awaiting_approval');
    expect(needsHuman(gate.next)).toBe(true);

    const approved = ok(step('awaiting_approval', 'approve.accepted', 1));
    expect(approved.next).toBe('approved');

    const verifying = ok(step('approved', 'verify.start', 1));
    expect(verifying.next).toBe('verifying');

    const resolved = ok(step('verifying', 'verify.recovered', 1));
    expect(resolved.next).toBe('resolved');
    expect(resolved.closes).toBe(true);
  });

  it('allows an auto-approved heal to skip the gate', () => {
    const approved = ok(step('healing', 'heal.done', 1));
    expect(approved.next).toBe('approved');
    expect(approved.closes).toBe(false);
  });

  it('closes nothing before the data is verified', () => {
    // The rule that matters most: approval is not success. Only a measured
    // recovery closes an incident.
    for (const state of ['diagnosing', 'healing', 'awaiting_approval', 'approved'] as const) {
      const trigger = nextAutomaticTrigger(state);
      if (trigger === null) continue;
      expect(ok(step(state, trigger, 1)).closes).toBe(false);
    }
  });
});

describe('an approved fix that did not work', () => {
  it('reopens rather than closing', () => {
    const reopened = ok(step('verifying', 'verify.failed', 1));

    expect(reopened.next).toBe('detected');
    expect(reopened.closes).toBe(false);
  });

  it('escalates once attempts are spent', () => {
    const escalated = ok(step('verifying', 'verify.failed', MAX));

    expect(escalated.next).toBe('escalated');
    expect(escalated.closes).toBe(true);
    expect(escalated.reason).toContain('did not restore the data');
  });
});

describe('rejection', () => {
  it('returns to the diagnosable set so a sharper prompt can be tried', () => {
    const rejected = ok(step('awaiting_approval', 'approve.rejected', 1));
    expect(rejected.next).toBe('rejected');
    expect(rejected.closes).toBe(false);

    // And a rejected incident can be diagnosed again.
    expect(ok(step('rejected', 'diagnose.start', 1)).next).toBe('diagnosing');
  });

  it('escalates when there is no attempt left to spend', () => {
    const escalated = ok(step('awaiting_approval', 'approve.rejected', MAX));
    expect(escalated.next).toBe('escalated');
    expect(escalated.closes).toBe(true);
  });
});

describe('a failing heal call', () => {
  it('is distinguished from a bad fix and stays retryable', () => {
    const failed = ok(step('healing', 'heal.failed', 1));
    expect(failed.next).toBe('heal_failed');
    expect(failed.closes).toBe(false);
    expect(ok(step('heal_failed', 'diagnose.start', 1)).next).toBe('diagnosing');
  });

  it('escalates when attempts are exhausted', () => {
    expect(ok(step('healing', 'heal.failed', MAX)).next).toBe('escalated');
  });
});

describe('a heal blocked by another pending heal', () => {
  it('escalates immediately and refunds the attempt', () => {
    // Scraper Studio allows one refactor job per collector and returns 409.
    // Nothing ran and no credits were spent, so charging an attempt would
    // exhaust the budget on a condition retrying cannot resolve.
    const blocked = ok(step('healing', 'heal.blocked', 1));

    expect(blocked.next).toBe('escalated');
    expect(blocked.closes).toBe(true);
    expect(blocked.attemptsDelta).toBe(-1);
    expect(blocked.reason).toContain('already pending');
  });

  it('is refused when no heal is in flight', () => {
    expect(step('detected', 'heal.blocked').ok).toBe(false);
    expect(step('awaiting_approval', 'heal.blocked', 1).ok).toBe(false);
  });
});

describe('the attempt ceiling', () => {
  it('refuses to start another heal once spent', () => {
    // Without this, a scraper the AI cannot fix would be healed forever and
    // burn credits until the account ran dry.
    const escalated = ok(step('diagnosing', 'heal.start', MAX));

    expect(escalated.next).toBe('escalated');
    expect(escalated.closes).toBe(true);
    expect(escalated.attemptsDelta).toBe(0);
    expect(escalated.reason).toContain('exhausted');
  });

  it('permits exactly maxAttempts heals', () => {
    expect(ok(step('diagnosing', 'heal.start', 0)).next).toBe('healing');
    expect(ok(step('diagnosing', 'heal.start', MAX - 1)).next).toBe('healing');
    expect(ok(step('diagnosing', 'heal.start', MAX)).next).toBe('escalated');
  });
});

describe('a collector that comes good on its own', () => {
  it('resolves from any live state', () => {
    const live: IncidentState[] = [
      'detected',
      'diagnosing',
      'healing',
      'awaiting_approval',
      'approved',
      'verifying',
      'rejected',
      'heal_failed',
    ];

    for (const state of live) {
      const result = ok(step(state, 'observed.healthy', 1));
      expect(result.next, `from ${state}`).toBe('resolved');
      expect(result.closes).toBe(true);
    }
  });
});

describe('invalid transitions', () => {
  it('refuses every trigger once terminal', () => {
    const triggers: Trigger[] = [
      'diagnose.start',
      'heal.start',
      'heal.gate',
      'heal.done',
      'heal.failed',
      'heal.blocked',
      'approve.accepted',
      'approve.rejected',
      'verify.start',
      'verify.recovered',
      'verify.failed',
      'observed.healthy',
    ];

    for (const state of ['resolved', 'escalated'] as const) {
      for (const trigger of triggers) {
        const result = step(state, trigger, 1);
        expect(result.ok, `${state} + ${trigger} should be refused`).toBe(false);
      }
    }
  });

  it('refuses approving something that is not at the gate', () => {
    expect(step('detected', 'approve.accepted').ok).toBe(false);
    expect(step('healing', 'approve.accepted', 1).ok).toBe(false);
  });

  it('refuses verifying something unapproved', () => {
    expect(step('detected', 'verify.start').ok).toBe(false);
    expect(step('awaiting_approval', 'verify.start', 1).ok).toBe(false);
  });

  it('refuses healing straight from detected, without a diagnosis', () => {
    // A heal with no generated prompt is the exact shortcut this project exists
    // to avoid.
    expect(step('detected', 'heal.start').ok).toBe(false);
  });

  it('explains itself when refusing', () => {
    const result = step('detected', 'heal.gate');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('detected');
  });
});

describe('nextAutomaticTrigger', () => {
  it('drives the unattended path', () => {
    expect(nextAutomaticTrigger('detected')).toBe('diagnose.start');
    expect(nextAutomaticTrigger('diagnosing')).toBe('heal.start');
    expect(nextAutomaticTrigger('approved')).toBe('verify.start');
    expect(nextAutomaticTrigger('rejected')).toBe('diagnose.start');
    expect(nextAutomaticTrigger('heal_failed')).toBe('diagnose.start');
  });

  it('stops at the approval gate', () => {
    // The gate is the product, not an obstacle to route around.
    expect(nextAutomaticTrigger('awaiting_approval')).toBeNull();
    expect(needsHuman('awaiting_approval')).toBe(true);
  });

  it('waits while an action is in flight', () => {
    expect(nextAutomaticTrigger('healing')).toBeNull();
    expect(nextAutomaticTrigger('verifying')).toBeNull();
  });

  it('does nothing for terminal states', () => {
    expect(nextAutomaticTrigger('resolved')).toBeNull();
    expect(nextAutomaticTrigger('escalated')).toBeNull();
  });
});

describe('the full retry loop converges', () => {
  it('reaches escalated rather than looping forever', () => {
    // Drive the machine the way `molt watch` would, always taking the automatic
    // trigger and always failing the verify, and assert it terminates.
    let state: IncidentState = 'detected';
    let attempts = 0;
    let steps = 0;

    while (state !== 'escalated' && state !== 'resolved' && steps < 50) {
      steps += 1;

      const auto = nextAutomaticTrigger(state);
      const trigger: Trigger =
        auto ??
        (state === 'healing' ? 'heal.done' : state === 'verifying' ? 'verify.failed' : 'heal.done');

      const result = transition({ state, trigger, attempts, maxAttempts: MAX });
      if (!result.ok) throw new Error(`stuck in ${state}: ${result.reason}`);

      state = result.next;
      attempts += result.attemptsDelta;
    }

    expect(state).toBe('escalated');
    expect(attempts).toBeLessThanOrEqual(MAX);
    expect(steps).toBeLessThan(50);
  });
});
