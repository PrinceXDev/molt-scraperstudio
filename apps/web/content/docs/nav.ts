/**
 * The documentation's table of contents.
 *
 * This file is the single source of truth for doc structure: sidebar grouping,
 * page order, prev/next links, and the slugs `content/docs/*.mdx` must match. It
 * is deliberately plain data with no filesystem access, so it can be imported by
 * a Server Component, a client sidebar, and a unit test alike.
 *
 * Order within a group is reading order — it drives prev/next as well as the
 * sidebar, so reordering here reorders both.
 */

export interface DocNavItem {
  readonly slug: string;
  readonly title: string;
}

export interface DocNavGroup {
  readonly title: string;
  readonly items: readonly DocNavItem[];
}

export const DOCS_NAV: readonly DocNavGroup[] = [
  {
    title: 'Get started',
    items: [
      { slug: 'quickstart', title: 'Quickstart' },
      { slug: 'concepts', title: 'Concepts' },
    ],
  },
  {
    title: 'The loop',
    items: [
      { slug: 'check', title: 'molt check' },
      { slug: 'watch', title: 'molt watch' },
      { slug: 'heal-and-review', title: 'Heal & review' },
      { slug: 'baselines', title: 'Baselines' },
    ],
  },
  {
    title: 'Operating a fleet',
    items: [
      { slug: 'onboarding-targets', title: 'Onboarding a target' },
      { slug: 'credits', title: 'Credits' },
      { slug: 'doctor-and-unblock', title: 'doctor & unblock' },
      { slug: 'cli-reference', title: 'CLI reference' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { slug: 'incident-states', title: 'Incident states' },
      { slug: 'bright-data-integration', title: 'Bright Data integration' },
      { slug: 'honest-limits', title: 'Honest limits' },
      { slug: 'architecture', title: 'Architecture' },
      { slug: 'decisions', title: 'Decision log' },
    ],
  },
] as const;

/** The page `/docs` (no slug) renders. Every other page lives at `/docs/<slug>`. */
export const DOCS_INDEX_SLUG = 'quickstart';

/** Every item, in reading order, flattened across groups. */
export function flattenDocsNav(): readonly DocNavItem[] {
  return DOCS_NAV.flatMap((group) => group.items);
}

/** All slugs — the set `content/docs/*.mdx` must exactly match. */
export function allDocSlugs(): readonly string[] {
  return flattenDocsNav().map((item) => item.slug);
}

export function findDocNavItem(slug: string): DocNavItem | null {
  return flattenDocsNav().find((item) => item.slug === slug) ?? null;
}

/** Which group a slug belongs to, for the breadcrumb trail. */
export function findDocGroup(slug: string): DocNavGroup | null {
  return DOCS_NAV.find((group) => group.items.some((item) => item.slug === slug)) ?? null;
}

export interface DocAdjacency {
  readonly prev: DocNavItem | null;
  readonly next: DocNavItem | null;
}

/** The previous and next pages in reading order, across group boundaries. */
export function findAdjacentDocs(slug: string): DocAdjacency {
  const flat = flattenDocsNav();
  const index = flat.findIndex((item) => item.slug === slug);
  if (index === -1) return { prev: null, next: null };
  return { prev: flat[index - 1] ?? null, next: flat[index + 1] ?? null };
}
