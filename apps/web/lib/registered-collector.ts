import type { CollectorKind, CollectorRecord } from '@molt/store';

import { getContext } from '@/lib/context';

/**
 * Look up the one registered collector of a given kind, from the same database
 * `molt init` populates — not from a copy of its ID kept anywhere else.
 *
 * This exists to fix a real bug: `lib/playground-config.ts` used to export a
 * `LIVE_COLLECTOR_ID` constant — the chaos collector's id, typed in as a string
 * literal alongside the *real* configuration for it, `MOLT_COLLECTOR_CHAOS` in
 * `.env`, which is what `apps/sentinel`'s `molt init` actually reads to register
 * it. Two sources of truth for the same fact is exactly the shape a silent bug
 * takes: redeploy chaos, get a new collector id, update `.env`, and the
 * playground's live-check tab keeps calling the old one — nothing would error,
 * it would just quietly check the wrong (or a no-longer-existing) collector
 * forever, because nothing ever told the hardcoded copy to change.
 *
 * Reading the database instead means there is nothing to keep in sync: whatever
 * `molt init` actually registered is what this returns, every time.
 *
 * `kind === 'primary'` deliberately is not resolved through this path anywhere
 * in the playground today — the live-check and create tabs both stay off the
 * primary collector by design, so the primary's own env var
 * (`MOLT_COLLECTOR_PRIMARY`, read only by `apps/sentinel`) needs no equivalent
 * here. This helper is generic over `CollectorKind` regardless, since "the one
 * registered collector of a kind" is a fact worth being able to ask for
 * correctly no matter which kind a future caller needs.
 */
export async function getRegisteredCollector(kind: CollectorKind): Promise<CollectorRecord | null> {
  const { repo } = await getContext();
  const collectors = await repo.listCollectors();
  return collectors.find((collector) => collector.kind === kind) ?? null;
}
