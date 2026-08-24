import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { SpinnerIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'relative inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
  'ease-[cubic-bezier(0.22,1,0.36,1)] select-none ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  // A 1px lift on press. Small enough to feel like the surface responding
  // rather than the button jumping; the global reduced-motion rule kills it.
  'active:translate-y-px';

const VARIANT: Record<ButtonVariant, string> = {
  // The ember. Exactly one of these per view, or it stops meaning "do this".
  primary:
    'bg-accent text-accent-ink border border-accent hover:bg-accent-strong hover:border-accent-strong shadow-sm',
  secondary: 'bg-surface-2 text-ink border border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-ink',
  danger: 'bg-transparent text-bad border border-bad hover:bg-bad-soft',
  // Reads as prose, behaves as a control. The underline grows from the left on
  // hover -- a background-size transition, so it animates on the compositor.
  link:
    'bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-[position:0_100%] bg-no-repeat ' +
    'hover:bg-[length:100%_1px] transition-[background-size] duration-200 text-ink px-0',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.78125rem] rounded-sm',
  md: 'h-9.5 px-4 text-[0.8125rem] rounded-md',
  lg: 'h-11 px-5 text-[0.875rem] rounded-md',
};

/**
 * The class string for a button, without the element.
 *
 * Exported because a primary call-to-action is very often a `next/link`, and an
 * anchor rendered inside a `<button>` is invalid HTML. Rather than making
 * `Button` polymorphic -- which costs a generic signature every caller has to
 * read -- links import this and stay honest anchors:
 *
 *     <Link href="/playground" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
 */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(BASE, VARIANT[variant], variant === 'link' ? 'h-auto' : SIZE[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /**
   * Shows a spinner and blocks input. The label stays in place rather than
   * being swapped for the spinner, so the button does not change width
   * mid-interaction and shift everything next to it.
   */
  readonly loading?: boolean;
  readonly children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading && <SpinnerIcon className="shrink-0" />}
      {children}
    </button>
  );
}
