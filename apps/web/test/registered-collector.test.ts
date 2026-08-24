import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, Repository } from '@molt/store';

/**
 * `getRegisteredCollector`.
 *
 * This module exists to fix a real bug: the playground's live-check tab used to
 * target a chaos collector id typed in as a string literal
 * (`LIVE_COLLECTOR_ID` in `lib/playground-config.ts`), duplicating the *real*
 * source of truth — `MOLT_COLLECTOR_CHAOS` in `.env`, which is what
 * `apps/sentinel`'s `molt init` actually registers into the database. Redeploy
 * chaos, get a new id, update `.env`, and the hardcoded copy would keep pointing
 * at the old collector forever — nothing would error, it would just silently
 * check the wrong thing.
 *
 * These tests exercise the fix directly against an in-memory database (never the
 * real configured one — this suite must pass offline with no account, per
 * `CLAUDE.md`), by mocking `lib/context.ts`'s `getContext` to hand back a
 * `Repository` this test seeded itself.
 */

vi.mock('@/lib/context', () => ({
  getContext: vi.fn(),
}));

async function repoWith(
  collectors: readonly {
    id: string;
    name: string;
    targetUrl: string;
    kind: 'primary' | 'chaos' | 'custom';
  }[],
): Promise<Repository> {
  const db = await openDatabase({ url: ':memory:' });
  const repo = new Repository(db);
  for (const collector of collectors) {
    await repo.saveCollector({
      ...collector,
      recordPath: null,
      inherit: [],
      canaryUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }
  return repo;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('getRegisteredCollector', () => {
  it('finds the collector of the requested kind', async () => {
    const repo = await repoWith([
      {
        id: 'c_primary1',
        name: 'molt-pg-advisories',
        targetUrl: 'https://postgresql.org/',
        kind: 'primary',
      },
      {
        id: 'c_chaos1',
        name: 'molt-chaos',
        targetUrl: 'https://molt-chaos.vercel.app',
        kind: 'chaos',
      },
    ]);
    const { getContext } = await import('@/lib/context');
    vi.mocked(getContext).mockResolvedValue({ repo } as never);

    const { getRegisteredCollector } = await import('../lib/registered-collector.js');

    const chaos = await getRegisteredCollector('chaos');
    expect(chaos?.id).toBe('c_chaos1');

    const primary = await getRegisteredCollector('primary');
    expect(primary?.id).toBe('c_primary1');
  });

  it('returns null when nothing of that kind is registered', async () => {
    const repo = await repoWith([
      {
        id: 'c_primary1',
        name: 'molt-pg-advisories',
        targetUrl: 'https://postgresql.org/',
        kind: 'primary',
      },
    ]);
    const { getContext } = await import('@/lib/context');
    vi.mocked(getContext).mockResolvedValue({ repo } as never);

    const { getRegisteredCollector } = await import('../lib/registered-collector.js');

    expect(await getRegisteredCollector('chaos')).toBeNull();
  });

  it('returns null against an empty database, rather than throwing', async () => {
    const repo = await repoWith([]);
    const { getContext } = await import('@/lib/context');
    vi.mocked(getContext).mockResolvedValue({ repo } as never);

    const { getRegisteredCollector } = await import('../lib/registered-collector.js');

    expect(await getRegisteredCollector('chaos')).toBeNull();
  });

  it('reflects an update to the same collector immediately, with nothing cached', async () => {
    // The whole point of resolving this from the database instead of a
    // constant: a change to the registered row must be visible on the very
    // next call, with nothing anywhere holding a stale copy.
    const repo = await repoWith([
      {
        id: 'c_chaos1',
        name: 'molt-chaos',
        targetUrl: 'https://molt-chaos.vercel.app',
        kind: 'chaos',
      },
    ]);
    const { getContext } = await import('@/lib/context');
    vi.mocked(getContext).mockResolvedValue({ repo } as never);

    const { getRegisteredCollector } = await import('../lib/registered-collector.js');

    expect((await getRegisteredCollector('chaos'))?.targetUrl).toBe(
      'https://molt-chaos.vercel.app',
    );

    // Re-saving the same id with a new target (e.g. the chaos site's URL
    // changed) must be reflected on the next lookup, not held over from before.
    await repo.saveCollector({
      id: 'c_chaos1',
      name: 'molt-chaos',
      targetUrl: 'https://molt-chaos-v2.vercel.app',
      kind: 'chaos',
      recordPath: null,
      inherit: [],
      canaryUrl: null,
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    expect((await getRegisteredCollector('chaos'))?.targetUrl).toBe(
      'https://molt-chaos-v2.vercel.app',
    );
  });
});
