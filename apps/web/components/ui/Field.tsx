'use client';

import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

import { AlertIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

/**
 * Form controls.
 *
 * The shared control surface is one string (`CONTROL`) so an input, a textarea
 * and a select cannot drift apart by a border colour or a focus ring -- the
 * usual outcome when each is styled where it is used.
 *
 * Focus is a ring plus a border change, not a colour swap alone: at AA contrast
 * on a warm-paper background, an accent-only focus border is legible but not
 * *obvious*, and a text field is precisely where a keyboard user needs to be
 * certain where they are.
 */

const CONTROL =
  'w-full rounded-sm border border-line bg-surface px-3 py-2 text-[0.8125rem] text-ink ' +
  'placeholder:text-faint transition-[border-color,box-shadow] duration-150 ' +
  'focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-55';

const INVALID = 'border-bad focus-visible:border-bad focus-visible:ring-bad/25';

interface FieldShellProps {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  /** Right-aligned counter or unit, e.g. `842 / 1000`. */
  readonly meta?: ReactNode;
  readonly htmlFor: string;
  readonly describedBy: string;
  readonly children: ReactNode;
  readonly className?: string;
}

function FieldShell({
  label,
  hint,
  error,
  meta,
  htmlFor,
  describedBy,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[0.78125rem] font-medium text-ink">
          {label}
        </label>
        {meta !== undefined && (
          <span className="font-mono text-[0.6875rem] text-faint">{meta}</span>
        )}
      </div>
      {children}
      {/* One region for both hint and error, so an error replaces the hint
       * rather than stacking below it and shifting the layout. */}
      <div id={describedBy} className="min-h-4 text-[0.71875rem]">
        {error !== null && error !== undefined && error !== '' ? (
          <span className="flex items-center gap-1.5 text-bad">
            <AlertIcon className="shrink-0" />
            {error}
          </span>
        ) : (
          hint !== undefined && <span className="text-faint">{hint}</span>
        )}
      </div>
    </div>
  );
}

type SharedFieldProps = Omit<FieldShellProps, 'children' | 'htmlFor' | 'describedBy'>;

export function TextField({
  label,
  hint,
  error,
  meta,
  className,
  ...props
}: SharedFieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const describedBy = `${id}-description`;
  const invalid = error !== null && error !== undefined && error !== '';

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      meta={meta}
      htmlFor={id}
      describedBy={describedBy}
      className={className}
    >
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn(CONTROL, invalid && INVALID, props.type === 'url' && 'font-mono')}
        {...props}
      />
    </FieldShell>
  );
}

export function TextArea({
  label,
  hint,
  error,
  meta,
  className,
  rows = 8,
  ...props
}: SharedFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const describedBy = `${id}-description`;
  const invalid = error !== null && error !== undefined && error !== '';

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      meta={meta}
      htmlFor={id}
      describedBy={describedBy}
      className={className}
    >
      <textarea
        id={id}
        rows={rows}
        spellCheck={false}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        // Machine input: mono, and resizable vertically only, because a
        // horizontally resizable textarea can be dragged past the viewport.
        className={cn(CONTROL, 'resize-y font-mono leading-relaxed', invalid && INVALID)}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  meta,
  className,
  children,
  ...props
}: SharedFieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const describedBy = `${id}-description`;

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      meta={meta}
      htmlFor={id}
      describedBy={describedBy}
      className={className}
    >
      {/* No custom listbox. The native control gets the platform's keyboard
       * behaviour, its mobile picker and its `color-scheme` styling for free,
       * and none of the reimplementations are better. */}
      <select
        id={id}
        aria-describedby={describedBy}
        className={cn(CONTROL, 'font-mono')}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}
