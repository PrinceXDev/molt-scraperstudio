'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';

import { runCreateCollector, type CreateSuccess } from '@/app/(site)/playground/actions';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { FactRow, ResultShell, type ResultState } from '@/components/playground/ResultShell';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { TextArea, TextField } from '@/components/ui/Field';

const DESCRIPTION_MAX_CHARS = 500;

/**
 * Generate a real, permanent collector — the same thing `molt add` does at a
 * maintainer's terminal, offered to any visitor.
 *
 * This is the one playground tab with an irreversible failure mode: a create
 * that fails partway leaves an orphaned collector on the connected Bright Data
 * account that cannot be deleted programmatically. Every piece of copy in this
 * component exists to make that fact impossible to miss before the button is
 * pressed — this is deliberately the most heavily-worded panel on the page, and
 * that is not an oversight to tidy up later.
 */
export function CreatePanel({ enabled }: { readonly enabled: boolean }) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<ResultState>('empty');
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | undefined>(undefined);
  const [data, setData] = useState<CreateSuccess | null>(null);
  const [pending, startTransition] = useTransition();

  const descriptionTooLong = description.length > DESCRIPTION_MAX_CHARS;
  const canSubmit = url.trim() !== '' && description.trim() !== '' && !descriptionTooLong;

  const submit = () => {
    // Defense in depth: the fields above the confirm dialog stay editable while
    // it is open, so `canSubmit` can go false between "Generate a collector"
    // (which required it) and "Yes, generate it" actually firing. The button
    // below is also disabled for the same case — this guard is what stops a
    // stale click from reaching the server action if it somehow gets through.
    if (!canSubmit) return;

    setConfirming(false);
    setState('running');
    setError(null);
    setRetryAfter(undefined);

    startTransition(async () => {
      const result = await runCreateCollector(url, description);
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
            The identical pipeline as <code className="font-mono text-ink">molt add</code>:
            preflight, then <code className="font-mono text-ink">bdata scraper create</code>, then a
            first <code className="font-mono text-ink">check</code> to establish its baseline. The
            collector this produces is real and permanent — it appears in the{' '}
            <Link
              href="/fleet"
              className="text-accent underline decoration-accent/35 underline-offset-2"
            >
              cockpit
            </Link>{' '}
            like any other, and its ID never changes even as it gets healed later. That permanence
            is the entire premise of this product.
          </p>
          <div className="mt-1">
            <FactRow label="Expected duration">5–25 minutes</FactRow>
            <FactRow label="Cost" tone="warn">
              ~12x a run (estimated)
            </FactRow>
            <FactRow label="On failure" tone="bad">
              orphan, manual cleanup
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
                Generating a collector spends far more than a check and, if it fails partway, leaves
                a resource on the connected account that has to be deleted by hand. It is off unless{' '}
                <code className="font-mono">MOLT_PLAYGROUND_CREATE=1</code> is set — deliberately
                separate from the live-check flag, because the two do not carry the same risk. The{' '}
                <span className="font-medium">Drift replay</span> tab demonstrates the detection
                core this would eventually feed, with no account and no risk at all.
              </p>
            </div>
          </div>
        ) : (
          <>
            <TextField
              label="Target URL"
              type="url"
              inputMode="url"
              placeholder="https://books.toscrape.com/"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              hint="Runs the same preflight as the first tab. Any blocker refuses the request — there is no --force here."
              error={null}
              disabled={pending}
            />

            <TextArea
              label="What to extract"
              placeholder="Extract every book's title, price, star rating, and stock availability."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              meta={`${String(description.length)} / ${String(DESCRIPTION_MAX_CHARS)}`}
              error={descriptionTooLong ? 'Over the CLI’s 500-character cap.' : null}
              hint={
                descriptionTooLong
                  ? undefined
                  : 'Plain language. This is the entire input the AI-Flow pipeline gets.'
              }
              disabled={pending}
            />

            {confirming ? (
              <div className="grid gap-3 rounded-md border border-bad/35 bg-bad-soft p-4">
                <p className="text-[0.8125rem] font-medium leading-relaxed text-ink">
                  This generates a real, permanent collector on the connected Bright Data account
                  and can take up to 25 minutes. If it fails partway, the orphaned collector cannot
                  be deleted programmatically. Keep this tab open until it finishes.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="danger" onClick={submit} loading={pending} disabled={!canSubmit}>
                    Yes, generate it
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => setConfirming(true)}
                  disabled={!canSubmit}
                  loading={pending}
                >
                  Generate a collector
                </Button>
              </div>
            )}

            <p className="text-[0.75rem] leading-relaxed text-faint">
              Rate-limited to one attempt per hour. See{' '}
              <Link
                href="/docs/onboarding-targets"
                className="text-accent underline decoration-accent/35 underline-offset-2"
              >
                Onboarding a target
              </Link>{' '}
              for what the preflight blockers mean and why they exist.
            </p>
          </>
        )}
      </div>

      <ResultShell
        state={state}
        error={error}
        retryAfterSeconds={retryAfter}
        emptyHint={
          enabled
            ? 'Describe a target and generate a real collector for it.'
            : 'Collector generation is disabled here. The Drift replay tab runs the same detection core with no account needed.'
        }
        runningHint="Preflighting, then generating — this genuinely takes five to twenty-five minutes. Please keep this tab open."
        toolbar={
          data !== null && <CopyButton value={JSON.stringify(data, null, 2)} label="Copy JSON" />
        }
      >
        {data !== null && (
          <div className="grid gap-5">
            <div className="flex items-center gap-2.5 rounded-sm border border-good/30 bg-good-soft px-3.5 py-2.5">
              <CheckIcon className="shrink-0 text-good" />
              <span className="text-[0.875rem] font-medium text-good">Collector generated</span>
            </div>

            <div>
              <FactRow label="Collector ID">{data.collectorId}</FactRow>
              <FactRow label="Name">{data.name}</FactRow>
              <FactRow label="Duration">{Math.round(data.durationMs / 1000)}s</FactRow>
              {data.baseline !== null && (
                <FactRow label="Baseline" tone={data.baseline.established ? 'good' : 'warn'}>
                  {data.baseline.established
                    ? `established · ${String(data.baseline.rowCount)} rows`
                    : 'not established'}
                </FactRow>
              )}
            </div>

            {data.completedSteps.length > 0 && (
              <div className="grid gap-2">
                <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
                  Pipeline stages completed
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {data.completedSteps.map((step) => (
                    <span
                      key={step}
                      className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[0.6875rem] text-muted"
                    >
                      {step}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
                Command run
              </p>
              <pre className="scrollable-x rounded-sm border border-line bg-inset px-3 py-2.5 font-mono text-[0.75rem] text-ink">
                {data.command}
              </pre>
            </div>

            <Link
              href={`/fleet/c/${data.collectorId}`}
              className="rounded-sm border border-line bg-surface-2 px-3.5 py-2.5 text-[0.8125rem] text-ink transition-colors hover:border-line-strong"
            >
              Open this collector in the cockpit →
            </Link>

            {data.viewUrl !== null && (
              <a
                href={data.viewUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[0.78125rem] text-accent underline decoration-accent/35 underline-offset-2"
              >
                View it in the Bright Data dashboard ↗
              </a>
            )}
          </div>
        )}
      </ResultShell>
    </div>
  );
}
