import Link from 'next/link';
import { notFound } from 'next/navigation';

import { summariseCredits } from '@molt/brightdata';
import { costOfSilence, describeCostOfSilence } from '@molt/diagnose';

import { Badge } from '@/components/Badge';
import { ScoreBar } from '@/components/ScoreBar';
import { getContext } from '@/lib/context';
import { relativeTime, timeOnly } from '@/lib/format';

export const dynamic = 'force-dynamic';

const EVENT_TONE: Record<string, 'good' | 'bad' | 'warn' | undefined> = {
  detected: 'bad',
  'verify.recovered': 'good',
  'observed.healthy': 'good',
  'verify.failed': 'bad',
  'heal.blocked': 'bad',
  'heal.failed': 'bad',
  'approve.rejected': 'warn',
  'heal.gate': 'warn',
};

/**
 * Incident — the seven-stage timeline.
 *
 * Every event Molt's engine recorded, in order, with the Collector ID pinned at
 * the top unchanged throughout. This is the audit trail a "did the fix actually
 * stick" question gets answered from.
 */
export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo } = await getContext();

  const incident = await repo.getIncident(id);
  if (incident === null) notFound();

  const collector = await repo.getCollector(incident.collectorId);
  const events = await repo.listEvents(id);
  const commands = await repo.listCommandsForIncident(id);

  const badRuns = events.filter(
    (e) => e.kind === 'detected' || e.kind === 'observed.still-broken',
  ).length;
  const cost = costOfSilence({
    openedAt: incident.openedAt,
    closedAt: incident.closedAt,
    now: new Date().toISOString(),
    badRuns,
  });
  const credits = summariseCredits(commands);

  return (
    <>
      <div className="crumb">
        <Link href="/">Fleet</Link> /{' '}
        <Link href={`/c/${incident.collectorId}`}>{collector?.name ?? incident.collectorId}</Link> /
        incident
      </div>

      <div className="page-head flex items-end justify-between">
        <div>
          <h1 className="mono text-lg">{incident.id}</h1>
          <p>
            <span className="pill pill-accent">{incident.collectorId}</span> unchanged throughout
          </p>
        </div>
        <Badge value={incident.state} />
      </div>

      <div className="faint mb-4 flex gap-4 text-xs">
        <span className={cost.ongoing ? 'text-[var(--warn)]' : ''}>
          {describeCostOfSilence(cost)}
        </span>
        {credits.commandCount > 0 && (
          <span title="Estimated relative usage — Bright Data publishes no per-operation price list.">
            ~{credits.total} credits ({credits.commandCount} commands)
          </span>
        )}
      </div>

      {incident.state === 'awaiting_approval' && (
        <Link
          href={`/i/${incident.id}/review`}
          className="card block border-[var(--accent)] bg-[var(--accent-bg)]"
        >
          <strong className="text-[var(--accent)]">A fix is awaiting your review →</strong>
        </Link>
      )}

      <div className="card">
        <div className="card-title">What broke</div>
        <div className="mb-3">{incident.report.summary}</div>
        <ScoreBar score={incident.report.score} />
        <table className="datagrid mt-4">
          <thead>
            <tr>
              <th>field</th>
              <th>kind</th>
              <th className="num">baseline</th>
              <th className="num">now</th>
            </tr>
          </thead>
          <tbody>
            {incident.report.faults.map((f) => (
              <tr key={f.field}>
                <td className="mono">{f.field}</td>
                <td>
                  <span
                    className={
                      f.kind === 'collapsed' || f.kind === 'vanished' ? 'diff-broken' : 'muted'
                    }
                  >
                    {f.kind}
                  </span>
                </td>
                <td className="num">
                  {'baselineRate' in f
                    ? `${Math.round(f.baselineRate * 100)}%`
                    : 'baselineMagnitude' in f
                      ? f.baselineMagnitude
                      : '—'}
                </td>
                <td className="num">
                  {'currentRate' in f
                    ? `${Math.round(f.currentRate * 100)}%`
                    : 'currentMagnitude' in f
                      ? f.currentMagnitude
                      : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {incident.healPrompt && (
        <div className="card">
          <div className="card-title">
            Generated heal prompt · {incident.healPrompt.length}/1000 chars
          </div>
          <div className="command-line whitespace-pre-wrap">{incident.healPrompt}</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Timeline</div>
        <div className="timeline">
          {events.map((event) => (
            <div key={event.id} className={`timeline-item tl-${EVENT_TONE[event.kind] ?? ''}`}>
              <div className="flex items-baseline gap-2.5">
                <span className="mono faint text-[11.5px]">{timeOnly(event.at)}</span>
                <strong className="text-[13px]">{event.kind}</strong>
              </div>
              {event.detail && <div className="muted mt-0.5 text-[12.5px]">{event.detail}</div>}
            </div>
          ))}
        </div>
      </div>

      {commands.length > 0 && (
        <div className="card">
          <div className="card-title">Commands run</div>
          <div className="grid gap-2">
            {commands.map((cmd) => (
              <div key={cmd.id} className="command-line">
                <span className="prompt">$</span> {cmd.display}
                <span className="faint">
                  {' '}
                  {cmd.durationMs}ms · exit {cmd.exitCode ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="faint mt-4 text-xs">
        opened {relativeTime(incident.openedAt)} · attempts {incident.attempts}
        {incident.closedAt && <> · closed {relativeTime(incident.closedAt)}</>}
      </div>
    </>
  );
}
