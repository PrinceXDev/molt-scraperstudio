import { randomUUID } from 'node:crypto';

import type { Row as LibsqlRow } from '@libsql/client';
import type { FieldStats, HealthReport } from '@molt/health';

import { fromBit, fromJson, toBit, toJson, type Database } from './db.js';
import type {
  CollectorKind,
  CollectorRecord,
  CommandRow,
  EventRecord,
  IncidentRecord,
  IncidentState,
  RunRecord,
  SnapshotRecord,
} from './records.js';

/* ------------------------------------------------------------------ *
 * Column coercion
 *
 * libSQL hands back `string | number | bigint | ArrayBuffer | null`. These
 * narrow it once, here, so no call site has to cast.
 * ------------------------------------------------------------------ */

function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/* ------------------------------------------------------------------ *
 * Row mappers
 * ------------------------------------------------------------------ */

function toCollector(row: LibsqlRow): CollectorRecord {
  return {
    id: str(row['id']),
    name: str(row['name']),
    targetUrl: str(row['target_url']),
    kind: str(row['kind']) as CollectorKind,
    recordPath: strOrNull(row['record_path']),
    inherit: fromJson<string[]>(strOrNull(row['inherit_json']), []),
    createdAt: str(row['created_at']),
  };
}

function toRun(row: LibsqlRow): RunRecord {
  return {
    id: str(row['id']),
    collectorId: str(row['collector_id']),
    startedAt: str(row['started_at']),
    finishedAt: str(row['finished_at']),
    durationMs: num(row['duration_ms']),
    rowCount: num(row['row_count']),
    ok: fromBit(row['ok'] ?? 0),
    rows: fromJson<Record<string, unknown>[]>(strOrNull(row['rows_json']), []),
    commandId: numOrNull(row['command_id']),
  };
}

function toSnapshot(row: LibsqlRow): SnapshotRecord {
  return {
    id: str(row['id']),
    collectorId: str(row['collector_id']),
    runId: str(row['run_id']),
    capturedAt: str(row['captured_at']),
    rowCount: num(row['row_count']),
    errorRows: num(row['error_rows']),
    fields: fromJson<FieldStats[]>(strOrNull(row['fields_json']), []),
    declaredFields: fromJson<string[] | null>(strOrNull(row['declared_fields_json']), null),
    isBaseline: fromBit(row['is_baseline'] ?? 0),
  };
}

function toIncident(row: LibsqlRow): IncidentRecord {
  return {
    id: str(row['id']),
    collectorId: str(row['collector_id']),
    state: str(row['state']) as IncidentState,
    openedAt: str(row['opened_at']),
    closedAt: strOrNull(row['closed_at']),
    report: fromJson<HealthReport>(strOrNull(row['report_json']), {} as HealthReport),
    healPrompt: strOrNull(row['heal_prompt']),
    healEnvelope: fromJson<unknown>(strOrNull(row['heal_json']), null),
    previewResult: fromJson<unknown>(strOrNull(row['preview_json']), null),
    attempts: num(row['attempts']),
    verifiedRunId: strOrNull(row['verified_run_id']),
  };
}

function toCommand(row: LibsqlRow): CommandRow {
  return {
    id: num(row['id']),
    incidentId: strOrNull(row['incident_id']),
    collectorId: strOrNull(row['collector_id']),
    display: str(row['display']),
    argv: fromJson<string[]>(strOrNull(row['argv_json']), []),
    startedAt: str(row['started_at']),
    finishedAt: str(row['finished_at']),
    durationMs: num(row['duration_ms']),
    exitCode: numOrNull(row['exit_code']),
    stdout: str(row['stdout']),
    stderr: str(row['stderr']),
    failed: fromBit(row['failed'] ?? 0),
  };
}

/* ------------------------------------------------------------------ *
 * Input shapes
 * ------------------------------------------------------------------ */

export interface SaveCollectorInput {
  readonly id: string;
  readonly name: string;
  readonly targetUrl: string;
  readonly kind: CollectorKind;
  readonly recordPath?: string | null;
  readonly inherit?: readonly string[];
  readonly createdAt: string;
}

export interface SaveCommandInput {
  readonly incidentId?: string | null;
  readonly collectorId?: string | null;
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

export interface SaveRunInput {
  readonly collectorId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly rows: readonly Record<string, unknown>[];
  readonly ok: boolean;
  readonly commandId?: number | null;
}

export interface SaveSnapshotInput {
  readonly collectorId: string;
  readonly runId: string;
  readonly capturedAt: string;
  readonly rowCount: number;
  readonly errorRows: number;
  readonly fields: readonly FieldStats[];
  readonly declaredFields?: readonly string[] | null;
  readonly isBaseline?: boolean;
}

export interface OpenIncidentInput {
  readonly collectorId: string;
  readonly openedAt: string;
  readonly report: HealthReport;
  readonly state?: IncidentState;
}

export interface PatchIncidentInput {
  readonly state?: IncidentState;
  readonly closedAt?: string | null;
  readonly healPrompt?: string | null;
  readonly healEnvelope?: unknown;
  readonly previewResult?: unknown;
  readonly attempts?: number;
  readonly verifiedRunId?: string | null;
}

export interface AppendEventInput {
  readonly incidentId: string;
  readonly at: string;
  readonly kind: string;
  readonly detail?: string | null;
  readonly payload?: unknown;
}

/**
 * Typed access to Molt's persistence.
 *
 * Hand-written SQL on purpose — see `db.ts`. Every method is small enough to
 * read alongside its query, and nothing here knows about Bright Data or about
 * how an incident should progress.
 */
export class Repository {
  constructor(private readonly db: Database) {}

  /* -------------------------------- collectors -------------------------------- */

  async saveCollector(input: SaveCollectorInput): Promise<CollectorRecord> {
    await this.db.client.execute({
      sql: `INSERT INTO collectors (id, name, target_url, kind, record_path, inherit_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              target_url = excluded.target_url,
              kind = excluded.kind,
              record_path = excluded.record_path,
              inherit_json = excluded.inherit_json`,
      args: [
        input.id,
        input.name,
        input.targetUrl,
        input.kind,
        input.recordPath ?? null,
        toJson(input.inherit ?? []),
        input.createdAt,
      ],
    });

    const saved = await this.getCollector(input.id);
    if (saved === null) throw new Error(`collector ${input.id} vanished after save`);
    return saved;
  }

  async getCollector(id: string): Promise<CollectorRecord | null> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM collectors WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    return row === undefined ? null : toCollector(row);
  }

  async listCollectors(): Promise<CollectorRecord[]> {
    const result = await this.db.client.execute(
      `SELECT * FROM collectors ORDER BY kind, created_at`,
    );
    return result.rows.map(toCollector);
  }

  /* --------------------------------- commands --------------------------------- */

  /** Records a `bdata` invocation and returns its id, for linking to a run. */
  async saveCommand(input: SaveCommandInput): Promise<number> {
    const result = await this.db.client.execute({
      sql: `INSERT INTO commands
              (incident_id, collector_id, display, argv_json, started_at, finished_at,
               duration_ms, exit_code, stdout, stderr, failed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [
        input.incidentId ?? null,
        input.collectorId ?? null,
        input.display,
        toJson(input.argv),
        input.startedAt,
        input.finishedAt,
        input.durationMs,
        input.exitCode,
        input.stdout,
        input.stderr,
        toBit(input.failed),
      ],
    });

    return num(result.rows[0]?.['id']);
  }

  /** Most recent commands, newest first — the UI's terminal drawer. */
  async listRecentCommands(limit = 50): Promise<CommandRow[]> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM commands ORDER BY id DESC LIMIT ?`,
      args: [limit],
    });
    return result.rows.map(toCommand);
  }

  async listCommandsForIncident(incidentId: string): Promise<CommandRow[]> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM commands WHERE incident_id = ? ORDER BY id`,
      args: [incidentId],
    });
    return result.rows.map(toCommand);
  }

  /* ----------------------------------- runs ----------------------------------- */

  async saveRun(input: SaveRunInput): Promise<RunRecord> {
    const id = `r_${randomUUID()}`;

    await this.db.client.execute({
      sql: `INSERT INTO runs
              (id, collector_id, started_at, finished_at, duration_ms, row_count, ok,
               rows_json, command_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.collectorId,
        input.startedAt,
        input.finishedAt,
        input.durationMs,
        input.rows.length,
        toBit(input.ok),
        toJson(input.rows),
        input.commandId ?? null,
      ],
    });

    const saved = await this.getRun(id);
    if (saved === null) throw new Error(`run ${id} vanished after save`);
    return saved;
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM runs WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    return row === undefined ? null : toRun(row);
  }

  async listRuns(collectorId: string, limit = 30): Promise<RunRecord[]> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM runs WHERE collector_id = ? ORDER BY started_at DESC LIMIT ?`,
      args: [collectorId, limit],
    });
    return result.rows.map(toRun);
  }

  /* --------------------------------- snapshots -------------------------------- */

  async saveSnapshot(input: SaveSnapshotInput): Promise<SnapshotRecord> {
    const id = `s_${randomUUID()}`;

    await this.db.client.execute({
      sql: `INSERT INTO snapshots
              (id, collector_id, run_id, captured_at, row_count, error_rows,
               fields_json, declared_fields_json, is_baseline)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.collectorId,
        input.runId,
        input.capturedAt,
        input.rowCount,
        input.errorRows,
        toJson(input.fields),
        input.declaredFields === undefined || input.declaredFields === null
          ? null
          : toJson(input.declaredFields),
        toBit(input.isBaseline ?? false),
      ],
    });

    const saved = await this.getSnapshot(id);
    if (saved === null) throw new Error(`snapshot ${id} vanished after save`);
    return saved;
  }

  async getSnapshot(id: string): Promise<SnapshotRecord | null> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM snapshots WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    return row === undefined ? null : toSnapshot(row);
  }

  /**
   * The snapshot to compare against.
   *
   * An explicitly marked baseline wins; otherwise the earliest snapshot stands
   * in, so a collector is comparable from its second run onward without anyone
   * having to nominate a baseline first.
   */
  async getBaseline(collectorId: string): Promise<SnapshotRecord | null> {
    const marked = await this.db.client.execute({
      sql: `SELECT * FROM snapshots
            WHERE collector_id = ? AND is_baseline = 1
            ORDER BY captured_at DESC LIMIT 1`,
      args: [collectorId],
    });
    const markedRow = marked.rows[0];
    if (markedRow !== undefined) return toSnapshot(markedRow);

    const earliest = await this.db.client.execute({
      sql: `SELECT * FROM snapshots WHERE collector_id = ? ORDER BY captured_at LIMIT 1`,
      args: [collectorId],
    });
    const row = earliest.rows[0];
    return row === undefined ? null : toSnapshot(row);
  }

  /**
   * Promote one snapshot to the baseline, demoting any previous one.
   *
   * Called after a verified heal: the recovered shape becomes the new reference,
   * otherwise every later run would be compared against a pre-breakage world
   * and a legitimately changed schema would alarm forever.
   */
  async setBaseline(snapshotId: string): Promise<void> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (snapshot === null) throw new Error(`unknown snapshot ${snapshotId}`);

    await this.db.client.batch([
      {
        sql: `UPDATE snapshots SET is_baseline = 0 WHERE collector_id = ?`,
        args: [snapshot.collectorId],
      },
      { sql: `UPDATE snapshots SET is_baseline = 1 WHERE id = ?`, args: [snapshotId] },
    ]);
  }

  /** Oldest first, which is the order a field-by-run heatmap needs. */
  async listSnapshots(collectorId: string, limit = 40): Promise<SnapshotRecord[]> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM (
              SELECT * FROM snapshots WHERE collector_id = ?
              ORDER BY captured_at DESC LIMIT ?
            ) ORDER BY captured_at ASC`,
      args: [collectorId, limit],
    });
    return result.rows.map(toSnapshot);
  }

  /* --------------------------------- incidents -------------------------------- */

  async openIncident(input: OpenIncidentInput): Promise<IncidentRecord> {
    const id = `i_${randomUUID()}`;

    await this.db.client.execute({
      sql: `INSERT INTO incidents (id, collector_id, state, opened_at, report_json, attempts)
            VALUES (?, ?, ?, ?, ?, 0)`,
      args: [
        id,
        input.collectorId,
        input.state ?? 'detected',
        input.openedAt,
        toJson(input.report),
      ],
    });

    const saved = await this.getIncident(id);
    if (saved === null) throw new Error(`incident ${id} vanished after save`);
    return saved;
  }

  async getIncident(id: string): Promise<IncidentRecord | null> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM incidents WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    return row === undefined ? null : toIncident(row);
  }

  /**
   * Apply a partial update.
   *
   * Only the fields present in `patch` are written, so a caller advancing the
   * state cannot accidentally blank a heal prompt recorded a moment earlier.
   */
  async patchIncident(id: string, patch: PatchIncidentInput): Promise<IncidentRecord> {
    const assignments: string[] = [];
    const args: Array<string | number | null> = [];

    const put = (column: string, value: string | number | null): void => {
      assignments.push(`${column} = ?`);
      args.push(value);
    };

    if (patch.state !== undefined) put('state', patch.state);
    if (patch.closedAt !== undefined) put('closed_at', patch.closedAt);
    if (patch.healPrompt !== undefined) put('heal_prompt', patch.healPrompt);
    if (patch.healEnvelope !== undefined) put('heal_json', toJson(patch.healEnvelope));
    if (patch.previewResult !== undefined) put('preview_json', toJson(patch.previewResult));
    if (patch.attempts !== undefined) put('attempts', patch.attempts);
    if (patch.verifiedRunId !== undefined) put('verified_run_id', patch.verifiedRunId);

    if (assignments.length > 0) {
      await this.db.client.execute({
        sql: `UPDATE incidents SET ${assignments.join(', ')} WHERE id = ?`,
        args: [...args, id],
      });
    }

    const updated = await this.getIncident(id);
    if (updated === null) throw new Error(`unknown incident ${id}`);
    return updated;
  }

  /**
   * The collector's live incident, if any.
   *
   * Molt keeps at most one open incident per collector: a second breakage while
   * the first is unresolved is the same event, and opening a duplicate would
   * queue a second heal against a scraper already mid-repair.
   */
  async getOpenIncident(collectorId: string): Promise<IncidentRecord | null> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM incidents
            WHERE collector_id = ? AND closed_at IS NULL
            ORDER BY opened_at DESC LIMIT 1`,
      args: [collectorId],
    });
    const row = result.rows[0];
    return row === undefined ? null : toIncident(row);
  }

  async listIncidents(limit = 50): Promise<IncidentRecord[]> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM incidents ORDER BY opened_at DESC LIMIT ?`,
      args: [limit],
    });
    return result.rows.map(toIncident);
  }

  /* ---------------------------------- events ---------------------------------- */

  async appendEvent(input: AppendEventInput): Promise<EventRecord> {
    const result = await this.db.client.execute({
      sql: `INSERT INTO events (incident_id, at, kind, detail, payload_json)
            VALUES (?, ?, ?, ?, ?)
            RETURNING *`,
      args: [
        input.incidentId,
        input.at,
        input.kind,
        input.detail ?? null,
        input.payload === undefined ? null : toJson(input.payload),
      ],
    });

    const row = result.rows[0];
    if (row === undefined) throw new Error('event insert returned nothing');

    return {
      id: num(row['id']),
      incidentId: str(row['incident_id']),
      at: str(row['at']),
      kind: str(row['kind']),
      detail: strOrNull(row['detail']),
      payload: fromJson<unknown>(strOrNull(row['payload_json']), null),
    };
  }

  /** The incident timeline, oldest first. */
  async listEvents(incidentId: string): Promise<EventRecord[]> {
    const result = await this.db.client.execute({
      sql: `SELECT * FROM events WHERE incident_id = ? ORDER BY id`,
      args: [incidentId],
    });

    return result.rows.map((row) => ({
      id: num(row['id']),
      incidentId: str(row['incident_id']),
      at: str(row['at']),
      kind: str(row['kind']),
      detail: strOrNull(row['detail']),
      payload: fromJson<unknown>(strOrNull(row['payload_json']), null),
    }));
  }
}
