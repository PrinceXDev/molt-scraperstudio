'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';

import { runLiveCheck, type LiveCheckSuccess } from '@/app/(site)/playground/actions';
import { AlertIcon } from '@/components/icons';
import { FactRow, ResultShell, type ResultState } from '@/components/playground/ResultShell';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { cn } from '@/lib/cn';

/**
 * A real `molt check` against whichever collector is registered as
 * `kind: 'chaos'` in the database.
 *
 * `collectorId` is resolved server-side, fresh on every page load, from the same
 * database `molt init` populates (`lib/registered-collector.ts`) — not a value
 * kept anywhere in this codebase. It is `null` in exactly one case: the flag is
 * on but nothing of kind `chaos` has been registered yet, which is a real,
 * nameable state rather than something to let the run button discover by
 * failing.
 *
 * The only tab that spends credits, so the only one with a confirmation step.
 * When the deployment has it switched off, this renders a documented explanation
 * of *why* rather than a greyed-out button — "why can't I click this" is a worse
 * experience than being told plainly that live runs are disabled and what turns
 * them on.
 */
export function LiveCheckPanel({
  enabled,
  collectorId,
}: {
  readonly enabled: boolean;
  readonly collectorId: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<ResultState>('empty');
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | undefined>(undefined);
  const [data, setData] = useState<LiveCheckSuccess | null>(null);
  const [pending, startTransition] = useTransition();

  const registered = enabled && collectorId !== null;

  const submit = () => {
    setConfirming(false);
    setState('running');
    setError(null);
    setRetryAfter(undefined);

    startTransition(async () => {
      const result = await runLiveCheck();
      if (result.ok) {
        setData(result);
        setState('result');
      } else {
        setError(result.message);
        setRetryAfter(result.retryAfterSeconds);
        setState('error');
      }
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      <div className="grid content-start gap-5">
        <div className="grid gap-3 rounded-md border border-line bg-surface p-5 shadow-sm">
          <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
            What this runs
          </p>
          <p className="prose-measure text-[0.875rem] leading-relaxed text-muted">
            One real <code className="font-mono text-ink">bdata scraper run</code> against the
            registered chaos collector, through the same{' '}
            <code className="font-mono text-ink">Engine</code> the cockpit and{' '}
            <code className="font-mono text-ink">molt check</code> use — then a snapshot, a
            comparison against the baseline, and an incident if anything drifted.
          </p>
          <div className="mt-1">
            <FactRow label="Collector" tone={registered ? 'neutral' : 'warn'}>
              {collectorId ?? 'not registered'}
            </FactRow>
            <FactRow label="Expected duration">30–90s</FactRow>
            <FactRow label="Cost" tone="warn">
              ~1 credit (estimated)
            </FactRow>
          </div>
        </div>

        {!enabled ? (
          <div className="flex gap-3 rounded-md border border-warn/35 bg-warn-soft px-4 py-3.5">
            <AlertIcon className="mt-0.5 shrink-0 text-warn" />
            <div className="grid gap-1.5">
              <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-warn">
                Disabled on this deployment
              </p>
              <p className="text-[0.8125rem] leading-relaxed text-ink">
                Live checks spend Bright Data credits and need a configured account, so they are off
                unless <code className="font-mono">MOLT_PLAYGROUND_LIVE=1</code> is set. The other
                two tabs are fully functional without it — the{' '}
                <span className="font-medium">Drift replay</span> tab runs the same detection core
                this one would, on data you supply.
              </p>
            </div>
          </div>
        ) : !registered ? (
          <div className="flex gap-3 rounded-md border border-warn/35 bg-warn-soft px-4 py-3.5">
            <AlertIcon className="mt-0.5 shrink-0 text-warn" />
            <div className="grid gap-1.5">
              <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-warn">
                No chaos collector registered
              </p>
              <p className="text-[0.8125rem] leading-relaxed text-ink">
                Live checks are enabled, but this deployment's database has nothing registered as
                the chaos collector yet. Set <code className="font-mono">MOLT_COLLECTOR_CHAOS</code>{' '}
                in <code className="font-mono">.env</code> and run{' '}
                <code className="font-mono">molt init</code>, then reload this page.
              </p>
            </div>
          </div>
        ) : confirming ? (
          <div className="grid gap-3 rounded-md border border-accent-dim bg-accent-soft p-4">
            <p className="text-[0.8125rem] leading-relaxed text-ink">
              This spends a credit and takes up to 90 seconds. Continue?
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={submit} loading={pending}>
                Yes, run it
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => setConfirming(true)} loading={pending}>
              Run a live check
            </Button>
          </div>
        )}

        <p className="text-[0.75rem] leading-relaxed text-faint">
          Rate-limited to 3 runs per 15 minutes. See{' '}
          <Link
            href="/docs/credits"
            className="text-accent underline decoration-accent/35 underline-offset-2"
          >
            Credits
          </Link>{' '}
          for why the cost above is an estimate rather than a price.
        </p>
      </div>

      <ResultShell
        state={state}
        error={error}
        retryAfterSeconds={retryAfter}
        emptyHint={
          registered
            ? 'Run a live check to see a real collector run end to end.'
            : 'Live checks are not available here right now. The Drift replay tab demonstrates the same detection logic without an account.'
        }
        runningHint="Spawning the Bright Data CLI, snapshotting, comparing to baseline… this takes up to 90 seconds."
        toolbar={
          data !== null && <CopyButton value={JSON.stringify(data, null, 2)} label="Copy JSON" />
        }
      >
        {data !== null && (
          <div className="grid gap-5">
            {data.baselineEstablished ? (
              <div className="rounded-sm border border-info/30 bg-info-soft px-3.5 py-3">
                <p className="font-mono text-[0.8125rem] font-semibold uppercase tracking-wider text-info">
                  Baseline established
                </p>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink">
                  This run had nothing to compare against, so it became the baseline. Run it again
                  after the target changes.
                </p>
              </div>
            ) : data.report !== null ? (
              <div
                className={cn(
                  'rounded-sm border px-3.5 py-3',
                  data.report.status === 'healthy'
                    ? 'border-good/30 bg-good-soft'
                    : data.report.status === 'degraded'
                      ? 'border-warn/30 bg-warn-soft'
                      : 'border-bad/30 bg-bad-soft',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      'font-mono text-[0.8125rem] font-semibold uppercase tracking-wider',
                      data.report.status === 'healthy'
                        ? 'text-good'
                        : data.report.status === 'degraded'
                          ? 'text-warn'
                          : 'text-bad',
                    )}
                  >
                    {data.report.status}
                  </span>
                  <span className="font-mono text-[0.8125rem] text-ink">
                    score {data.report.score}
                  </span>
                </div>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink">
                  {data.report.summary}
                </p>
              </div>
            ) : null}

            <div>
              <FactRow label="Collector">{data.collectorId}</FactRow>
              <FactRow label="Rows returned">{data.rowCount}</FactRow>
              {data.durationMs !== null && <FactRow label="Duration">{data.durationMs} ms</FactRow>}
              {data.incidentState !== null && (
                <FactRow label="Incident" tone="warn">
                  {data.incidentState}
                </FactRow>
              )}
            </div>

            {data.command !== null && (
              <div className="grid gap-2">
                <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
                  Command run
                </p>
                <pre className="scrollable-x rounded-sm border border-line bg-inset px-3 py-2.5 font-mono text-[0.75rem] text-ink">
                  {data.command}
                </pre>
              </div>
            )}

            {data.incidentId !== null && (
              <Link
                href={`/fleet/i/${data.incidentId}`}
                className="rounded-sm border border-line bg-surface-2 px-3.5 py-2.5 text-[0.8125rem] text-ink transition-colors hover:border-line-strong"
              >
                Open this incident in the cockpit →
              </Link>
            )}
          </div>
        )}
      </ResultShell>
    </div>
  );
}
