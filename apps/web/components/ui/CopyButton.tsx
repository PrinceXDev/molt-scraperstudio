'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { CheckIcon, CopyIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

type CopyState = 'idle' | 'copied' | 'failed';

const FEEDBACK_MS = 1600;

/**
 * Copy-to-clipboard with honest feedback.
 *
 * Three states, not two. `navigator.clipboard.writeText` rejects for real
 * reasons -- an insecure origin, a document without focus, a browser policy --
 * and a control that silently shows a tick when nothing reached the clipboard
 * is worse than one that shows nothing at all. The failure path says so and
 * leaves the text selectable.
 *
 * The result is announced through an `aria-live` region rather than by changing
 * the button's accessible name, so a screen-reader user hears "Copied" without
 * the button they are focused on being renamed underneath them.
 */
export function CopyButton({
  value,
  label = 'Copy',
  className,
}: {
  readonly value: string;
  readonly label?: string;
  readonly className?: string;
}) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Without this the timer fires after unmount and React warns about setting
  // state on a component that is gone -- common here, because copy buttons live
  // in code blocks that unmount on navigation.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), FEEDBACK_MS);
  }, [value]);

  const copied = state === 'copied';
  const failed = state === 'failed';

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-wider',
          'transition-colors duration-150',
          copied && 'border-good/40 bg-good-soft text-good',
          failed && 'border-bad/40 bg-bad-soft text-bad',
          !copied && !failed && 'border-line bg-surface-2 text-faint hover:text-ink',
          className,
        )}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span>{copied ? 'Copied' : failed ? 'Blocked' : label}</span>
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied to clipboard' : failed ? 'Clipboard access was blocked' : ''}
      </span>
    </>
  );
}
