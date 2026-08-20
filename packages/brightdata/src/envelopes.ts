import { z } from 'zod';

/**
 * Runtime schemas for the JSON envelopes `bdata` emits under `--json`.
 *
 * Every schema is `.passthrough()` on purpose. These envelopes belong to Bright
 * Data, not to us: a new field appearing in a CLI release must not crash Molt.
 * We validate the fields we depend on and carry the rest through untouched.
 */

/** Every Scraper Studio collector id is `c_` followed by an alphanumeric run. */
export const collectorIdSchema = z
  .string()
  .regex(/^c_[a-z0-9]+$/i, 'expected a Bright Data collector id like c_abc123');

export type CollectorId = z.infer<typeof collectorIdSchema>;

export function isCollectorId(value: unknown): value is CollectorId {
  return collectorIdSchema.safeParse(value).success;
}

/**
 * `bdata scraper create` envelope.
 *
 * Observed failure shape, verbatim:
 * ```json
 * { "collector_id": "c_mt0yykpt1qye2ry05d", "name": "molt-tailscale-changelog",
 *   "status": "failed", "completed_steps": ["prepare_intent_analyzer"],
 *   "view_url": "https://brightdata.com/cp/scrapers/c_...",
 *   "created_at": "2026-08-20T03:36:57.953Z",
 *   "error": "AI generation finished with status \"failed\"." }
 * ```
 *
 * A collector id is returned even on failure, because the template is created
 * before generation runs — which is why a failed create leaves an orphan.
 */
export const createEnvelopeSchema = z
  .object({
    collector_id: collectorIdSchema,
    name: z.string().optional(),
    status: z.string(),
    completed_steps: z.array(z.string()).optional(),
    view_url: z.string().optional(),
    created_at: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type CreateEnvelope = z.infer<typeof createEnvelopeSchema>;

/**
 * `bdata scraper heal` envelope.
 *
 * Without `--auto-approve`, heal stops at an approval gate and exits 0 with
 * `status: "awaiting_approval"` plus a `preview_result` showing sample rows the
 * fixed scraper would produce. That gate is the entire basis of Molt's review
 * screen: it is a machine-readable human-in-the-loop.
 */
export const healEnvelopeSchema = z
  .object({
    collector_id: collectorIdSchema,
    status: z.string(),
    prompt: z.string().optional(),
    next_step: z.string().optional(),
    preview_result: z.unknown().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type HealEnvelope = z.infer<typeof healEnvelopeSchema>;

/** `bdata scraper approve` envelope. Same shape as heal, minus the preview. */
export const approveEnvelopeSchema = z
  .object({
    collector_id: collectorIdSchema,
    status: z.string(),
    next_step: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type ApproveEnvelope = z.infer<typeof approveEnvelopeSchema>;

/**
 * Statuses that mean the AI pipeline is finished and succeeded.
 * Bright Data has used more than one word for this across CLI versions, so both
 * are accepted rather than pinning to whichever we happened to observe.
 */
const SUCCESS_STATUSES: ReadonlySet<string> = new Set(['done', 'ready', 'succeeded', 'success']);

const AWAITING_STATUSES: ReadonlySet<string> = new Set(['awaiting_approval', 'awaiting-approval']);

export function isSuccessStatus(status: string): boolean {
  return SUCCESS_STATUSES.has(status.trim().toLowerCase());
}

/** True when a heal has stopped at the approval gate and needs a decision. */
export function isAwaitingApproval(envelope: { readonly status: string }): boolean {
  return AWAITING_STATUSES.has(envelope.status.trim().toLowerCase());
}

export function isFailureStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled';
}

/**
 * Pull data rows out of whatever `bdata scraper run --json` produced.
 *
 * The CLI routes small jobs through `/dca/trigger_immediate` and large ones
 * through `/dca/trigger`, and wraps the result differently depending on which
 * path it took. Rather than guess, accept every shape observed in the docs and
 * fail loudly only when nothing row-like is present.
 */
export function extractRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isPlainRow);

  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;

    for (const key of ['data', 'results', 'rows', 'records', 'output'] as const) {
      const candidate = record[key];
      if (Array.isArray(candidate)) return candidate.filter(isPlainRow);
    }

    // A single-record response, e.g. a one-URL run.
    if (isPlainRow(record)) return [record];
  }

  return [];
}

function isPlainRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
