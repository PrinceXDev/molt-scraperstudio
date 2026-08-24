/**
 * A fixed-window, in-memory rate limiter.
 *
 * Scoped honestly: this is per-server-process memory, so it does not hold across
 * a restart and does not coordinate between instances behind a load balancer. It
 * is not a defence against a determined attacker — it is a brake, so a single
 * visitor holding down a button cannot turn the playground's preflight tab into
 * an outbound request amplifier, and so the live-check tab cannot burn credits
 * faster than a person could reasonably mean to.
 *
 * A fixed window rather than a token bucket or sliding log because the failure
 * mode of a fixed window (a caller getting up to 2x the nominal rate across a
 * boundary) is irrelevant at these limits, and it costs one integer per key
 * instead of an array of timestamps.
 */

interface Window {
  count: number;
  /** Epoch millis at which this window expires and the count resets. */
  resetAt: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Requests still available in the current window. */
  readonly remaining: number;
  /** Seconds until the window resets. Only meaningful when `allowed` is false. */
  readonly retryAfterSeconds: number;
}

export interface RateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * Sweep threshold.
 *
 * Expired entries are cleaned opportunistically when the map grows past this,
 * rather than on a timer: a `setInterval` in a module like this survives into
 * every serverless invocation and keeps a process alive that would otherwise be
 * free to shut down.
 */
const SWEEP_AT_SIZE = 5_000;

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: RateLimitOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
  }

  /**
   * Record an attempt against `key` and say whether it is allowed.
   *
   * `now` is injectable so the behaviour at a window boundary can be tested
   * without sleeping — the same clock-as-a-parameter discipline
   * `packages/health` follows.
   */
  check(key: string, now: number = Date.now()): RateLimitResult {
    if (this.windows.size > SWEEP_AT_SIZE) this.sweep(now);

    const existing = this.windows.get(key);

    if (existing === undefined || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return { allowed: true, remaining: this.limit - existing.count, retryAfterSeconds: 0 };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * The preflight limiter: real outbound requests, but free and fast.
 *
 * Two fetches per call (the page and its robots.txt), so 15/minute is at most 30
 * outbound requests a minute from one caller — enough that nobody legitimately
 * exploring targets ever notices it, low enough that it is not a useful
 * amplifier.
 */
export const preflightLimiter = new RateLimiter({ limit: 15, windowMs: 60_000 });

/**
 * The live-check limiter: spends real Bright Data credits.
 *
 * Deliberately harsh. Three per fifteen minutes is enough to demonstrate the
 * loop and nowhere near enough to run a bill up by accident.
 */
export const liveCheckLimiter = new RateLimiter({ limit: 3, windowMs: 15 * 60_000 });

/**
 * The create limiter: the harshest by far, and for a different reason than cost.
 *
 * A live check touches a collector that already exists. A create spends an
 * AI-Flow job on a *new* one, and a failed attempt leaves an orphan that has to
 * be deleted by hand in the dashboard — the constraint this whole limiter exists
 * to respect. One per caller per hour is not a throughput number; it is "slow
 * enough that a person, not a script, is on the other end of each attempt."
 *
 * Exported as named constants, not inlined, so a test can assert the actual
 * safety property (`CREATE_LIMIT` stays at 1, `CREATE_WINDOW_MS` stays measured
 * in hours) rather than just that *some* limiter exists.
 */
export const CREATE_LIMIT = 1;
export const CREATE_WINDOW_MS = 60 * 60_000;
export const createLimiter = new RateLimiter({ limit: CREATE_LIMIT, windowMs: CREATE_WINDOW_MS });
