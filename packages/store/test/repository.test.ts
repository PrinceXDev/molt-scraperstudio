import { buildSnapshot, compareSnapshots } from '@molt/health';
import type { Row } from '@molt/health';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, Repository, type Database } from '../src/index.js';

/**
 * Every test runs against a fresh in-memory database, so the suite needs no
 * files, no cleanup and no ordering between cases.
 */

const COLLECTOR = 'c_mt0z2fn11aj6lk4bdz';
const T0 = '2026-08-20T03:45:00.000Z';
const T1 = '2026-08-21T03:45:00.000Z';

function rows(count: number, overrides: Record<string, unknown> = {}): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    cve_id: `CVE-2026-${1000 + i}`,
    cvss_score: '4.2',
    component: 'core server',
    ...overrides,
  }));
}

let db: Database;
let repo: Repository;

beforeEach(async () => {
  db = await openDatabase({ url: ':memory:' });
  repo = new Repository(db);

  await repo.saveCollector({
    id: COLLECTOR,
    name: 'molt-pg-advisories',
    targetUrl: 'https://www.postgresql.org/support/security/',
    kind: 'primary',
    recordPath: 'security_advisories',
    inherit: ['product_page_url'],
    createdAt: T0,
  });
});

afterEach(() => {
  db.close();
});

describe('collectors', () => {
  it('round-trips a collector including its projection config', async () => {
    const found = await repo.getCollector(COLLECTOR);

    expect(found?.name).toBe('molt-pg-advisories');
    expect(found?.kind).toBe('primary');
    expect(found?.recordPath).toBe('security_advisories');
    expect(found?.inherit).toEqual(['product_page_url']);
  });

  it('returns null for an unknown id rather than throwing', async () => {
    expect(await repo.getCollector('c_nope')).toBeNull();
  });

  it('upserts on conflict instead of failing', async () => {
    await repo.saveCollector({
      id: COLLECTOR,
      name: 'renamed',
      targetUrl: 'https://example.com',
      kind: 'primary',
      createdAt: T0,
    });

    const all = await repo.listCollectors();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('renamed');
    expect(all[0]?.recordPath).toBeNull();
  });
});

describe('commands', () => {
  it('records an invocation and links it to a run', async () => {
    const commandId = await repo.saveCommand({
      collectorId: COLLECTOR,
      display: 'bdata scraper run c_mt0z2fn11aj6lk4bdz https://example.com --pretty',
      argv: ['scraper', 'run', COLLECTOR],
      startedAt: T0,
      finishedAt: T0,
      durationMs: 4210,
      exitCode: 0,
      stdout: '[]',
      stderr: '',
      failed: false,
    });

    const run = await repo.saveRun({
      collectorId: COLLECTOR,
      startedAt: T0,
      finishedAt: T0,
      durationMs: 4210,
      rows: rows(36),
      ok: true,
      commandId,
    });

    expect(run.commandId).toBe(commandId);
    expect(run.rowCount).toBe(36);

    const recent = await repo.listRecentCommands();
    expect(recent[0]?.display).toContain('bdata scraper run');
    expect(recent[0]?.failed).toBe(false);
  });

  it('preserves a non-zero exit code and stderr', async () => {
    await repo.saveCommand({
      collectorId: COLLECTOR,
      display: 'bdata scraper heal c_x "…"',
      argv: ['scraper', 'heal'],
      startedAt: T0,
      finishedAt: T0,
      durationMs: 12,
      exitCode: 1,
      stdout: '',
      stderr: 'AI generation failed',
      failed: true,
    });

    const [command] = await repo.listRecentCommands();
    expect(command?.exitCode).toBe(1);
    expect(command?.stderr).toBe('AI generation failed');
    expect(command?.failed).toBe(true);
  });
});

describe('snapshots and baselines', () => {
  async function addSnapshot(capturedAt: string, data: Row[]) {
    const run = await repo.saveRun({
      collectorId: COLLECTOR,
      startedAt: capturedAt,
      finishedAt: capturedAt,
      durationMs: 1000,
      rows: data,
      ok: true,
    });

    const snapshot = buildSnapshot({ collectorId: COLLECTOR, capturedAt, rows: data });

    return repo.saveSnapshot({
      collectorId: COLLECTOR,
      runId: run.id,
      capturedAt,
      rowCount: snapshot.rowCount,
      errorRows: snapshot.errorRows,
      fields: snapshot.fields,
    });
  }

  it('round-trips field statistics', async () => {
    const saved = await addSnapshot(T0, rows(36));

    const found = await repo.getSnapshot(saved.id);
    expect(found?.rowCount).toBe(36);
    expect(found?.fields.map((f) => f.field).sort()).toEqual(['component', 'cve_id', 'cvss_score']);
    expect(found?.fields.every((f) => f.rate === 1)).toBe(true);
  });

  it('falls back to the earliest snapshot when none is marked', async () => {
    // So a collector is comparable from its second run onward, with no manual
    // step to nominate a baseline.
    await addSnapshot(T0, rows(36));
    await addSnapshot(T1, rows(36));

    const baseline = await repo.getBaseline(COLLECTOR);
    expect(baseline?.capturedAt).toBe(T0);
  });

  it('prefers an explicitly marked baseline', async () => {
    await addSnapshot(T0, rows(36));
    const later = await addSnapshot(T1, rows(36));

    await repo.setBaseline(later.id);

    const baseline = await repo.getBaseline(COLLECTOR);
    expect(baseline?.id).toBe(later.id);
    expect(baseline?.isBaseline).toBe(true);
  });

  it('demotes the previous baseline when promoting a new one', async () => {
    // After a verified heal the recovered shape becomes the reference. Leaving
    // two baselines would make the comparison non-deterministic.
    const first = await addSnapshot(T0, rows(36));
    await repo.setBaseline(first.id);

    const second = await addSnapshot(T1, rows(36));
    await repo.setBaseline(second.id);

    const all = await repo.listSnapshots(COLLECTOR);
    expect(all.filter((s) => s.isBaseline)).toHaveLength(1);
    expect(all.find((s) => s.isBaseline)?.id).toBe(second.id);
  });

  it('rejects promoting a snapshot that does not exist', async () => {
    await expect(repo.setBaseline('s_missing')).rejects.toThrow('unknown snapshot');
  });

  it('lists snapshots oldest first, as a heatmap needs', async () => {
    await addSnapshot(T0, rows(36));
    await addSnapshot(T1, rows(36));

    const listed = await repo.listSnapshots(COLLECTOR);
    expect(listed.map((s) => s.capturedAt)).toEqual([T0, T1]);
  });

  it('returns null when a collector has no snapshots yet', async () => {
    expect(await repo.getBaseline(COLLECTOR)).toBeNull();
  });
});

describe('incidents', () => {
  const report = compareSnapshots(
    buildSnapshot({ collectorId: COLLECTOR, capturedAt: T0, rows: rows(36) }),
    buildSnapshot({
      collectorId: COLLECTOR,
      capturedAt: T1,
      rows: rows(36, { cvss_score: null }),
    }),
  );

  it('opens in the detected state and stores the report that caused it', async () => {
    const incident = await repo.openIncident({
      collectorId: COLLECTOR,
      openedAt: T1,
      report,
    });

    expect(incident.state).toBe('detected');
    expect(incident.closedAt).toBeNull();
    expect(incident.attempts).toBe(0);
    expect(incident.report.status).toBe('broken');
    expect(incident.report.summary).toContain('cvss_score');
  });

  it('applies a partial patch without blanking other columns', async () => {
    // The bug this guards: advancing the state must not erase a heal prompt
    // recorded a moment earlier.
    const incident = await repo.openIncident({ collectorId: COLLECTOR, openedAt: T1, report });

    await repo.patchIncident(incident.id, {
      state: 'healing',
      healPrompt: 'Re-capture `cvss_score` from the current markup.',
      attempts: 1,
    });

    const afterSecondPatch = await repo.patchIncident(incident.id, {
      state: 'awaiting_approval',
      previewResult: [{ cve_id: 'CVE-2026-1000', cvss_score: '4.2' }],
    });

    expect(afterSecondPatch.state).toBe('awaiting_approval');
    expect(afterSecondPatch.healPrompt).toContain('Re-capture');
    expect(afterSecondPatch.attempts).toBe(1);
    expect(afterSecondPatch.previewResult).toEqual([
      { cve_id: 'CVE-2026-1000', cvss_score: '4.2' },
    ]);
  });

  it('treats an empty patch as a no-op', async () => {
    const incident = await repo.openIncident({ collectorId: COLLECTOR, openedAt: T1, report });
    const unchanged = await repo.patchIncident(incident.id, {});

    expect(unchanged).toEqual(incident);
  });

  it('keeps at most one open incident per collector', async () => {
    // A second breakage while the first is unresolved is the same event.
    // Opening a duplicate would queue a heal against a scraper mid-repair.
    const first = await repo.openIncident({ collectorId: COLLECTOR, openedAt: T0, report });
    await repo.openIncident({ collectorId: COLLECTOR, openedAt: T1, report });

    const open = await repo.getOpenIncident(COLLECTOR);
    expect(open?.openedAt).toBe(T1);

    await repo.patchIncident(first.id, { state: 'resolved', closedAt: T1 });
    const stillOpen = await repo.getOpenIncident(COLLECTOR);
    expect(stillOpen?.id).not.toBe(first.id);
  });

  it('stops reporting an incident as open once it is closed', async () => {
    const incident = await repo.openIncident({ collectorId: COLLECTOR, openedAt: T1, report });

    await repo.patchIncident(incident.id, { state: 'resolved', closedAt: T1 });

    expect(await repo.getOpenIncident(COLLECTOR)).toBeNull();
  });

  it('rejects patching an unknown incident', async () => {
    await expect(repo.patchIncident('i_missing', { state: 'resolved' })).rejects.toThrow(
      'unknown incident',
    );
  });
});

describe('events', () => {
  it('builds an append-only timeline in insertion order', async () => {
    const report = compareSnapshots(
      buildSnapshot({ collectorId: COLLECTOR, capturedAt: T0, rows: rows(10) }),
      buildSnapshot({ collectorId: COLLECTOR, capturedAt: T1, rows: rows(10) }),
    );
    const incident = await repo.openIncident({ collectorId: COLLECTOR, openedAt: T1, report });

    for (const kind of ['detected', 'diagnosed', 'heal.requested', 'approved', 'verified']) {
      await repo.appendEvent({ incidentId: incident.id, at: T1, kind });
    }

    const timeline = await repo.listEvents(incident.id);
    expect(timeline.map((e) => e.kind)).toEqual([
      'detected',
      'diagnosed',
      'heal.requested',
      'approved',
      'verified',
    ]);
  });

  it('stores a structured payload alongside the event', async () => {
    const report = compareSnapshots(
      buildSnapshot({ collectorId: COLLECTOR, capturedAt: T0, rows: rows(10) }),
      buildSnapshot({ collectorId: COLLECTOR, capturedAt: T1, rows: rows(10) }),
    );
    const incident = await repo.openIncident({ collectorId: COLLECTOR, openedAt: T1, report });

    await repo.appendEvent({
      incidentId: incident.id,
      at: T1,
      kind: 'diagnosed',
      detail: '2 of 8 fields stopped extracting',
      payload: { targetFields: ['cvss_score', 'vector_string'] },
    });

    const [event] = await repo.listEvents(incident.id);
    expect(event?.detail).toBe('2 of 8 fields stopped extracting');
    expect(event?.payload).toEqual({ targetFields: ['cvss_score', 'vector_string'] });
  });
});
