import type { ReactNode } from 'react';

import { AlertIcon, SpinnerIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

/**
 * The result pane's four states, in one place.
 *
 * Every tab on the playground has exactly the same lifecycle — empty, running,
 * failed, done — and the brief calls for all four to be designed rather than
 * left to whatever a spinner and an unstyled error string happen to look like.
 * Keeping them here means the three tabs cannot drift into three different
 * ideas of what "loading" looks like.
 *
 * The whole pane is an `aria-live` region so a screen-reader user hears the
 * outcome without having to go looking for it: the run button is what they
 * activated, and the result appears somewhere else on the page entirely.
 */

export type ResultState = 'empty' | 'running' | 'error' | 'result';

export function ResultShell({
  state,
  emptyHint,
  runningHint,
  error,
  retryAfterSeconds,
  children,
  toolbar,
}: {
  readonly state: ResultState;
  readonly emptyHint: ReactNode;
  readonly runningHint: ReactNode;
  readonly error?: string | null;
  readonly retryAfterSeconds?: number | undefined;
  readonly children?: ReactNode;
  /** Copy / reset controls, shown only when there is a result to act on. */
  readonly toolbar?: ReactNode;
}) {
  return (
    <div className="flex min-h-[26rem] flex-col overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft bg-surface-2/60 px-4 py-2">
        <span className="flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
          <StateDot state={state} />
          {state === 'running'
            ? 'running'
            : state === 'error'
              ? 'failed'
              : state === 'result'
                ? 'result'
                : 'idle'}
        </span>
        {state === 'result' && toolbar !== undefined && toolbar}
      </div>

      <div aria-live="polite" aria-busy={state === 'running'} className="flex-1 p-4 sm:p-5">
        {state === 'empty' && (
          <div className="flex h-full min-h-[20rem] flex-col items-center justify-center gap-2 text-center">
            <p className="prose-measure text-[0.875rem] leading-relaxed text-faint">{emptyHint}</p>
          </div>
        )}

        {state === 'running' && (
          <div className="flex h-full min-h-[20rem] flex-col items-center justify-center gap-3 text-center">
            <SpinnerIcon className="text-[1.25rem] text-accent" />
            <p className="prose-measure text-[0.875rem] leading-relaxed text-muted">
              {runningHint}
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex gap-3 rounded-md border border-bad/30 bg-bad-soft px-4 py-3.5">
            <AlertIcon className="mt-0.5 shrink-0 text-bad" />
            <div className="grid gap-1">
              <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-bad">
                Refused
              </p>
              <p className="text-[0.8125rem] leading-relaxed text-ink">
                {error ?? 'Something went wrong.'}
              </p>
              {retryAfterSeconds !== undefined && retryAfterSeconds > 0 && (
                <p className="text-[0.75rem] text-muted">Try again in {retryAfterSeconds}s.</p>
              )}
            </div>
          </div>
        )}

        {state === 'result' && children}
      </div>
    </div>
  );
}

function StateDot({ state }: { state: ResultState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 rounded-full',
        state === 'running' && 'animate-pulse bg-accent',
        state === 'error' && 'bg-bad',
        state === 'result' && 'bg-good',
        state === 'empty' && 'bg-line-strong',
      )}
    />
  );
}

/** A labelled row of machine-readable facts. Used by every result view. */
export function FactRow({
  label,
  children,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-2 last:border-b-0">
      <span className="text-[0.8125rem] text-muted">{label}</span>
      <span
        className={cn(
          'text-right font-mono text-[0.8125rem]',
          tone === 'good' && 'text-good',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'font-semibold text-bad',
          tone === 'neutral' && 'text-ink',
        )}
      >
        {children}
      </span>
    </div>
  );
}
