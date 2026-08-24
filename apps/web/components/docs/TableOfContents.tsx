'use client';

import { useEffect, useState } from 'react';

import type { DocHeading } from '@/lib/mdx';
import { cn } from '@/lib/cn';

/**
 * The right-hand "on this page" rail.
 *
 * Tracks the active heading with `IntersectionObserver` over the ids
 * `rehype-slug` stamped and `lib/mdx.ts` collected at compile time — the same
 * pattern the landing page's header uses for its own scroll-spy, so there is
 * one mental model for "what section am I looking at" across the app rather
 * than two slightly different ones.
 */
export function TableOfContents({ headings }: { headings: readonly DocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;

    const nodes = headings
      .map((h) => document.getElementById(h.id))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const firstVisible = headings.find((h) => visible.has(h.id));
        if (firstVisible !== undefined) setActiveId(firstVisible.id);
      },
      { rootMargin: '-88px 0px -70% 0px' },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="On this page" className="grid gap-2">
      <p className="font-mono text-eyebrow font-semibold uppercase tracking-wider text-faint">
        On this page
      </p>
      <ul className="grid gap-1 border-l border-line-soft">
        {headings.map((heading) => (
          <li key={heading.id} style={{ paddingLeft: heading.depth === 3 ? '1.5rem' : '0.875rem' }}>
            <a
              href={`#${heading.id}`}
              className={cn(
                '-ml-px block border-l py-0.5 text-[0.78125rem] leading-snug transition-colors',
                activeId === heading.id
                  ? 'border-accent font-medium text-accent'
                  : 'border-transparent text-faint hover:text-ink',
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
