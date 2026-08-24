import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * A tooltip with no JavaScript.
 *
 * The app has exactly one recurring need for one -- explaining that credit
 * figures are an estimate, because Bright Data publishes no per-operation price
 * list -- and that does not justify a positioning engine. This is a
 * `group-hover` / `group-focus-within` reveal on an absolutely positioned
 * sibling: zero client JS, and it works before hydration.
 *
 * The trade-off is real and worth stating: with no collision detection, a
 * tooltip near the viewport edge can clip. So it is `w-max` capped at
 * `max-w-64` and centred on its trigger, and callers place triggers away from
 * the edges. When something needs edge-aware placement, that is the moment to
 * take a dependency -- not before.
 *
 * The content is also on the trigger as `aria-label`-adjacent `title`-free
 * markup: assistive tech reads it from the `role="tooltip"` node via
 * `aria-describedby`, which is why `id` is required rather than generated.
 */
export function Tooltip({
  id,
  content,
  children,
  side = 'top',
  className,
}: {
  readonly id: string;
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly side?: 'top' | 'bottom';
  readonly className?: string;
}) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      <span aria-describedby={id} className="inline-flex cursor-help">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-30 w-max max-w-64 -translate-x-1/2 rounded-sm',
          'border border-line bg-surface px-2.5 py-1.5 text-[0.71875rem] leading-snug text-muted shadow-md',
          'opacity-0 transition-opacity duration-150',
          'group-hover:opacity-100 group-focus-within:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}
