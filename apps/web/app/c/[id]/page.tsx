import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/Badge';
import { getContext } from '@/lib/context';
import { relativeTime, timeOnly } from '@/lib/format';
import { buildHeatmap, type Cell } from '@/lib/heatmap';

export const dynamic = 'force-dynamic';

/** Same classification as `cellColor`/`cellOpacity`, expressed as static Tailwind classes. */
function heatCellClass(cell: Cell | undefined): string {
  if (cell === undefined) return 'bg-[var(--line-soft)] opacity-30';
  if (cell.kind === 'distorted' && cell.magnitude === 0) return 'bg-[var(--bad)] opacity-100';
  const opacity =
    cell.kind === 'healthy' || cell.kind === 'appeared' ? 'opacity-55' : 'opacity-100';
  switch (cell.kind) {
    case 'healthy':
      return `bg-[var(--good)] ${opacity}`;
    case 'appeared':
      return `bg-[#5a96ff] ${opacity}`;
    case 'degraded':
    case 'distorted':
      return `bg-[var(--warn)] ${opacity}`;
    case 'collapsed':
    case 'vanished':
      return `bg-[var(--bad)] ${opacity}`;
  }
}

/**
 * Collector — the field × run heatmap.
 *
 * See `lib/heatmap.ts` for why every cell is reclassified against the
 * baseline rather than coloured by raw fill rate.
 */
export default async function CollectorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo } = await getContext();

  const collector = await repo.getCollector(id);
  if (collector === null) notFound();

  const baseline = await repo.getBaseline(id);
  const history = await repo.listSnapshots(id, 24);
  const open = await repo.getOpenIncident(id);
  const incidents = await repo.listIncidents(20);
  const collectorIncidents = incidents.filter((i) => i.collectorId === id);

  const heatmap = baseline ? buildHeatmap(id, baseline, history) : null;

  return (
    <>
      <div className="crumb">
        <Link href="/">Fleet</Link> / {collector.name}
      </div>

      <div className="page-head flex items-end justify-between">
        <div>
          <h1>{collector.name}</h1>
          <p>
            <span className="pill pill-accent">{collector.id}</span>{' '}
            <a href={collector.targetUrl} target="_blank" rel="noreferrer" className="muted">
              {collector.targetUrl}
            </a>
          </p>
        </div>
        {open && <Badge value={open.state} />}
      </div>

      {open && (
        <Link
          href={open.state === 'awaiting_approval' ? `/i/${open.id}/review` : `/i/${open.id}`}
          className="card block border-[var(--accent-dim)]"
        >
          <div className="card-title text-[var(--accent)]">Open incident</div>
          <div className="flex items-center justify-between">
            <div>{open.report.summary}</div>
            <Badge value={open.state} />
          </div>
        </Link>
      )}

      <div className="card">
        <div className="card-title">Field × run health</div>
        {heatmap === null ? (
          <div className="empty-state">
            No baseline yet. Run the collector once to establish one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="datagrid">
              <thead>
                <tr>
                  <th className="min-w-[160px]">field</th>
                  {heatmap.columns.map((col) => (
                    <th key={col.capturedAt} className="text-center" title={col.capturedAt}>
                      {timeOnly(col.capturedAt)}
                      {col.isBaseline && (
                        <div className="faint text-[10px] font-normal normal-case">baseline</div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.fields.map((field) => (
                  <tr key={field}>
                    <td className="mono">{field}</td>
                    {heatmap.columns.map((col) => {
                      const cell = col.cells.get(field);
                      return (
                        <td key={col.capturedAt} className="text-center">
                          <span
                            className={`heat-cell inline-block ${heatCellClass(cell)}`}
                            title={
                              cell
                                ? `${field}: ${cell.kind} · rate ${Math.round(cell.rate * 100)}%${cell.magnitude !== null ? ` · typical ${cell.magnitude}` : ''}`
                                : `${field}: no data`
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="faint mt-3.5 flex gap-4 text-[11.5px]">
              <Legend colorClass="bg-[var(--good)]" label="healthy" />
              <Legend colorClass="bg-[var(--warn)]" label="degraded / distorted" />
              <Legend colorClass="bg-[var(--bad)]" label="collapsed / vanished / zeroed" />
              <Legend colorClass="bg-[#5a96ff]" label="new field" />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Incident history</div>
        {collectorIncidents.length === 0 ? (
          <div className="empty-state">No incidents. Every run has matched the baseline.</div>
        ) : (
          <table className="datagrid">
            <thead>
              <tr>
                <th>opened</th>
                <th>state</th>
                <th>summary</th>
                <th className="num">attempts</th>
              </tr>
            </thead>
            <tbody>
              {collectorIncidents.map((incident) => (
                <tr key={incident.id}>
                  <td className="mono faint">{relativeTime(incident.openedAt)}</td>
                  <td>
                    <Link
                      href={
                        incident.state === 'awaiting_approval'
                          ? `/i/${incident.id}/review`
                          : `/i/${incident.id}`
                      }
                    >
                      <Badge value={incident.state} />
                    </Link>
                  </td>
                  <td>{incident.report.summary}</td>
                  <td className="num">{incident.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Legend({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <span className={`inline-block h-2 w-2 rounded-sm ${colorClass}`} />
      {label}
    </span>
  );
}
