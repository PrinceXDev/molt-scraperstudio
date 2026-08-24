'use client';

import { useState, useTransition } from 'react';

import { runReplay, type ReplaySuccess } from '@/app/(site)/playground/actions';
import { exampleAsJson, REPLAY_EXAMPLES, type ReplayExample } from '@/content/playground/examples';
import { FactRow, ResultShell, type ResultState } from '@/components/playground/ResultShell';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { TextArea } from '@/components/ui/Field';
import { cellSeverity, type Cell } from '@/lib/heatmap';
import { cn } from '@/lib/cn';

/**
 * Drift replay — the detection core, run in a browser.
 *
 * This is the tab that actually demonstrates the product's claim rather than
 * describing it. Paste two row sets (or load one of the bundled examples) and
 * the real `buildSnapshot` → `compareSnapshots` → `diagnose` pipeline runs over
 * them: no network, no credits, no Bright Data account. `packages/health` is
 * pure precisely so this is possible.
 *
 * The verdict table reuses `cellSeverity` from `lib/heatmap.ts` — the same single
 * source of truth the cockpit's heatmap and the landing page's hero grid use, so
 * a `distorted` field with a zero magnitude reads `bad` here for exactly the same
 * reason it does everywhere else.
 */

const DEFAULT_EXAMPLE = REPLAY_EXAMPLES[0] as ReplayExample;

/** Findings carry different fields per kind; this reads whichever exist. */
function findingCell(finding: ReplaySuccess['report']['findings'][number]): Cell {
  const rate =
    'rate' in finding ? finding.rate : 'currentRate' in finding ? finding.currentRate : 0;
  const magnitude = 'currentMagnitude' in finding ? finding.currentMagnitude : null;
  return { kind: finding.kind, rate, magnitude };
}

function describeFinding(finding: ReplaySuccess['report']['findings'][number]): string {
  switch (finding.kind) {
    case 'healthy':
      return `${Math.round(finding.rate * 100)}% fill`;
    case 'appeared':
      return `new · ${Math.round(finding.currentRate * 100)}% fill`;
    case 'collapsed':
      return `${Math.round(finding.baselineRate * 100)}% → ${Math.round(finding.currentRate * 100)}% fill`;
    case 'degraded':
      return `${Math.round(finding.baselineRate * 100)}% → ${Math.round(finding.currentRate * 100)}% fill`;
    case 'distorted':
      return `typical ${finding.baselineMagnitude} → ${finding.currentMagnitude}`;
    case 'flatlined':
      return `${finding.baselineDistinct} → ${finding.currentDistinct} distinct values`;
    case 'vanished':
      return `was ${Math.round(finding.baselineRate * 100)}% fill, now absent`;
  }
}

const SEVERITY_CLASS = {
  good: 'text-good',
  info: 'text-info',
  warn: 'text-warn',
  bad: 'font-semibold text-bad',
  unknown: 'text-faint',
} as const;

export function ReplayPanel() {
  const [exampleId, setExampleId] = useState(DEFAULT_EXAMPLE.id);
  const [baseline, setBaseline] = useState(() => exampleAsJson(DEFAULT_EXAMPLE.baseline));
  const [current, setCurrent] = useState(() => exampleAsJson(DEFAULT_EXAMPLE.current));
  const [state, setState] = useState<ResultState>('empty');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReplaySuccess | null>(null);
  const [pending, startTransition] = useTransition();

  // Baseline must carry at least one row for a comparison to mean anything;
  // current legitimately being empty-array's-worth of text (`[]`) is fine —
  // that is how an empty harvest is expressed — but a blank textarea is not the
  // same thing and the server action would refuse it anyway. Checking here
  // means the button (and the keyboard shortcut below) says so up front instead
  // of a round trip just to report it.
  const canSubmit = baseline.trim() !== '' && current.trim() !== '';

  // Mirrors `canSubmit`'s reasoning for Reset: disabled only when reloading the
  // default example would be a genuine no-op — already showing it, with
  // nothing typed over it, and no result on screen to clear.
  const isPristine =
    exampleId === DEFAULT_EXAMPLE.id &&
    baseline === exampleAsJson(DEFAULT_EXAMPLE.baseline) &&
    current === exampleAsJson(DEFAULT_EXAMPLE.current) &&
    state === 'empty';

  const loadExample = (example: ReplayExample) => {
    setExampleId(example.id);
    setBaseline(exampleAsJson(example.baseline));
    setCurrent(exampleAsJson(example.current));
    setState('empty');
    setData(null);
    setError(null);
  };

  const submit = () => {
    if (!canSubmit) return;

    setState('running');
    setError(null);

    startTransition(async () => {
      const result = await runReplay(baseline, current);
      if (result.ok) {
        setData(result);
        setState('result');
      } else {
        setError(result.message);
        setState('error');
      }
    });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  const active = REPLAY_EXAMPLES.find((e) => e.id === exampleId);
  const report = data?.report ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      <div className="grid content-start gap-5">
        <div className="grid gap-2">
          <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">Examples</p>
          <div className="flex flex-wrap gap-2">
            {REPLAY_EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                onClick={() => loadExample(example)}
                aria-pressed={example.id === exampleId}
                className={cn(
                  'rounded-sm border px-2.5 py-1.5 font-mono text-[0.71875rem] transition-colors',
                  example.id === exampleId
                    ? 'border-accent-dim bg-accent-soft text-accent'
                    : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {example.label}
              </button>
            ))}
          </div>
          {active !== undefined && (
            <p className="prose-measure text-[0.75rem] leading-relaxed text-faint">
              {active.summary}
            </p>
          )}
        </div>

        <TextArea
          label={
            <>
              Baseline rows{' '}
              <span className="font-normal text-faint">— the healthy reference</span>
            </>
          }
          value={baseline}
          onChange={(event) => setBaseline(event.target.value)}
          onKeyDown={onKeyDown}
          rows={9}
          hint="What a working run looked like. Molt compares everything below against this — edit it only to change the starting shape (different fields, more rows, more distinct values)."
          error={null}
        />

        <TextArea
          label={
            <>
              Current rows <span className="font-normal text-faint">— the latest run</span>
            </>
          }
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          onKeyDown={onKeyDown}
          rows={9}
          hint="What the scraper just returned. Edit this to simulate drift — zero a field, set it to null, drop it, or use [] for an empty harvest."
          error={null}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={submit} loading={pending} disabled={!canSubmit}>
            Detect drift
          </Button>
          <Button
            variant="ghost"
            onClick={() => loadExample(DEFAULT_EXAMPLE)}
            disabled={pending || isPristine}
          >
            Reset
          </Button>
          <span className="font-mono text-[0.6875rem] text-faint">⌘↵ to run</span>
        </div>
      </div>

      <ResultShell
        state={state}
        error={error}
        emptyHint="Pick an example or paste your own rows, then detect drift. This runs the real detection core — no network, no credits."
        runningHint="Comparing snapshots…"
        toolbar={
          report !== null && (
            <CopyButton value={JSON.stringify(report, null, 2)} label="Copy JSON" />
          )
        }
      >
        {report !== null && data !== null && (
          <div className="grid gap-5">
            <div
              className={cn(
                'rounded-sm border px-3.5 py-3',
                report.status === 'healthy'
                  ? 'border-good/30 bg-good-soft'
                  : report.status === 'degraded'
                    ? 'border-warn/30 bg-warn-soft'
                    : 'border-bad/30 bg-bad-soft',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    'font-mono text-[0.8125rem] font-semibold uppercase tracking-wider',
                    report.status === 'healthy'
                      ? 'text-good'
                      : report.status === 'degraded'
                        ? 'text-warn'
                        : 'text-bad',
                  )}
                >
                  {report.status}
                </span>
                <span className="font-mono text-[0.8125rem] text-ink">score {report.score}</span>
              </div>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink">{report.summary}</p>
            </div>

            <div>
              <FactRow label="Rows compared">
                {data.baselineRows} → {data.currentRows}
              </FactRow>
              <FactRow label="Faults" tone={report.faults.length > 0 ? 'bad' : 'good'}>
                {report.faults.length} of {report.findings.length} fields
              </FactRow>
              {report.emptyHarvest && (
                <FactRow label="Empty harvest" tone="bad">
                  yes
                </FactRow>
              )}
            </div>

            <div className="grid gap-2">
              <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
                Field verdicts
              </p>
              <div className="scrollable-x rounded-sm border border-line">
                <table className="w-full border-collapse text-[0.78125rem]">
                  <thead>
                    <tr className="border-b border-line">
                      {['field', 'verdict', 'evidence'].map((header) => (
                        <th
                          key={header}
                          className="bg-surface-2 px-3 py-1.5 text-left font-mono text-[0.625rem] font-semibold uppercase tracking-wider text-faint"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.findings.map((finding) => {
                      const severity = cellSeverity(findingCell(finding));
                      return (
                        <tr
                          key={finding.field}
                          className="border-b border-line-soft last:border-b-0"
                        >
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-ink">
                            {finding.field}
                          </td>
                          <td className={cn('px-3 py-2 font-mono', SEVERITY_CLASS[severity])}>
                            {finding.kind}
                          </td>
                          <td className="px-3 py-2 font-mono text-muted">
                            {describeFinding(finding)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {data.prompt !== null ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
                    Generated heal prompt · {data.promptChars}/{data.promptMaxChars}
                    {data.promptTruncated && ' · truncated'}
                  </p>
                  <CopyButton value={data.prompt} />
                </div>
                <pre className="scrollable-x rounded-sm border border-line bg-inset px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap text-ink">
                  {data.prompt}
                </pre>
                <p className="text-[0.71875rem] leading-relaxed text-faint">
                  This is the exact string Molt would pass to{' '}
                  <code className="font-mono text-muted">bdata scraper heal</code> — derived from
                  the measured drift, naming the broken fields and the working ones.
                </p>
              </div>
            ) : (
              <p className="rounded-sm border border-line bg-surface-2 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-muted">
                No faults, so no heal prompt. A detector that cannot stay quiet on a healthy run is
                worse than useless.
              </p>
            )}
          </div>
        )}
      </ResultShell>
    </div>
  );
}
