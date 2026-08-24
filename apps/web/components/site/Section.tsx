import type { ReactNode } from 'react';

import { Reveal } from '@/components/ui/Reveal';
import { cn } from '@/lib/cn';

/**
 * The editorial beat.
 *
 * Every section on the landing page is one of these, and the rhythm is the point:
 * hairline rule, eyebrow left, counter right, then a two-line heading where the
 * first line is muted and the second lands in full ink. A reader who skims only
 * the second lines gets the whole argument, which is the test this page is built
 * to pass.
 *
 * The counter (`[03/07]`) is wayfinding, not decoration -- it tells a visitor how
 * much page is left, which is the question a long scrolling narrative otherwise
 * refuses to answer.
 */
export interface SectionProps {
  readonly id?: string;
  readonly eyebrow: string;
  readonly index: number;
  readonly total: number;
  readonly kicker?: string;
  /** The muted first line of the heading. */
  readonly leadIn: ReactNode;
  /** The second line, in full ink. This is the claim. */
  readonly claim: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function Section({
  id,
  eyebrow,
  index,
  total,
  kicker,
  leadIn,
  claim,
  children,
  className,
}: SectionProps) {
  return (
    <section id={id} className={cn('border-t border-line-soft', className)}>
      <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-6 sm:py-24">
        <Reveal>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2.5 font-mono text-eyebrow font-semibold uppercase text-faint">
              <span aria-hidden="true" className="h-px w-6 bg-line-strong" />
              {eyebrow}
            </p>
            <p className="font-mono text-eyebrow uppercase text-faint">
              <span className="text-muted">
                [{pad(index)}/{pad(total)}]
              </span>
              {kicker !== undefined && <> · {kicker}</>}
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <h2 className="mt-7 max-w-3xl text-display-sm font-semibold sm:text-display-md">
            <span className="block text-muted">{leadIn}</span>
            <span className="block text-ink">{claim}</span>
          </h2>
        </Reveal>

        {children !== undefined && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}

/** Body copy at a readable measure. Used inside sections, never full-bleed. */
export function Lede({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('prose-measure text-[0.9375rem] leading-relaxed text-muted', className)}>
      {children}
    </p>
  );
}
