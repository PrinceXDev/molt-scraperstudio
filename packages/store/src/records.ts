import type { FieldStats, HealthReport } from '@molt/health';

/**
 * Persisted record shapes.
 *
 * These are the vocabulary of the database, deliberately separate from the
 * in-flight domain types. `@molt/core` owns the transitions between incident
 * states; this module owns what those states are called on disk.
 */

/** Which of the two collectors a row belongs to. */
export type CollectorKind = 'primary' | 'chaos';

/**
 * The incident lifecycle.
 *
 * A union rather than a string so every consumer — the scorer, the CLI, the UI
 * timeline — must handle each state explicitly. Adding one becomes a compile
 * error everywhere it matters, which is the point.
 *
 * ```
 * detected → diagnosing → healing → awaiting_approval → approved → verifying → resolved
 *                │            │             │                                    │
 *                │            │             └── rejected ──→ diagnosing          │
 *                │            └── heal_failed ──→ diagnosing (bounded)           │
 *                └────────────────────────── escalated ←──── verify failed ──────┘
 * ```
 */
export type IncidentState =
  /** Drift measured, incident opened, nothing attempted yet. */
  | 'detected'
  /** Composing the heal prompt from the evidence. */
  | 'diagnosing'
  /** `bdata scraper heal` is in flight. */
  | 'healing'
  /** Heal stopped at the approval gate; a preview is available to review. */
  | 'awaiting_approval'
  /** A decision was recorded; the fix is committed. */
  | 'approved'
  /** Re-running to find out whether the fix actually worked. */
  | 'verifying'
  /** Fill rates recovered. The only success state. */
  | 'resolved'
  /** The proposed fix was declined. */
  | 'rejected'
  /** The heal call itself failed, as distinct from producing a bad fix. */
  | 'heal_failed'
  /** Retries exhausted, or a verify proved the fix did not work. A human is needed. */
  | 'escalated';

/** States in which no further automated work will happen. */
export const TERMINAL_STATES: readonly IncidentState[] = ['resolved', 'escalated'];

/** States that need a human decision before anything can proceed. */
export const BLOCKED_STATES: readonly IncidentState[] = ['awaiting_approval'];

export function isTerminal(state: IncidentState): boolean {
  return TERMINAL_STATES.includes(state);
}

export interface CollectorRecord {
  readonly id: string;
  readonly name: string;
  readonly targetUrl: string;
  readonly kind: CollectorKind;
  /** Dot path to nested records, e.g. `security_advisories`. */
  readonly recordPath: string | null;
  /** Wrapper fields merged into each nested record. */
  readonly inherit: readonly string[];
  readonly createdAt: string;
}

export interface CommandRow {
  readonly id: number;
  readonly incidentId: string | null;
  readonly collectorId: string | null;
  /** Copy-pasteable form, e.g. `bdata scraper heal c_… "…"`. */
  readonly display: string;
  readonly argv: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly failed: boolean;
}

export interface RunRecord {
  readonly id: string;
  readonly collectorId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly rowCount: number;
  readonly ok: boolean;
  readonly rows: readonly Record<string, unknown>[];
  readonly commandId: number | null;
}

export interface SnapshotRecord {
  readonly id: string;
  readonly collectorId: string;
  readonly runId: string;
  readonly capturedAt: string;
  readonly rowCount: number;
  readonly errorRows: number;
  readonly fields: readonly FieldStats[];
  readonly declaredFields: readonly string[] | null;
  readonly isBaseline: boolean;
}

export interface IncidentRecord {
  readonly id: string;
  readonly collectorId: string;
  readonly state: IncidentState;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly report: HealthReport;
  readonly healPrompt: string | null;
  readonly healEnvelope: unknown;
  readonly previewResult: unknown;
  readonly attempts: number;
  readonly verifiedRunId: string | null;
}

export interface EventRecord {
  readonly id: number;
  readonly incidentId: string;
  readonly at: string;
  /** Short machine-readable kind, e.g. `detected`, `heal.requested`. */
  readonly kind: string;
  readonly detail: string | null;
  readonly payload: unknown;
}
