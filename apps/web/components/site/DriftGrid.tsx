'use client';

import { useEffect, useRef, useState } from 'react';

import { CheckIcon, CloseIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { usePrefersReducedMotion } from '@/lib/motion';

/**
 * The hero visual: a field x run grid that goes wrong while you watch.
 *
 * This is the product, not an illustration of it. The cockpit's collector screen
 * renders the same matrix from real snapshots (`lib/heatmap.ts`); this is that
 * shape, replayed with the numbers from an incident Molt actually caught on the
 * chaos target -- `comment_count` and `download_count` both zeroed, the other
 * six fields untouched.
 *
 * Chosen over the fake terminal window every tool in this space uses, for two
 * reasons. A terminal shows you output; a grid shows you the *pattern*, which is
 * the argument. And the zeroed columns are the one thing a fill-rate reading
 * cannot show you -- those cells are 100% full and still wrong -- so the visual
 * has to be the classified one or it undercuts the claim on the same screen.
 *
 * Deterministic: no `Math.random`, no clock. Server and client render the same
 * markup, and the sequence looks identical every time it is shown.
 */

const FIELDS = [
  'title',
  'category',
  'date',
  'summary',
  'tags',
  'version',
  'comment_count',
  'download_count',
] as const;

/** The two that zeroed. From the real incident, not invented. */
const ZEROED = new Set<string>(['comment_count', 'download_count']);

const RUNS = 12;
/** The run at which the break appears. Two bad runs, ten good ones before them. */
const BREAK_AT = 10;

/**
 * The runs, as identified objects.
 *
 * A run is a moment in time, so it gets a stable key of its own rather than
 * being keyed by array position. Position-keyed lists are fine right up until
 * the list is reordered or filtered, and then they reuse the wrong DOM node —
 * which for an animated grid means cells inheriting a neighbour's transition
 * mid-flight.
 */
const RUN_KEYS = Array.from({ length: RUNS }, (_, i) => ({
  index: i,
  key: `run-${String(i + 1).padStart(2, '0')}`,
}));

const STEP_MS = 85;
/** Beat between the grid finishing and the verdict appearing. */
const VERDICT_DELAY_MS = 420;

function isBroken(field: string, run: number): boolean {
  return ZEROED.has(field) && run >= BREAK_AT;
}

export function DriftGrid() {
  const reduced = usePrefersReducedMotion();
  const container = useRef<HTMLDivElement>(null);

  // `revealed` counts columns, not cells: a run is a moment in time, and
  // revealing a whole column at once is what makes the sequence read as
  // "another run just landed" rather than as a shimmer effect.
  const [revealed, setRevealed] = useState(0);
  const [verdict, setVerdict] = useState(false);
  const [playing, setPlaying] = useState(false);

  // Start when it comes into view, not on mount. A hero animation that finished
  // while the visitor was still reading the headline was never seen.
  useEffect(() => {
    if (reduced) {
      setRevealed(RUNS);
      setVerdict(true);
      return;
    }

    const node = container.current;
    if (node === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (!playing) return;

    const timer = setInterval(() => {
      setRevealed((current) => {
        if (current >= RUNS) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, STEP_MS);

    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (revealed < RUNS) return;
    const timer = setTimeout(() => setVerdict(true), VERDICT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  const replay = () => {
    setVerdict(false);
    setRevealed(0);
    setPlaying(true);
  };

  return (
    <div
      ref={container}
      className="rounded-lg border border-line bg-surface p-4 shadow-lg sm:p-5"
      // Exposed as a single image with a summary. Ninety-six coloured cells read
      // out one by one is noise; the one sentence is the whole meaning, and
      // `role="img"` is what makes a screen reader substitute it for the
      // contents rather than reading both.
      role="img"
      aria-label="Field by run health grid for collector c_mt101cvbc0o34ghzh. Six fields healthy across twelve runs. comment_count and download_count returned only zeros in the final two runs, while still filling every row."
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
          <span className="size-1.5 rounded-full bg-accent" />
          field × run · c_mt101cvbc0o34ghzh
        </div>
        <button
          type="button"
          onClick={replay}
          className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint transition-colors hover:text-ink"
        >
          replay
        </button>
      </div>

      <div className="scrollable-x">
        <div className="grid min-w-[19rem] gap-1.5">
          {FIELDS.map((field) => {
            const broken = ZEROED.has(field) && revealed > BREAK_AT;

            return (
              <div
                key={field}
                className="grid grid-cols-[7.5rem_1fr_3.75rem] items-center gap-2.5 sm:grid-cols-[8.5rem_1fr_4rem]"
              >
                <span
                  className={cn(
                    'truncate font-mono text-[0.6875rem] transition-colors duration-300',
                    broken ? 'text-ink' : 'text-faint',
                  )}
                >
                  {field}
                </span>

                <span className="flex gap-[3px]">
                  {RUN_KEYS.map(({ index: run, key }) => {
                    const shown = run < revealed;
                    const bad = isBroken(field, run);

                    return (
                      <span
                        key={key}
                        className={cn(
                          'h-5 flex-1 rounded-[2px] transition-[background-color,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                          shown ? 'scale-y-100 opacity-100' : 'scale-y-[0.35] opacity-0',
                          // The classification, identical in meaning to
                          // `cellSeverity` in lib/heatmap.ts: bad at full
                          // strength, healthy held back so the fault is the
                          // loudest thing on the screen.
                          bad ? 'bg-bad' : 'bg-good/55',
                        )}
                      />
                    );
                  })}
                </span>

                <span
                  className={cn(
                    'text-right font-mono text-[0.6875rem] transition-opacity duration-300',
                    revealed < RUNS && 'opacity-0',
                    broken ? 'font-bold text-bad' : 'text-faint',
                  )}
                >
                  {/* Not a percentage for the broken fields, on purpose. Their
                   * fill rate is 100%. Printing that number here would repeat
                   * the exact false-green this page is about. */}
                  {broken ? 'ZEROED' : '100%'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          'mt-4 grid gap-2 border-t border-line-soft pt-4 transition-opacity duration-500',
          verdict ? 'opacity-100' : 'opacity-0',
        )}
      >
        <CheckRow label="null check" pass />
        <CheckRow label="schema check" pass />
        <CheckRow label="actually true?" pass={false} />
      </div>
    </div>
  );
}

function CheckRow({ label, pass }: { label: string; pass: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-[0.71875rem]">
      <span className="text-muted">{label}</span>
      <span className={cn('inline-flex items-center gap-1.5', pass ? 'text-good' : 'text-bad')}>
        {pass ? 'passed' : 'no'}
        {pass ? <CheckIcon /> : <CloseIcon />}
      </span>
    </div>
  );
}
