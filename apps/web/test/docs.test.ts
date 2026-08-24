import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import {
  allDocSlugs,
  DOCS_INDEX_SLUG,
  findAdjacentDocs,
  flattenDocsNav,
} from '../content/docs/nav.js';
import { getSearchIndex } from '../lib/docs-search.js';
import { getDoc } from '../lib/mdx.js';

const CONTENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../content/docs');

/**
 * Content <-> nav consistency.
 *
 * `content/docs/nav.ts` and `content/docs/*.mdx` are two separate places that
 * must agree on the same set of slugs, and nothing enforces that at compile
 * time — a typo in either one silently produces a page nobody can navigate to,
 * or a nav entry that 404s. These tests are the enforcement.
 */
describe('docs content matches the nav manifest', () => {
  const fileSlugs = readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith('.mdx'))
    .map((name) => name.replace(/\.mdx$/, ''))
    .sort();

  it('has exactly one .mdx file per nav entry, and no orphans', () => {
    expect(fileSlugs).toEqual([...allDocSlugs()].sort());
  });

  it.each(fileSlugs)('%s.mdx declares a title in its frontmatter', (slug) => {
    const raw = readFileSync(join(CONTENT_DIR, `${slug}.mdx`), 'utf8');
    const { data } = matter(raw);
    expect(typeof data['title']).toBe('string');
    expect(data['title'].length).toBeGreaterThan(0);
  });
});

describe('findAdjacentDocs', () => {
  it('has no prev on the first page and no next on the last', () => {
    const flat = flattenDocsNav();
    expect(flat.length).toBeGreaterThan(1);
    const first = findAdjacentDocs(flat[0]?.slug ?? '');
    const last = findAdjacentDocs(flat.at(-1)?.slug ?? '');
    expect(first.prev).toBeNull();
    expect(last.next).toBeNull();
  });

  it('walks across group boundaries, not just within one group', () => {
    // "concepts" is the last item of the first group ("Get started"); its next
    // page is the first item of the second group ("The loop"), not null.
    const { next } = findAdjacentDocs('concepts');
    expect(next?.slug).toBe('check');
  });
});

/**
 * The compile pipeline, exercised for real.
 *
 * This is the one place the actual `@mdx-js/mdx` + remark/rehype pipeline in
 * `lib/mdx.ts` runs in the test suite, rather than being asserted about
 * abstractly — a broken plugin order or a theme name Shiki does not ship would
 * otherwise only surface by loading a page in a browser.
 */
describe('getDoc', () => {
  it('compiles the index doc and produces headings with slug ids', async () => {
    const doc = await getDoc(DOCS_INDEX_SLUG);
    expect(doc).not.toBeNull();
    expect(typeof doc?.Component).toBe('function');
    expect(doc?.frontmatter.title.length).toBeGreaterThan(0);
    // rehype-slug's ids are lowercase-and-hyphens; asserting the shape here
    // (rather than a specific id) keeps this from re-implementing the slugger.
    for (const heading of doc?.headings ?? []) {
      expect(heading.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('compiles every registered doc without throwing', async () => {
    for (const slug of allDocSlugs()) {
      const doc = await getDoc(slug);
      expect(doc, `${slug}.mdx failed to compile`).not.toBeNull();
    }
  });

  it('returns null for a slug with no matching file', async () => {
    expect(await getDoc('does-not-exist')).toBeNull();
  });
});

describe('getSearchIndex', () => {
  it('indexes every doc with at least a title', async () => {
    const index = await getSearchIndex();
    expect(index).toHaveLength(allDocSlugs().length);
    for (const entry of index) {
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it("matches getDoc's own heading ids exactly", async () => {
    // The whole reason the search index uses `github-slugger` directly instead
    // of its own slug logic: a search result's `#anchor` has to land on the id
    // the real compiled page gave that heading, not a close approximation of it.
    const index = await getSearchIndex();
    const quickstart = index.find((entry) => entry.slug === DOCS_INDEX_SLUG);
    const compiled = await getDoc(DOCS_INDEX_SLUG);

    expect(quickstart).toBeDefined();
    expect(quickstart?.headings.map((h) => h.id)).toEqual(compiled?.headings.map((h) => h.id));
  });
});
