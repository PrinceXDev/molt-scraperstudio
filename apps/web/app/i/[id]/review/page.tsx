import Link from 'next/link';
import { notFound } from 'next/navigation';

import { projectRows, type UnknownRecord } from '@molt/brightdata';
import { buildReviewRows, isSampleTooSmallToCompare } from '@molt/diagnose';
import { buildSnapshot } from '@molt/health';

import { Badge } from '@/components/Badge';
import { DecisionButtons } from '@/components/DecisionButtons';
import { getContext } from '@/lib/context';
import { magnitude, percent } from '@/lib/format';

export const dynamic = 'force-dynamic';

function asRows(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is UnknownRecord => v !== null && typeof v === 'object');
}

/**
 * Heal Review — the screen this project's UI exists for.
 *
 * A terminal can print "2 fields recovered". It cannot make you *see* twenty
 * rows of baseline, broken, and proposed side by side. That is this screen's
 * entire licence to exist, and it is built on `buildReviewRows` from
 * `@molt/diagnose` — the exact logic `molt review` renders as text, so a
 * decision made here matches a decision made in the terminal.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo } = await getContext();

  const incident = await repo.getIncident(id);
  if (incident === null) notFound();

  const collector = await repo.getCollector(incident.collectorId);

  const rawPreview = asRows(incident.previewResult);
  const preview = projectRows(rawPreview, {
    ...(collector?.recordPath == null ? {} : { recordPath: collector.recordPath }),
    inherit: collector?.inherit ?? [],
  });

  const previewSnapshot =
    preview.length > 0
      ? buildSnapshot({
          collectorId: incident.collectorId,
          capturedAt: new Date().toISOString(),
          rows: preview,
        })
      : null;

  const rows = previewSnapshot ? buildReviewRows(incident.report, previewSnapshot.fields) : [];
  const unrecovered = rows.filter((r) => r.wasFaulty && !r.recovered);
  const sampleTooSmall =
    rows.some((r) => r.measure === 'value') &&
    isSampleTooSmallToCompare(preview.length, incident.report.baselineRowCount);

  const commands = await repo.listCommandsForIncident(id);
  const healCommand = commands.find((c) => c.display.includes('scraper heal'));

  return (
    <>
      <div className="crumb">
        <Link href="/">Fleet</Link> /{' '}
        <Link href={`/c/${incident.collectorId}`}>{collector?.name ?? incident.collectorId}</Link> /{' '}
        <Link href={`/i/${incident.id}`}>incident</Link> / review
      </div>

      <div className="page-head flex items-end justify-between">
        <div>
          <h1>Heal review</h1>
          <p>
            <span className="pill pill-accent">{incident.collectorId}</span> — same before and after
            this decision.
          </p>
        </div>
        <Badge value={incident.state} />
      </div>

      {incident.state !== 'awaiting_approval' && (
        <div className="card border-[var(--line)]">
          <p className="muted">
            This incident is <Badge value={incident.state} /> — nothing is currently awaiting a
            decision.{' '}
            <Link href={`/i/${incident.id}`} className="accent-text">
              View the incident →
            </Link>
          </p>
        </div>
      )}

      <div className="card">
        <div className="card-title">What broke</div>
        <div className="mb-2.5">{incident.report.summary}</div>
        {incident.healPrompt && (
          <>
            <div className="faint mt-4 mb-1.5 text-[11px] uppercase tracking-[0.06em]">
              Generated heal prompt · {incident.healPrompt.length}/1000 chars
            </div>
            <div className="command-line whitespace-pre-wrap">{incident.healPrompt}</div>
          </>
        )}
        {healCommand && (
          <div className="command-line mt-2.5">
            <span className="prompt">$</span> {healCommand.display}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          Proposed fix {preview.length > 0 && `· ${preview.length} preview rows`}
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">The heal returned no preview rows to review.</div>
        ) : (
          <>
            <div className="scrollable-x">
              <table className="datagrid">
                <thead>
                  <tr>
                    <th>field</th>
                    <th className="num">baseline</th>
                    <th className="num">broken</th>
                    <th className="num">preview</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const fmt = row.measure === 'fill' ? percent : magnitude;

                    return (
                      <tr key={row.field} className={!row.wasFaulty ? 'opacity-55' : undefined}>
                        <td className="mono">{row.field}</td>
                        <td className="num faint">{fmt(row.baseline)}</td>
                        <td className={`num ${row.wasFaulty ? 'diff-broken' : 'faint'}`}>
                          {fmt(row.broken)}
                        </td>
                        <td
                          className={`num ${row.wasFaulty ? (row.recovered ? 'diff-recovered' : 'diff-broken') : 'faint'}`}
                        >
                          {fmt(row.preview)}
                        </td>
                        <td className="w-6 text-center">
                          {!row.wasFaulty ? (
                            <span className="faint">·</span>
                          ) : row.recovered ? (
                            <span className="text-[var(--good)]">✓</span>
                          ) : (
                            <span className="text-[var(--bad)]">✗</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sampleTooSmall && (
              <p className="faint mt-3 text-xs">
                Typical values come from {preview.length} preview rows against{' '}
                {incident.report.baselineRowCount} at baseline, so expect them to differ in size
                even when correct. What matters is that a zeroed field is no longer zero.
              </p>
            )}

            <p className="mt-3.5 text-[13.5px]">
              {unrecovered.length === 0 ? (
                <span className="text-[var(--good)]">
                  Every broken field recovers in the preview.
                </span>
              ) : (
                <span className="text-[var(--bad)]">
                  {unrecovered.length} field(s) still wrong in the preview:{' '}
                  {unrecovered.map((r) => r.field).join(', ')}
                </span>
              )}
            </p>
          </>
        )}
      </div>

      {incident.state === 'awaiting_approval' && (
        <div className="card border-[var(--accent-dim)]">
          <div className="card-title text-[var(--accent)]">Decide</div>
          <DecisionButtons incidentId={incident.id} />
        </div>
      )}
    </>
  );
}
