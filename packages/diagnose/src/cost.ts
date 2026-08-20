/**
 * Cost of silence — how long an incident served bad data, and to how many
 * runs, before anyone acted on it.
 *
 * Molt's whole premise is that a scraper can look perfectly healthy — HTTP
 * 200, job `done`, unchanged row count — while the data is quietly wrong.
 * `HealthReport.summary` says *what* broke; this says *how expensive the
 * silence was*, in the two units that actually matter: wall-clock time, and
 * the number of downstream consumers (runs) that were served the bad rows
 * while nobody had acted.
 *
 * Pure, like the rest of this package: every timestamp is supplied by the
 * caller rather than read from the clock, so the same three inputs always
 * produce the same duration and the result is testable without a database.
 */

export interface CostOfSilence {
  readonly openedAt: string;
  /** `null` while the incident is still open. */
  readonly resolvedAt: string | null;
  readonly durationMs: number;
  /** A human-readable duration, e.g. `14h 32m` or `3d 2h`. */
  readonly duration: string;
  /**
   * Runs that observed the collector still broken while the incident was
   * open — the number of times bad data was actually served, as distinct
   * from how long it took to notice.
   */
  readonly badRuns: number;
  readonly ongoing: boolean;
}

export interface CostOfSilenceInput {
  readonly openedAt: string;
  readonly closedAt: string | null;
  /** The instant to measure against when the incident is still open. */
  readonly now: string;
  /** Count of `detected` + `observed.still-broken` events on this incident. */
  readonly badRuns: number;
}

/** Compute the cost-of-silence summary for one incident. */
export function costOfSilence(input: CostOfSilenceInput): CostOfSilence {
  const openedAt = input.openedAt;
  const resolvedAt = input.closedAt;
  const ongoing = resolvedAt === null;

  const start = new Date(openedAt).getTime();
  const end = new Date(resolvedAt ?? input.now).getTime();
  const durationMs = Math.max(0, end - start);

  return {
    openedAt,
    resolvedAt,
    durationMs,
    duration: formatDuration(durationMs),
    badRuns: Math.max(0, input.badRuns),
    ongoing,
  };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Render a millisecond duration as the largest two units that matter —
 * `3d 4h`, `14h 32m`, `9m 12s`, `45s` — never more precise than seconds and
 * never so precise that a multi-day incident reports its age down to the
 * second.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000)) * 1000;

  if (total < MINUTE_MS) {
    return `${String(Math.round(total / 1000))}s`;
  }

  if (total < HOUR_MS) {
    const minutes = Math.floor(total / MINUTE_MS);
    const seconds = Math.round((total % MINUTE_MS) / 1000);
    return seconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds)}s`;
  }

  if (total < DAY_MS) {
    const hours = Math.floor(total / HOUR_MS);
    const minutes = Math.round((total % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
  }

  const days = Math.floor(total / DAY_MS);
  const hours = Math.round((total % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${String(days)}d` : `${String(days)}d ${String(hours)}h`;
}

/** One line for an incident timeline or a CLI banner. */
export function describeCostOfSilence(cost: CostOfSilence): string {
  const runsText = cost.badRuns === 1 ? '1 run' : `${String(cost.badRuns)} runs`;

  return cost.ongoing
    ? `data has been wrong for ${cost.duration} so far, across ${runsText}`
    : `data was wrong for ${cost.duration}, across ${runsText}`;
}
