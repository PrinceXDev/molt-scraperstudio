import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Surfaces: the containers everything else sits on.
 *
 * One file because they share one idea -- elevation is expressed by border and
 * background step, never by a coloured glow. In dark mode a drop shadow on a
 * #0a0a0c canvas is invisible; the border is what actually separates a card
 * from the page, in both themes, so it is the primary signal and the shadow is
 * a light-mode refinement on top.
 */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `interactive` adds hover affordance. Only use it if the whole card is a link. */
  readonly interactive?: boolean;
  /** `quiet` drops the shadow and softens the border, for nested panels. */
  readonly quiet?: boolean;
  readonly padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING = {
  none: '',
  sm: 'p-3.5',
  md: 'p-5',
  lg: 'p-6 sm:p-8',
} as const;

export function Card({
  interactive = false,
  quiet = false,
  padding = 'md',
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-md border bg-surface',
        quiet ? 'border-line-soft' : 'border-line shadow-sm',
        PADDING[padding],
        interactive &&
          'transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
            'hover:-translate-y-px hover:border-line-strong hover:shadow-md',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * The inset well: code, command output, raw payloads.
 *
 * Recessed rather than raised -- it is where machine text lives, and it always
 * scrolls inside itself rather than widening the page.
 */
export function Well({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'scrollable-x rounded-sm border border-line bg-inset font-mono text-[0.78125rem] leading-relaxed',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** A mono chip for identifiers, field names, flags. */
export function Pill({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'accent' | 'verified' }) {
  const TONE = {
    neutral: 'border-line bg-surface-2 text-muted',
    accent: 'border-accent-dim bg-accent-soft text-accent',
    verified: 'border-verified/35 bg-verified-soft text-verified',
  } as const;

  return (
    <span
      className={cn(
        'inline-block rounded-sm border px-2 py-0.5 font-mono text-xs',
        TONE[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** `<kbd>` for shortcut hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-surface-2 px-1.5 font-mono text-[0.6875rem] text-muted">
      {children}
    </kbd>
  );
}

/**
 * The eyebrow above a section heading.
 *
 * Every section on the public surfaces opens with one. It is the rhythm device
 * that lets a reader skim the page structure without reading the headlines,
 * which is why the size and tracking are a token (`text-eyebrow`) rather than
 * per-use values.
 */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 font-mono text-eyebrow font-semibold uppercase text-faint',
        className,
      )}
    >
      <span aria-hidden="true" className="h-px w-6 bg-line-strong" />
      {children}
    </p>
  );
}

export interface SectionHeadingProps {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Right-aligned counter, e.g. `[03/07]`. Purely a wayfinding cue. */
  readonly meta?: ReactNode;
  readonly className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  meta,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {(eyebrow !== undefined || meta !== undefined) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {eyebrow !== undefined ? <Eyebrow>{eyebrow}</Eyebrow> : <span />}
          {meta !== undefined && (
            <span className="font-mono text-eyebrow uppercase text-faint">{meta}</span>
          )}
        </div>
      )}
      <h2 className="text-display-sm font-semibold sm:text-display-md">{title}</h2>
      {description !== undefined && (
        <p className="prose-measure text-[0.9375rem] text-muted">{description}</p>
      )}
    </div>
  );
}

/** The full-bleed hairline that separates sections. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn('h-px border-0 bg-line-soft', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-sm bg-surface-2', className)} aria-hidden="true" />
  );
}

export function EmptyState({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-md border border-dashed border-line px-5 py-12 text-center',
        className,
      )}
    >
      <p className="text-[0.9375rem] font-medium text-ink">{title}</p>
      {children !== undefined && <div className="text-[0.8125rem] text-muted">{children}</div>}
    </div>
  );
}
