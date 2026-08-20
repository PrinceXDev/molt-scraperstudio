import type {
  ApproveEnvelope,
  CommandRecord,
  CreateEnvelope,
  HealEnvelope,
  UnknownRecord,
} from '@molt/brightdata';

/**
 * The effects the engine needs, as interfaces.
 *
 * Dependency inversion with a purpose: the whole incident lifecycle can be
 * driven by a fake `ScraperPort` in tests, so every branch — the approval gate,
 * a rejected fix, a heal that fails, a verify that proves the fix did not work —
 * is exercised with no API key, no network and no credits spent.
 */

export interface RunOutcome {
  /** Rows exactly as the collector returned them, before projection. */
  readonly rows: readonly UnknownRecord[];
  readonly command: CommandRecord;
  readonly ok: boolean;
}

export interface HealOutcome {
  readonly envelope: HealEnvelope;
  readonly command: CommandRecord;
  /** Sample rows the fixed scraper would produce, from `preview_result`. */
  readonly previewRows: readonly UnknownRecord[];
}

export interface ApproveOutcome {
  readonly envelope: ApproveEnvelope;
  readonly command: CommandRecord;
}

export interface CreateOutcome {
  readonly envelope: CreateEnvelope;
  readonly command: CommandRecord;
}

export interface RunRequest {
  readonly collectorId: string;
  readonly url: string;
}

export interface HealRequest {
  readonly collectorId: string;
  /** Composed by `@molt/diagnose`. Never longer than 1,000 characters. */
  readonly prompt: string;
  readonly url: string;
}

export interface ApproveRequest {
  readonly collectorId: string;
  readonly url: string;
  /** Reject the proposed fix instead of committing it. */
  readonly reject?: boolean;
}

export interface CreateRequest {
  readonly url: string;
  /** What to extract, in plain language. The CLI caps this at 500 chars. */
  readonly description: string;
}

/** Everything Molt does to a Bright Data collector. */
export interface ScraperPort {
  run(request: RunRequest): Promise<RunOutcome>;
  heal(request: HealRequest): Promise<HealOutcome>;
  approve(request: ApproveRequest): Promise<ApproveOutcome>;
  /** Generate a brand-new collector. An AI-Flow job: 5–25 minutes, serialised. */
  create(request: CreateRequest): Promise<CreateOutcome>;
}

/**
 * Injected clock.
 *
 * Every timestamp Molt writes comes from here, so tests produce stable records
 * and the pure packages never need to read the system clock.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A fixed clock, for deterministic tests and reproducible fixtures. */
export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  return { now: () => instant };
}

/**
 * Advances by a fixed step on every call, so a sequence of recorded events has
 * distinguishable, ordered timestamps without depending on real time.
 */
export function tickingClock(startIso: string, stepMs = 1000): Clock {
  let current = new Date(startIso).getTime();
  return {
    now: () => {
      const value = new Date(current);
      current += stepMs;
      return value;
    },
  };
}
