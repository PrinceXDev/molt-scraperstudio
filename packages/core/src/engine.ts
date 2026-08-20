import {
  isHealBlocked,
  projectRows,
  type CommandRecord,
  type UnknownRecord,
} from '@molt/brightdata';
import { diagnose } from '@molt/diagnose';
import {
  buildSnapshot,
  compareSnapshots,
  type HealthReport,
  type Row,
  type Snapshot,
} from '@molt/health';
import type { CollectorRecord, IncidentRecord, Repository } from '@molt/store';

import type { Clock, ScraperPort } from './ports.js';
import { nextAutomaticTrigger, transition, type Trigger } from './transitions.js';

/**
 * The engine: performs an action, feeds the outcome to the state machine, records
 * what happened.
 *
 * All decisions about *what state to move to* live in `transitions.ts` and are
 * pure. This file only performs effects and persists them, which is why the
 * interesting logic is testable without any of them.
 */

export interface EngineOptions {
  readonly repo: Repository;
  readonly scraper: ScraperPort;
  readonly clock: Clock;
  /** Heal attempts permitted per incident. Defaults to 2. */
  readonly maxAttempts?: number;
}

export interface CheckResult {
  readonly collectorId: string;
  readonly report: HealthReport | null;
  readonly snapshotId: string;
  readonly runId: string;
  /** Set when this run established the first baseline; no report is possible. */
  readonly baselineEstablished: boolean;
  readonly incident: IncidentRecord | null;
  readonly rowCount: number;
}

export interface AdvanceResult {
  readonly incident: IncidentRecord;
  /** Null when nothing could be done: at the gate, terminal, or in flight. */
  readonly performed: Trigger | null;
  readonly note: string;
}

const DEFAULT_MAX_ATTEMPTS = 2;

export class Engine {
  private readonly repo: Repository;
  private readonly scraper: ScraperPort;
  private readonly clock: Clock;
  private readonly maxAttempts: number;

  constructor(options: EngineOptions) {
    this.repo = options.repo;
    this.scraper = options.scraper;
    this.clock = options.clock;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  /* ---------------------------------------------------------------- *
   * Detection
   * ---------------------------------------------------------------- */

  /**
   * Run a collector, snapshot the result, and compare it to the baseline.
   *
   * The first run of a collector has nothing to compare against, so it becomes
   * the baseline and reports no verdict. Every run after that produces a report.
   */
  async check(collectorId: string): Promise<CheckResult> {
    const collector = await this.requireCollector(collectorId);

    const outcome = await this.scraper.run({
      collectorId: collector.id,
      url: collector.targetUrl,
    });

    const commandId = await this.repo.saveCommand({
      collectorId: collector.id,
      display: outcome.command.display,
      argv: outcome.command.argv,
      startedAt: outcome.command.startedAt,
      finishedAt: outcome.command.finishedAt,
      durationMs: outcome.command.durationMs,
      exitCode: outcome.command.exitCode,
      stdout: outcome.command.stdout,
      stderr: outcome.command.stderr,
      failed: outcome.command.failed,
    });

    const rows = this.project(collector, outcome.rows);

    const run = await this.repo.saveRun({
      collectorId: collector.id,
      startedAt: outcome.command.startedAt,
      finishedAt: outcome.command.finishedAt,
      durationMs: outcome.command.durationMs,
      rows,
      ok: outcome.ok,
      commandId,
    });

    const capturedAt = outcome.command.finishedAt;
    const snapshot = buildSnapshot({ collectorId: collector.id, capturedAt, rows });

    const baseline = await this.repo.getBaseline(collector.id);

    const saved = await this.repo.saveSnapshot({
      collectorId: collector.id,
      runId: run.id,
      capturedAt,
      rowCount: snapshot.rowCount,
      errorRows: snapshot.errorRows,
      fields: snapshot.fields,
      isBaseline: baseline === null,
    });

    if (baseline === null) {
      return {
        collectorId: collector.id,
        report: null,
        snapshotId: saved.id,
        runId: run.id,
        baselineEstablished: true,
        incident: null,
        rowCount: snapshot.rowCount,
      };
    }

    const report = compareSnapshots(toSnapshot(baseline, collector.id), snapshot);
    const incident = await this.reconcileIncident(collector.id, report, run.id);

    return {
      collectorId: collector.id,
      report,
      snapshotId: saved.id,
      runId: run.id,
      baselineEstablished: false,
      incident,
      rowCount: snapshot.rowCount,
    };
  }

  /**
   * Open, close or leave the collector's incident, per the report.
   *
   * At most one incident is open per collector: a second breakage while the
   * first is unresolved is the same event, and opening a duplicate would queue a
   * second heal against a scraper already mid-repair.
   */
  private async reconcileIncident(
    collectorId: string,
    report: HealthReport,
    runId: string,
  ): Promise<IncidentRecord | null> {
    const open = await this.repo.getOpenIncident(collectorId);
    const now = this.clock.now().toISOString();

    if (report.status === 'healthy') {
      if (open === null) return null;

      // A verify in flight owns its own closure: `runVerify` promotes the
      // baseline and applies `verify.recovered` itself. Resolving here too would
      // close the incident twice and record a misleading pair of events.
      if (open.state === 'verifying') {
        await this.repo.appendEvent({
          incidentId: open.id,
          at: now,
          kind: 'observed.healthy',
          detail: `${report.summary} (during verification)`,
        });
        return open;
      }

      // Otherwise the site was rolled back, or the breakage was transient.
      // Either way the incident is over.
      return this.applyTrigger(open, 'observed.healthy', {
        detail: report.summary,
        patch: { verifiedRunId: runId },
      });
    }

    if (open !== null) {
      await this.repo.appendEvent({
        incidentId: open.id,
        at: now,
        kind: 'observed.still-broken',
        detail: report.summary,
        payload: { score: report.score },
      });
      return open;
    }

    const incident = await this.repo.openIncident({
      collectorId,
      openedAt: now,
      report,
    });

    await this.repo.appendEvent({
      incidentId: incident.id,
      at: now,
      kind: 'detected',
      detail: report.summary,
      payload: { score: report.score, faults: report.faults },
    });

    return incident;
  }

  /* ---------------------------------------------------------------- *
   * Progression
   * ---------------------------------------------------------------- */

  /**
   * Move an incident forward by one unattended step.
   *
   * Returns with `performed: null` at the approval gate. That is deliberate and
   * it is the product: the gate exists so a person sees the data diff before a
   * fix reaches production.
   */
  async advance(incidentId: string): Promise<AdvanceResult> {
    const incident = await this.requireIncident(incidentId);
    const trigger = nextAutomaticTrigger(incident.state);

    if (trigger === null) {
      return {
        incident,
        performed: null,
        note:
          incident.state === 'awaiting_approval'
            ? 'awaiting a human decision on the proposed fix'
            : `nothing to do in ${incident.state}`,
      };
    }

    switch (trigger) {
      case 'diagnose.start':
        return {
          incident: await this.runDiagnose(incident),
          performed: trigger,
          note: 'diagnosed',
        };
      case 'heal.start':
        return { incident: await this.runHeal(incident), performed: trigger, note: 'healed' };
      case 'verify.start':
        return { incident: await this.runVerify(incident), performed: trigger, note: 'verified' };
      default:
        return { incident, performed: null, note: `unsupported automatic trigger ${trigger}` };
    }
  }

  /**
   * Drive an incident until it needs a human or finishes.
   *
   * Bounded by `maxSteps` so a bug in the machine cannot spin. The state machine
   * is separately proven to converge, but a loop performing real network calls
   * deserves a belt as well as braces.
   */
  async advanceUntilBlocked(incidentId: string, maxSteps = 8): Promise<IncidentRecord> {
    let incident = await this.requireIncident(incidentId);

    for (let step = 0; step < maxSteps; step += 1) {
      const result = await this.advance(incident.id);
      incident = result.incident;
      if (result.performed === null) break;
    }

    return incident;
  }

  /** Compose the heal prompt from the incident's evidence and record it. */
  private async runDiagnose(incident: IncidentRecord): Promise<IncidentRecord> {
    const moved = await this.applyTrigger(incident, 'diagnose.start');
    if (moved.state !== 'diagnosing') return moved;

    const diagnosis = diagnose(incident.report);
    const at = this.clock.now().toISOString();

    await this.repo.appendEvent({
      incidentId: incident.id,
      at,
      kind: 'diagnosed',
      detail: `${diagnosis.charCount} chars, targeting ${diagnosis.targetFields.join(', ') || 'nothing'}`,
      payload: {
        prompt: diagnosis.prompt,
        targetFields: diagnosis.targetFields,
        unaffectedFields: diagnosis.unaffectedFields,
        truncated: diagnosis.truncated,
      },
    });

    return this.repo.patchIncident(incident.id, { healPrompt: diagnosis.prompt });
  }

  /** Call `bdata scraper heal` and route the outcome back into the machine. */
  private async runHeal(incident: IncidentRecord): Promise<IncidentRecord> {
    // The prompt is a pure function of the report, so a missing one is recomputed
    // rather than treated as a failure. An earlier version refused instead, which
    // was a dead end: `heal.failed` is not a legal trigger from `diagnosing`, so
    // the refusal was silently dropped and `advanceUntilBlocked` span to its step
    // cap. Deriving it here means a heal can never be attempted without one.
    let prompt = incident.healPrompt;

    if (prompt === null || prompt === '') {
      prompt = diagnose(incident.report).prompt;

      await this.repo.appendEvent({
        incidentId: incident.id,
        at: this.clock.now().toISOString(),
        kind: 'diagnosed.recomputed',
        detail: 'heal prompt was missing and has been derived from the stored report',
      });

      await this.repo.patchIncident(incident.id, { healPrompt: prompt });
    }

    const spent = await this.applyTrigger(incident, 'heal.start');
    if (spent.state !== 'healing') return spent;

    const collector = await this.requireCollector(incident.collectorId);
    const outcome = await this.scraper.heal({
      collectorId: collector.id,
      prompt,
      url: collector.targetUrl,
    });

    await this.recordCommand(outcome.command, incident.id, collector.id);

    const withEnvelope = await this.repo.patchIncident(incident.id, {
      healEnvelope: outcome.envelope,
      previewResult: outcome.previewRows.length > 0 ? outcome.previewRows : null,
    });

    if (isHealBlocked(outcome.envelope, outcome.command.stderr)) {
      // Distinguished from an ordinary failure: nothing ran, so retrying cannot
      // help until the outstanding heal on this collector is resolved.
      return this.applyTrigger(withEnvelope, 'heal.blocked', {
        detail: 'another refactor job is already in progress on this collector (409)',
      });
    }

    if (outcome.command.failed) {
      return this.applyTrigger(withEnvelope, 'heal.failed', {
        detail: outcome.envelope.error ?? `exit ${String(outcome.command.exitCode)}`,
      });
    }

    const gated = isGate(outcome.envelope.status);

    return this.applyTrigger(withEnvelope, gated ? 'heal.gate' : 'heal.done', {
      detail: gated
        ? `${outcome.previewRows.length} preview rows awaiting review`
        : 'heal completed without stopping at the gate',
    });
  }

  /**
   * Record a human decision on a proposed fix.
   *
   * The only entry point a UI needs: everything else the engine does is
   * unattended.
   */
  async decide(incidentId: string, decision: 'approve' | 'reject'): Promise<IncidentRecord> {
    const incident = await this.requireIncident(incidentId);

    if (incident.state !== 'awaiting_approval') {
      throw new Error(`incident ${incidentId} is ${incident.state}, not awaiting approval`);
    }

    const collector = await this.requireCollector(incident.collectorId);
    const reject = decision === 'reject';

    const outcome = await this.scraper.approve({
      collectorId: collector.id,
      url: collector.targetUrl,
      ...(reject ? { reject: true } : {}),
    });

    await this.recordCommand(outcome.command, incident.id, collector.id);

    if (outcome.command.failed) {
      return this.applyTrigger(incident, 'heal.failed', {
        detail: outcome.envelope.error ?? 'approve call failed',
      });
    }

    return this.applyTrigger(incident, reject ? 'approve.rejected' : 'approve.accepted', {
      detail: reject ? 'fix rejected by reviewer' : 'fix approved by reviewer',
    });
  }

  /**
   * Clear an outstanding heal on a collector by rejecting it.
   *
   * Scraper Studio allows one refactor job per collector, so a heal left sitting
   * at the approval gate blocks every later one with a 409. This is the escape
   * hatch, and it is deliberately explicit rather than automatic: rejecting a
   * pending heal discards a fix somebody may be part-way through reviewing, so it
   * should be a decision, not a side effect.
   */
  async unblock(collectorId: string): Promise<CommandRecord> {
    const collector = await this.requireCollector(collectorId);

    const outcome = await this.scraper.approve({
      collectorId: collector.id,
      url: collector.targetUrl,
      reject: true,
    });

    await this.repo.saveCommand({
      collectorId: collector.id,
      display: outcome.command.display,
      argv: outcome.command.argv,
      startedAt: outcome.command.startedAt,
      finishedAt: outcome.command.finishedAt,
      durationMs: outcome.command.durationMs,
      exitCode: outcome.command.exitCode,
      stdout: outcome.command.stdout,
      stderr: outcome.command.stderr,
      failed: outcome.command.failed,
    });

    return outcome.command;
  }

  /**
   * Re-run and decide whether the fix actually worked.
   *
   * The rule this enforces: an approved heal is not a success. Only measured
   * recovery of the fill rates closes an incident. When it does, the recovered
   * snapshot is promoted to baseline — otherwise every later run would be
   * compared against a pre-breakage world and alarm forever.
   */
  private async runVerify(incident: IncidentRecord): Promise<IncidentRecord> {
    const moved = await this.applyTrigger(incident, 'verify.start');
    if (moved.state !== 'verifying') return moved;

    const check = await this.check(incident.collectorId);
    const recovered = check.report === null || check.report.status === 'healthy';

    if (recovered) {
      await this.repo.setBaseline(check.snapshotId);

      const resolved = await this.applyTrigger(moved, 'verify.recovered', {
        detail: check.report?.summary ?? 'baseline re-established',
        patch: { verifiedRunId: check.runId },
      });

      return resolved;
    }

    // Note that `check` above has already reconciled the incident against the
    // fresh report, so the next diagnosis describes what is wrong *now* rather
    // than repeating the prompt that just failed.
    return this.applyTrigger(moved, 'verify.failed', {
      detail: check.report?.summary ?? 'still broken',
    });
  }

  /* ---------------------------------------------------------------- *
   * Shared plumbing
   * ---------------------------------------------------------------- */

  /** Apply a trigger, persist the resulting state, and record an event. */
  private async applyTrigger(
    incident: IncidentRecord,
    trigger: Trigger,
    options: { detail?: string; patch?: Parameters<Repository['patchIncident']>[1] } = {},
  ): Promise<IncidentRecord> {
    const result = transition({
      state: incident.state,
      trigger,
      attempts: incident.attempts,
      maxAttempts: this.maxAttempts,
    });

    const at = this.clock.now().toISOString();

    if (!result.ok) {
      await this.repo.appendEvent({
        incidentId: incident.id,
        at,
        kind: `refused.${trigger}`,
        detail: result.reason,
      });
      return incident;
    }

    const updated = await this.repo.patchIncident(incident.id, {
      state: result.next,
      attempts: incident.attempts + result.attemptsDelta,
      ...(result.closes ? { closedAt: at } : {}),
      ...options.patch,
    });

    await this.repo.appendEvent({
      incidentId: incident.id,
      at,
      kind: trigger,
      detail: options.detail ?? result.reason,
      payload: { from: incident.state, to: result.next, reason: result.reason },
    });

    return updated;
  }

  private async recordCommand(
    command: CommandRecord,
    incidentId: string,
    collectorId: string,
  ): Promise<number> {
    return this.repo.saveCommand({
      incidentId,
      collectorId,
      display: command.display,
      argv: command.argv,
      startedAt: command.startedAt,
      finishedAt: command.finishedAt,
      durationMs: command.durationMs,
      exitCode: command.exitCode,
      stdout: command.stdout,
      stderr: command.stderr,
      failed: command.failed,
    });
  }

  /** Apply the collector's projection so analysis runs over records, not wrappers. */
  private project(collector: CollectorRecord, rows: readonly UnknownRecord[]): Row[] {
    return projectRows(rows, {
      ...(collector.recordPath === null ? {} : { recordPath: collector.recordPath }),
      inherit: collector.inherit,
    }) as Row[];
  }

  private async requireCollector(id: string): Promise<CollectorRecord> {
    const collector = await this.repo.getCollector(id);
    if (collector === null) throw new Error(`unknown collector ${id}`);
    return collector;
  }

  private async requireIncident(id: string): Promise<IncidentRecord> {
    const incident = await this.repo.getIncident(id);
    if (incident === null) throw new Error(`unknown incident ${id}`);
    return incident;
  }
}

/** Rehydrate a stored snapshot into the shape `@molt/health` compares. */
function toSnapshot(
  record: {
    readonly capturedAt: string;
    readonly rowCount: number;
    readonly errorRows: number;
    readonly fields: Snapshot['fields'];
    readonly declaredFields: readonly string[] | null;
  },
  collectorId: string,
): Snapshot {
  return {
    collectorId,
    capturedAt: record.capturedAt,
    rowCount: record.rowCount,
    fields: record.fields,
    declaredFields: record.declaredFields,
    errorRows: record.errorRows,
  };
}

function isGate(status: string): boolean {
  const normalised = status.trim().toLowerCase();
  return normalised === 'awaiting_approval' || normalised === 'awaiting-approval';
}
