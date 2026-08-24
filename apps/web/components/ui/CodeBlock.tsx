import type { ReactNode } from 'react';

import { CopyButton } from '@/components/ui/CopyButton';
import { cn } from '@/lib/cn';

export interface CodeBlockProps {
  /** The exact text the copy button puts on the clipboard. */
  readonly code: string;
  /** Shown in the header. A language tag, a filename, or a command name. */
  readonly label?: string;
  /**
   * Rendered instead of the raw `code` when provided -- the seam for
   * build-time highlighted output. Kept separate from `code` on purpose: what a
   * reader sees may be marked up, but what they copy must be the plain text,
   * and conflating the two is how copy buttons start pasting markup.
   */
  readonly children?: ReactNode;
  readonly copyable?: boolean;
  readonly className?: string;
}

/**
 * A code block.
 *
 * Two rules it exists to enforce, both of which get broken when code blocks are
 * hand-rolled per page:
 *
 * 1. It scrolls inside itself. A long command is the single most common cause
 *    of accidental horizontal page scroll, and `scrollable-x` contains it.
 * 2. The copy target is the source string, never the DOM text. Highlighted
 *    markup, line numbers and prompt glyphs must never end up on the clipboard.
 */
export function CodeBlock({ code, label, children, copyable = true, className }: CodeBlockProps) {
  return (
    <figure className={cn('overflow-hidden rounded-md border border-line bg-inset', className)}>
      {(label !== undefined || copyable) && (
        <figcaption className="flex items-center justify-between gap-3 border-b border-line-soft bg-surface-2/60 px-3 py-1.5">
          <span className="truncate font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
            {label ?? ''}
          </span>
          {copyable && <CopyButton value={code} className="shrink-0" />}
        </figcaption>
      )}
      <div className="scrollable-x">
        <pre className="px-3.5 py-3 text-[0.78125rem] leading-relaxed text-ink">
          <code>{children ?? code}</code>
        </pre>
      </div>
    </figure>
  );
}

/**
 * A single shell command, presented as one line with a prompt.
 *
 * The `$` is a `::before` on the row rather than part of the string, so it
 * cannot be copied along with the command -- the small papercut that makes
 * people stop trusting copy buttons.
 */
export function CommandLine({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-sm border border-line bg-inset px-3 py-2',
        className,
      )}
    >
      <span aria-hidden="true" className="select-none font-mono text-[0.78125rem] text-accent">
        $
      </span>
      <code className="scrollable-x flex-1 whitespace-pre font-mono text-[0.78125rem] text-ink">
        {command}
      </code>
      <CopyButton
        value={command}
        className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}
