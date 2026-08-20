/**
 * `@molt/brightdata` — the only I/O boundary to Bright Data.
 *
 * Mutations (`create`, `run`, `heal`, `approve`) go through the real `bdata`
 * CLI, so the terminal remains the control plane and every command is
 * recordable. Read-only telemetry the CLI does not expose goes through REST.
 *
 * Nothing else in the repository may import `node:child_process` or call
 * `fetch` against Bright Data.
 */

export {
  approveEnvelopeSchema,
  collectorIdSchema,
  createEnvelopeSchema,
  extractRows,
  healEnvelopeSchema,
  isAwaitingApproval,
  isCollectorId,
  isFailureStatus,
  isSuccessStatus,
  type ApproveEnvelope,
  type CollectorId,
  type CreateEnvelope,
  type HealEnvelope,
} from './envelopes.js';

export {
  parseJsonFromStdout,
  resolveCliEntry,
  runCli,
  type CommandRecord,
  type SpawnOptions,
} from './command.js';

export { projectRows, readPath, type RowProjection, type UnknownRecord } from './project.js';

export { REDACTED, redactArgv, redactText } from './redact.js';
