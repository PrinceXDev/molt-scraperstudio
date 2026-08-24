'use client';

import { useState, useTransition } from 'react';

import { runPreflight, type PreflightSuccess } from '@/app/(site)/playground/actions';
import { CheckIcon, CloseIcon } from '@/components/icons';
import { FactRow, ResultShell, type ResultState } from '@/components/playground/ResultShell';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { TextField } from '@/components/ui/Field';
import { cn } from '@/lib/cn';

/**
 * "Is this URL a viable collector target?" — answered for real, for free.
 *
 * The honest version of a live-URL tab. It does not pretend to scrape the page:
 * it runs the exact preflight `molt add` runs before spending a `create` call,
 * and reports the three things that actually decide whether a target works —
 * size against the ~200 KB ceiling, robots.txt, and the link graph.
 */

/**
 * Four real pages chosen for range: different sizes, different robots.txt
 * postures, and one that is refused before any request is made at all. Real
 * sites change their own robots.txt on their own schedule, so this is "chosen
 * to demonstrate variety today", not a guarantee any two stay distinct forever
 * — if one drifts to matching another's verdict, that is the live web being the
 * live web, not a bug here.
 *
 * The chaos target deliberately is not one of them: it is Molt's own demo
 * collector, not a generic "here is a page you could point a scraper at"
 * example, and showing it here read as an unrelated suggestion rather than
 * something worth trying.
 */
const SUGGESTIONS = [
  { label: 'PostgreSQL advisories', url: 'https://www.postgresql.org/support/security/' },
  // Built for exactly this: a static, paginated catalogue with a shape any
  // scraper description can name in one sentence.
  { label: 'books.toscrape.com', url: 'https://books.toscrape.com/' },
  { label: 'kernel.org', url: 'https://www.kernel.org/' },
  { label: 'Blocked: cloud metadata', url: 'http://169.254.169.254/latest/meta-data/' },
] as const;

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function PreflightPanel() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ResultState>('empty');
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | undefined>(undefined);
  const [data, setData] = useState<PreflightSuccess | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (target: string) => {
    if (target.trim() === '') return;

    setState('running');
    setError(null);
    setRetryAfter(undefined);

    startTransition(async () => {
      const result = await runPreflight(target);
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

  const reset = () => {
    setUrl('');
    setData(null);
    setError(null);
    setRetryAfter(undefined);
    setState('empty');
  };

  const report = data?.report ?? null;
  const go = report !== null && report.blockers.length === 0;

  // Nothing to clear when the field is empty and no run has happened yet — a
  // "Reset" that resets an already-empty form to itself is a button that does
  // nothing, which is worse than no button at all.
  const canReset = url.trim() !== '' || state !== 'empty';

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(url);
        }}
        className="grid content-start gap-5"
      >
        <TextField
          label="Target URL"
          type="url"
          inputMode="url"
          placeholder="https://example.com/products"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          hint="Two real requests: the page, and its robots.txt. No credits, no account."
          error={null}
          // Cmd/Ctrl+Enter runs from anywhere in the form, matching the replay tab.
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              submit(url);
            }
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={pending} disabled={url.trim() === ''}>
            Run preflight
          </Button>
          <Button type="button" variant="ghost" onClick={reset} disabled={pending || !canReset}>
            Reset
          </Button>
        </div>

        <div className="grid gap-2 border-t border-line-soft pt-5">
          <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">Try</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.url}
                type="button"
                onClick={() => {
                  setUrl(suggestion.url);
                  submit(suggestion.url);
                }}
                disabled={pending}
                className="rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[0.71875rem] text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
          <p className="text-[0.75rem] leading-relaxed text-faint">
            The last one is a cloud metadata address. It is refused before any request is made — see{' '}
            <a
              href="/docs/honest-limits"
              className="text-accent underline decoration-accent/35 underline-offset-2"
            >
              the limits page
            </a>{' '}
            for what that guard does and does not cover.
          </p>
        </div>
      </form>

      <ResultShell
        state={state}
        error={error}
        retryAfterSeconds={retryAfter}
        emptyHint="Enter a URL and run the preflight. This is the same check that runs before a collector is generated."
        runningHint="Fetching the page and its robots.txt…"
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
                'flex items-center gap-2.5 rounded-sm border px-3.5 py-2.5',
                go ? 'border-good/30 bg-good-soft' : 'border-bad/30 bg-bad-soft',
              )}
            >
              {go ? (
                <CheckIcon className="shrink-0 text-good" />
              ) : (
                <CloseIcon className="shrink-0 text-bad" />
              )}
              <span className={cn('text-[0.875rem] font-medium', go ? 'text-good' : 'text-bad')}>
                {go ? 'Viable target' : `${String(report.blockers.length)} blocker(s)`}
              </span>
            </div>

            <div>
              <FactRow label="Resolved URL">
                <span className="break-all">{report.url}</span>
              </FactRow>
              <FactRow label="Page size" tone={report.withinSizeLimit ? 'good' : 'bad'}>
                {formatKb(report.bytes)}
                <span className="ml-2 text-faint">/ {formatKb(data.sizeLimitBytes)} ceiling</span>
              </FactRow>
              <FactRow
                label="robots.txt"
                tone={!report.robotsFound ? 'neutral' : report.robotsAllowed ? 'good' : 'bad'}
              >
                {!report.robotsFound
                  ? 'none found'
                  : report.robotsAllowed
                    ? 'path permitted'
                    : 'path disallowed'}
              </FactRow>
              <FactRow
                label="Internal links"
                tone={report.links.internalLinks > 0 ? 'warn' : 'good'}
              >
                {report.links.internalLinks}
              </FactRow>
              <FactRow label="Anchor ids" tone={report.links.anchorIds > 20 ? 'warn' : 'neutral'}>
                {report.links.anchorIds}
              </FactRow>
            </div>

            {/* A size gauge, because "44 KB" means nothing without the ceiling
             * beside it and the whole point of this tab is the relationship. */}
            <div className="grid gap-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn(
                    'h-full rounded-full',
                    report.withinSizeLimit ? 'bg-good' : 'bg-bad',
                  )}
                  style={{
                    width: `${String(Math.min(100, (report.bytes / data.sizeLimitBytes) * 100))}%`,
                  }}
                />
              </div>
              <p className="font-mono text-[0.6875rem] text-faint">
                {Math.round((report.bytes / data.sizeLimitBytes) * 100)}% of the size ceiling
              </p>
            </div>

            {report.blockers.length > 0 && (
              <Findings tone="bad" title="Blockers" items={report.blockers} />
            )}
            {report.warnings.length > 0 && (
              <Findings tone="warn" title="Warnings" items={report.warnings} />
            )}
          </div>
        )}
      </ResultShell>
    </div>
  );
}

function Findings({
  tone,
  title,
  items,
}: {
  readonly tone: 'bad' | 'warn';
  readonly title: string;
  readonly items: readonly string[];
}) {
  return (
    <div className="grid gap-2">
      <p
        className={cn(
          'font-mono text-[0.6875rem] font-semibold uppercase tracking-wider',
          tone === 'bad' ? 'text-bad' : 'text-warn',
        )}
      >
        {title}
      </p>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li
            key={item}
            className={cn(
              'rounded-sm border px-3 py-2 text-[0.78125rem] leading-relaxed text-ink',
              tone === 'bad' ? 'border-bad/25 bg-bad-soft' : 'border-warn/25 bg-warn-soft',
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
