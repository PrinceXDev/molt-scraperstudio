/**
 * The chaos dataset.
 *
 * A fixed, deterministic changelog. No clock, no randomness — the same 60
 * entries every time, so a scrape of `?v=1` today matches a scrape of `?v=1`
 * tomorrow and any difference Molt reports is a real difference in *markup*,
 * never in content.
 */

export interface Entry {
  readonly slug: string;
  readonly version: string;
  readonly date: string;
  readonly category: 'service' | 'client' | 'security';
  readonly title: string;
  readonly body: string;
  readonly downloads: number;
  readonly commentCount: number;
  readonly tags: readonly string[];
  /** Deliberately sparse — see `RELATED_LINK_EVERY`. */
  readonly relatedLink: string | null;
}

const CATEGORIES = ['service', 'client', 'security'] as const;

const TITLES = [
  'Faster cold starts for edge workers',
  'Rewrote the connection pool for lower tail latency',
  'Fixed a race in the token refresh path',
  'Added structured audit logging',
  'Reduced memory usage in the ingest pipeline',
  'Support for regional failover',
  'Hardened the webhook signature check',
  'New retry semantics for idempotent writes',
  'Backfilled missing timestamps in the events table',
  'Improved error messages on schema mismatch',
  'Dropped support for the legacy v1 endpoint',
  'Batched metric flushes to cut egress',
] as const;

const BODIES = [
  'Cold start times drop by roughly half on the smallest instance sizes. No configuration change is required.',
  'The pool now grows lazily and shrinks under sustained idle, which removes a long-standing latency spike at the 99th percentile.',
  'Two concurrent refreshes could both write a token, and the loser would be used for subsequent calls. Refreshes are now single-flighted.',
  'Every mutating call now emits a structured record with the actor, the target and the resolved decision.',
  'The ingest path no longer buffers whole payloads in memory before validating them.',
  'Traffic now fails over to the nearest healthy region automatically, with no client change.',
] as const;

const TAG_POOL = [
  'performance',
  'reliability',
  'security',
  'breaking',
  'observability',
  'api',
  'infra',
] as const;

/** Every nth entry gets a related link, so the field is genuinely optional. */
const RELATED_LINK_EVERY = 3;

const ENTRY_COUNT = 60;

/**
 * Pick from a tuple by index, wrapping. Deterministic by construction, and it
 * satisfies `noUncheckedIndexedAccess` without a non-null assertion.
 */
function cycle<T>(items: readonly [T, ...T[]], index: number): T {
  const value = items[index % items.length];
  return value ?? items[0];
}

function buildEntry(index: number): Entry {
  const major = 1;
  const minor = 100 - Math.floor(index / 4);
  const patch = index % 4;
  const version = `v${major}.${minor}.${patch}`;

  // Walk backwards from a fixed date, one entry every other day.
  const day = new Date(Date.UTC(2026, 7, 19) - index * 2 * 86_400_000);
  const date = day.toISOString().slice(0, 10);

  const category = cycle(CATEGORIES, index);
  const tagCount = (index % 3) + 1;
  const tags = Array.from({ length: tagCount }, (_, t) => cycle(TAG_POOL, index + t * 2));

  return {
    slug: `${date}-${category}`,
    version,
    date,
    category,
    title: cycle(TITLES, index),
    body: cycle(BODIES, index),
    // Spread over three orders of magnitude so a collapse to zero is obvious.
    downloads: 1_200 + ((index * 977) % 48_000),
    commentCount: 3 + ((index * 31) % 120),
    tags,
    relatedLink:
      index % RELATED_LINK_EVERY === 0 ? `https://example.com/docs/${date}-${category}` : null,
  };
}

export const ENTRIES: readonly Entry[] = Array.from({ length: ENTRY_COUNT }, (_, i) =>
  buildEntry(i),
);
