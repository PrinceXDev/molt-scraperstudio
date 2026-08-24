'use client';

import { useCallback, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface TabItem<Id extends string = string> {
  readonly id: Id;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps<Id extends string = string> {
  readonly items: readonly TabItem<Id>[];
  readonly value: Id;
  readonly onChange: (next: Id) => void;
  readonly label: string;
  readonly className?: string;
}

/**
 * A segmented tab strip.
 *
 * Hand-built rather than taken from a primitives library, because the whole of
 * what a library would give us here is the ARIA wiring and the arrow-key
 * behaviour, and both are short enough to own outright:
 *
 * - `role="tablist"` with `aria-selected`, and `tabIndex` on the selected tab
 *   only, so Tab moves *past* the strip rather than through every tab -- the
 *   WAI-ARIA pattern, and the thing hand-rolled tabs almost always miss.
 * - Left/Right move selection and wrap; Home/End jump to the ends. Disabled
 *   tabs are skipped rather than landed on and refused.
 *
 * The active pill is a positioned sibling with a CSS transition instead of a
 * layout animation, so switching tabs costs no JS animation frames.
 */
export function Tabs<Id extends string = string>({
  items,
  value,
  onChange,
  label,
  className,
}: TabsProps<Id>) {
  const groupId = useId();
  // Held as refs rather than looked up by selector: `useId` makes no promise
  // that its output is a valid CSS identifier, and it has historically emitted
  // colons, which `querySelector('#...')` rejects outright.
  const buttons = useRef(new Map<Id, HTMLButtonElement>());

  const move = useCallback(
    (from: number, step: number) => {
      const total = items.length;
      for (let hop = 1; hop <= total; hop += 1) {
        const next = items[(from + step * hop + total * total) % total];
        if (next !== undefined && next.disabled !== true) {
          onChange(next.id);
          // Selection follows focus in this pattern, so the newly selected tab
          // has to actually receive focus or the keyboard user is stranded.
          buttons.current.get(next.id)?.focus();
          return;
        }
      }
    },
    [items, onChange],
  );

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 p-1',
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.id === value;

        return (
          <button
            key={item.id}
            id={`${groupId}-${item.id}`}
            ref={(node) => {
              if (node === null) buttons.current.delete(item.id);
              else buttons.current.set(item.id, node);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${groupId}-${item.id}-panel`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                move(-1, 1);
              } else if (event.key === 'End') {
                event.preventDefault();
                move(items.length, -1);
              }
            }}
            className={cn(
              'rounded-sm px-3 py-1.5 font-mono text-[0.75rem] transition-colors duration-150',
              'disabled:cursor-not-allowed disabled:opacity-45',
              selected
                ? 'bg-surface text-ink shadow-sm'
                : 'text-faint hover:text-ink enabled:hover:bg-surface-3',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a tab controls. Pair the `id` with the tab's `aria-controls`. */
export function TabPanel({
  id,
  active,
  children,
  className,
}: {
  readonly id: string;
  readonly active: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  if (!active) return null;

  // No `tabIndex` on the panel. The ARIA practice adds one only when a panel has
  // no focusable content of its own; every panel here holds a form or a result
  // with its own focusable elements, so a tab stop on the container would just
  // add an extra, silent stop for keyboard users to pass through.
  return (
    <div id={`${id}-panel`} role="tabpanel" className={className}>
      {children}
    </div>
  );
}
