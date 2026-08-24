'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { SearchEntry } from '@/lib/docs-search';
import { SearchIcon } from '@/components/icons';
import { Kbd } from '@/components/ui/Surface';
import { cn } from '@/lib/cn';

interface Hit {
  readonly href: string;
  readonly title: string;
  readonly group: string;
  readonly context: string;
  readonly score: number;
}

/**
 * Substring + token scoring over the pre-built index.
 *
 * Not a search library, on purpose: the corpus is a few dozen doc pages, and a
 * ranked-substring match over titles, descriptions and headings answers "where
 * is the thing about X" as well as anything heavier would, for a query surface
 * this small. Reaching for a real search engine here would be the dependency
 * this app has spent two phases avoiding.
 *
 * Scoring, highest first: a title match beats a heading match beats a
 * description match, and an exact-start match beats a mid-string one — the two
 * signals that make "credits" surface the Credits page above a page that merely
 * mentions credits in passing.
 */
function search(entries: readonly SearchEntry[], query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  const hits: Hit[] = [];

  for (const entry of entries) {
    const titleLower = entry.title.toLowerCase();
    if (titleLower.includes(q)) {
      hits.push({
        href: `/docs/${entry.slug}`,
        title: entry.title,
        group: entry.group,
        context: entry.description,
        score: titleLower.startsWith(q) ? 100 : 70,
      });
    }

    for (const heading of entry.headings) {
      const headingLower = heading.text.toLowerCase();
      if (headingLower.includes(q)) {
        hits.push({
          href: `/docs/${entry.slug}#${heading.id}`,
          title: heading.text,
          group: `${entry.title} · ${entry.group}`,
          context: '',
          score: headingLower.startsWith(q) ? 60 : 40,
        });
      }
    }

    if (entry.description.toLowerCase().includes(q)) {
      hits.push({
        href: `/docs/${entry.slug}`,
        title: entry.title,
        group: entry.group,
        context: entry.description,
        score: 20,
      });
    }
  }

  // One result per destination, keeping the highest-scoring reason it matched.
  const bySlugAndAnchor = new Map<string, Hit>();
  for (const hit of hits.sort((a, b) => b.score - a.score)) {
    if (!bySlugAndAnchor.has(hit.href)) bySlugAndAnchor.set(hit.href, hit);
  }

  return [...bySlugAndAnchor.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

/** Normalizes the trigger key across platforms — Cmd on macOS, Ctrl elsewhere. */
function isSearchShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
}

export function DocsSearch({ index }: { index: readonly SearchEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => search(index, query), [index, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSearchShortcut(event)) {
        event.preventDefault();
        setOpen((was) => !was);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlighted(0);
    // The dialog mounts closed; focus has to wait one frame for the input to
    // actually exist in the DOM.
    const id = requestAnimationFrame(() => inputRef.current?.focus());

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `query` is the trigger, not a read — this resets the selection whenever the query changes, not whenever `setHighlighted` changes.
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-sm border border-line bg-surface-2 px-3 py-2 text-left text-[0.8125rem] text-faint transition-colors hover:border-line-strong hover:text-muted"
      >
        <SearchIcon className="shrink-0" />
        <span className="flex-1">Search docs</span>
        <Kbd>⌘K</Kbd>
      </button>
    );
  }

  return (
    // The backdrop click-to-dismiss is a mouse convenience layered on top of a
    // fully keyboard-operable dialog, not the only way to close it: Escape is
    // bound on the input below and the visible `Esc` hint says so. A key
    // handler on the backdrop itself would be redundant (nothing can focus it —
    // it carries no `tabIndex` on purpose) and would not add any capability a
    // keyboard user does not already have.
    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse-only convenience; Escape (on the input) is the real, fully accessible dismiss path.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search documentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-md border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
          <SearchIcon className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlighted((i) => Math.min(i + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlighted((i) => Math.max(i - 1, 0));
              } else if (event.key === 'Enter' && results[highlighted] !== undefined) {
                go(results[highlighted].href);
              }
            }}
            placeholder="Search docs…"
            aria-label="Search query"
            aria-activedescendant={
              results[highlighted] !== undefined ? `hit-${String(highlighted)}` : undefined
            }
            aria-controls="docs-search-results"
            role="combobox"
            aria-expanded={results.length > 0}
            autoComplete="off"
            className="w-full bg-transparent text-[0.9375rem] text-ink placeholder:text-faint focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>

        {/*
         * `<div role="listbox">` / `<div role="option">`, not `<ul>`/`<li>`: this
         * is the `aria-activedescendant` combobox pattern (the `role="combobox"`
         * input above owns it), where focus stays on the input the entire time
         * and `aria-activedescendant` tells assistive tech which option is
         * "current" without moving real focus to it. `li` carries an implicit
         * list-item semantic that a listbox option overrides entirely, which is
         * exactly what the non-semantic `div` states plainly instead of hiding.
         */}
        <div id="docs-search-results" role="listbox" className="max-h-80 overflow-y-auto py-2">
          {query.trim() !== '' && results.length === 0 && (
            <div className="px-4 py-6 text-center text-[0.8125rem] text-faint">
              No results for &ldquo;{query}&rdquo;.
            </div>
          )}
          {results.map((hit, i) => (
            // biome-ignore lint/a11y/useFocusableInteractive: aria-activedescendant pattern (WAI-ARIA APG) — the option is deliberately not focusable; the combobox input above stays focused and references it by id.
            <div
              key={hit.href}
              id={`hit-${String(i)}`}
              role="option"
              aria-selected={i === highlighted}
            >
              <button
                type="button"
                onClick={() => go(hit.href)}
                onMouseEnter={() => setHighlighted(i)}
                className={cn(
                  'flex w-full flex-col gap-0.5 px-4 py-2 text-left transition-colors',
                  i === highlighted ? 'bg-accent-soft' : 'hover:bg-surface-2',
                )}
              >
                <span className="text-[0.6875rem] uppercase tracking-wider text-faint">
                  {hit.group}
                </span>
                <span className="text-[0.875rem] font-medium text-ink">{hit.title}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
