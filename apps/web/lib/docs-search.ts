import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';
import GithubSlugger from 'github-slugger';

import { findDocGroup, flattenDocsNav } from '@/content/docs/nav';

// See the identical comment in `lib/mdx.ts`: resolved from this module's own
// location, not `process.cwd()`, because that differs between Next's runtime
// and the test runner.
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../content/docs');

export interface SearchHeading {
  readonly id: string;
  readonly text: string;
}

export interface SearchEntry {
  readonly slug: string;
  readonly title: string;
  readonly group: string;
  readonly description: string;
  readonly headings: readonly SearchHeading[];
}

/**
 * Match rehype-slug's own algorithm exactly.
 *
 * `github-slugger` is what `rehype-slug` uses internally (see its
 * `package.json`), added here as a direct dependency so a search result's deep
 * link (`/docs/check#thresholds`) lands on the same id the rendered page
 * actually gave that heading. Recomputing IDs with a different slugifier is
 * the easy way for a search index to link to anchors that do not exist.
 */
function headingsOf(markdown: string): SearchHeading[] {
  const slugger = new GithubSlugger();
  const headings: SearchHeading[] = [];
  let inFence = false;

  for (const line of markdown.split('\n')) {
    // A line-based scan has to track fence state explicitly, or a `##`-looking
    // line inside a fenced example (a diagram, a comment in a shown command)
    // reads as a real heading. None of today's docs happen to trigger it, but
    // "happens not to trigger it" is exactly the kind of assumption that breaks
    // silently the next time someone adds a code sample.
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^#{2,3}\s+(.+?)\s*#*$/.exec(line);
    if (match?.[1] === undefined) continue;
    // Strip inline markdown emphasis/code marks so the indexed text and the
    // displayed heading text are the same string a reader would search for.
    const text = match[1].replace(/[`*_]/g, '');
    headings.push({ id: slugger.slug(text), text });
  }

  return headings;
}

/**
 * The full-text search index, built once per server lifetime.
 *
 * `cache()` here is a plain module-level memo (this file's promise is created
 * once, unlike `lib/mdx.ts`'s `cache()` which is React's per-request one) —
 * deliberate, since the corpus is static content shipped in the same build.
 * Rebuilding it per request would mean re-reading and re-parsing every doc file
 * on every keystroke in the search dialog for zero benefit.
 *
 * This intentionally does not go through `getDoc`'s full MDX compile: a
 * heading-only regex pass and `gray-matter`'s frontmatter parse are enough for
 * search, and are far cheaper across a few dozen files than compiling each one
 * to a component just to throw the component away.
 */
let indexPromise: Promise<readonly SearchEntry[]> | null = null;

export function getSearchIndex(): Promise<readonly SearchEntry[]> {
  indexPromise ??= buildIndex();
  return indexPromise;
}

async function buildIndex(): Promise<readonly SearchEntry[]> {
  const entries = await Promise.all(
    flattenDocsNav().map(async (item): Promise<SearchEntry> => {
      const raw = await readFile(join(CONTENT_DIR, `${item.slug}.mdx`), 'utf8');
      const { content, data } = matter(raw);
      return {
        slug: item.slug,
        title: typeof data['title'] === 'string' ? data['title'] : item.title,
        group: findDocGroup(item.slug)?.title ?? '',
        description: typeof data['description'] === 'string' ? data['description'] : '',
        headings: headingsOf(content),
      };
    }),
  );

  return entries;
}
