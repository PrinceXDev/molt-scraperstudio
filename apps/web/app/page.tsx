import Link from 'next/link';

import { Badge } from '@/components/Badge';
import { getContext } from '@/lib/context';
import { relativeTime } from '@/lib/format';
import { buildHeatmap, cellLabel, type Cell, type Heatmap } from '@/lib/heatmap';

export const dynamic = 'force-dynamic';

/** Same classification as `cellColor`, expressed as a static Tailwind class so the JIT scanner can find it. */
function barColorClass(cell: Cell | undefined): string {
  if (cell === undefined) return 'bg-[var(--line-soft)]';
  if (cell.kind === 'distorted' && cell.magnitude === 0) return 'bg-[var(--bad)]';
  switch (cell.kind) {
    case 'healthy':
      return 'bg-[var(--good)]';
    case 'appeared':
      return 'bg-[#5a96ff]';
    case 'degraded':
    case 'distorted':
      return 'bg-[var(--warn)]';
    case 'collapsed':
    case 'vanished':
      return 'bg-[var(--bad)]';
  }
}

/**
 * Fleet — one card per collector.
 *
 * What a terminal can show as a one-line status strip, this renders as a scannable
 * grid: health, per-field fill-rate history at a glance, and whether anything is
 * waiting on a human. This is the screen a judge lands on first.
 */
export default async function FleetPage() {
  const { repo } = await getContext();
  const collectors = await repo.listCollectors();

  const rows = await Promise.all(
    collectors.map(async (collector) => {
      const snapshots = await repo.listSnapshots(collector.id, 12);
      const latest = snapshots.at(-1) ?? null;
      const baseline = await repo.getBaseline(collector.id);
      // Classified against the baseline, not raw fill rate — a zeroed field
      // fills on every row, so a bare percentage here would show the exact
      // false-green signal this project exists to catch.
      const heatmap: Heatmap | null = baseline
        ? buildHeatmap(collector.id, baseline, snapshots)
        : null;
      const open = await repo.getOpenIncident(collector.id);
      return { collector, snapshots, latest, open, heatmap };
    }),
  );

  return (
    <>
      <div className="page-head">
        <h1>Fleet</h1>
        <p>Every collector Molt watches, and whether its data is still true.</p>
      </div>

      {rows.length === 0 && (
        <div className="card empty-state">
          No collectors registered. Run <code className="pill">molt init</code> from the terminal.
        </div>
      )}

      <div className="grid grid-cols-1">
        {rows.map(({ collector, latest, open, heatmap }) => (
          <Link key={collector.id} href={`/c/${collector.id}`} className="card block">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-1 flex items-center gap-2.5">
                  <strong className="text-[15px]">{collector.name}</strong>
                  <span className="pill pill-accent">{collector.id}</span>
                  <span className="faint text-[11.5px] uppercase tracking-[0.05em]">
                    {collector.kind}
                  </span>
                </div>
                <div className="muted text-[12.5px]">{collector.targetUrl}</div>
              </div>

              <div className="flex items-center gap-2.5">
                {open ? (
                  <Badge value={open.state} />
                ) : latest ? (
                  <span className="badge badge-healthy">watching</span>
                ) : (
                  <span className="badge bg-[var(--bg-elevated-2)] text-[var(--fg-faint)]">
                    never run
                  </span>
                )}
              </div>
            </div>

            {heatmap && (
              <div className="mt-4 grid gap-1.5">
                {heatmap.fields.map((field) => {
                  const history = heatmap.columns.map((col) => col.cells.get(field));
                  const current = history.at(-1);
                  const isFault =
                    current !== undefined &&
                    current.kind !== 'healthy' &&
                    current.kind !== 'appeared';

                  return (
                    <div
                      key={field}
                      className="grid grid-cols-[140px_1fr_56px] items-center gap-2.5 text-xs"
                    >
                      <span className="mono muted">{field}</span>
                      <span className="sparkline">
                        {history.map((cell, i) => (
                          <span
                            key={heatmap.columns[i]?.capturedAt ?? i}
                            className={`bar ${barColorClass(cell)}`}
                            style={{ height: cell === undefined ? 3 : Math.max(3, cell.rate * 20) }}
                          />
                        ))}
                      </span>
                      <span
                        className={`mono text-right ${
                          isFault ? 'font-bold text-[var(--bad)]' : 'font-normal text-[var(--fg-faint)]'
                        }`}
                      >
                        {cellLabel(current)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="faint mt-3.5 flex justify-between text-xs">
              <span>
                {latest
                  ? `${latest.rowCount} rows · last run ${relativeTime(latest.capturedAt)}`
                  : 'no runs yet'}
              </span>
              {open && <span>{open.report.summary}</span>}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
