import Link from 'next/link';

import type { DocAdjacency } from '@/content/docs/nav';
import { ArrowRightIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

function hrefFor(slug: string): string {
  return slug === 'quickstart' ? '/docs' : `/docs/${slug}`;
}

/** The prev/next footer. Renders only the sides that exist — first and last pages have one link, not a disabled ghost of the other. */
export function PrevNext({ prev, next }: DocAdjacency) {
  if (prev === null && next === null) return null;

  return (
    <div className="mt-14 grid gap-3 border-t border-line-soft pt-8 sm:grid-cols-2">
      {prev !== null ? (
        <Link
          href={hrefFor(prev.slug)}
          className="group flex flex-col gap-1 rounded-md border border-line p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
            <ArrowRightIcon className="rotate-180" />
            Previous
          </span>
          <span className="font-medium text-ink">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}

      {next !== null && (
        <Link
          href={hrefFor(next.slug)}
          className={cn(
            'group flex flex-col gap-1 rounded-md border border-line p-4 text-right transition-colors hover:border-line-strong hover:bg-surface-2',
            prev === null && 'sm:col-start-2',
          )}
        >
          <span className="flex items-center justify-end gap-1.5 font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
            Next
            <ArrowRightIcon />
          </span>
          <span className="font-medium text-ink">{next.title}</span>
        </Link>
      )}
    </div>
  );
}
