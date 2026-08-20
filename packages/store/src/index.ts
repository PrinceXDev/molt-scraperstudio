/**
 * `@molt/store` — persistence.
 *
 * libSQL over a local file, hand-written SQL, schema applied on open. No ORM and
 * no migration tooling, so a fresh clone runs with nothing to provision.
 */

export {
  fromBit,
  fromJson,
  openDatabase,
  SCHEMA,
  toBit,
  toJson,
  type Database,
  type OpenOptions,
} from './db.js';

export {
  BLOCKED_STATES,
  isTerminal,
  TERMINAL_STATES,
  type CollectorKind,
  type CollectorRecord,
  type CommandRow,
  type EventRecord,
  type IncidentRecord,
  type IncidentState,
  type RunRecord,
  type SnapshotRecord,
} from './records.js';

export {
  Repository,
  type AppendEventInput,
  type OpenIncidentInput,
  type PatchIncidentInput,
  type SaveCollectorInput,
  type SaveCommandInput,
  type SaveRunInput,
  type SaveSnapshotInput,
} from './repository.js';
