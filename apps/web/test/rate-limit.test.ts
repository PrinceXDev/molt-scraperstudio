import { describe, expect, it } from 'vitest';

import { CREATE_LIMIT, CREATE_WINDOW_MS, RateLimiter } from '../lib/rate-limit.js';

/**
 * The rate limiter.
 *
 * `check` takes an injectable `now` so the window boundary can be tested without
 * sleeping — the same clock-as-a-parameter discipline `packages/health` follows,
 * and the reason these tests run in single-digit milliseconds instead of minutes.
 */

describe('RateLimiter', () => {
  it('allows up to the limit and then refuses', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });

    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 0).allowed).toBe(false);
  });

  it('reports remaining allowance as it counts down', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });

    expect(limiter.check('a', 0).remaining).toBe(2);
    expect(limiter.check('a', 0).remaining).toBe(1);
    expect(limiter.check('a', 0).remaining).toBe(0);
    expect(limiter.check('a', 0).remaining).toBe(0);
  });

  it('keys are independent', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });

    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 0).allowed).toBe(false);
    // A different caller is unaffected by the first one exhausting its window.
    expect(limiter.check('b', 0).allowed).toBe(true);
  });

  it('resets once the window has elapsed', () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 1_000 });

    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 500).allowed).toBe(true);
    expect(limiter.check('a', 900).allowed).toBe(false);

    // The window opened at t=0 and closes at t=1000.
    expect(limiter.check('a', 1_000).allowed).toBe(true);
    expect(limiter.check('a', 1_100).allowed).toBe(true);
    expect(limiter.check('a', 1_200).allowed).toBe(false);
  });

  it('reports a retry-after that never rounds down to zero', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 10_000 });
    limiter.check('a', 0);

    // 9.999s in, there is 1ms left — reporting "retry in 0s" would invite an
    // immediate retry that fails again.
    const result = limiter.check('a', 9_999);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(1);
  });

  it('reports retry-after in whole seconds, rounded up', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.check('a', 0);

    expect(limiter.check('a', 0).retryAfterSeconds).toBe(60);
    expect(limiter.check('a', 30_000).retryAfterSeconds).toBe(30);
    expect(limiter.check('a', 59_500).retryAfterSeconds).toBe(1);
  });

  it('reports no retry delay when the request was allowed', () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.check('a', 0).retryAfterSeconds).toBe(0);
  });
});

/**
 * The safety property `createLimiter` exists to enforce, pinned as a test
 * rather than left as a number someone could loosen in a later "just bump the
 * limit a bit" edit without noticing what it actually protects: a failed
 * create leaves a non-deletable orphan on the connected Bright Data account,
 * so this is deliberately not a throughput limit — it is "at most one attempt
 * per caller, and not again for an hour."
 */
describe('createLimiter safety constants', () => {
  it('allows exactly one attempt', () => {
    expect(CREATE_LIMIT).toBe(1);
  });

  it('holds the window to at least an hour', () => {
    expect(CREATE_WINDOW_MS).toBeGreaterThanOrEqual(60 * 60_000);
  });
});
