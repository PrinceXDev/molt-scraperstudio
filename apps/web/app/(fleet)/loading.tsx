import { Skeleton } from '@/components/ui/Surface';

/**
 * The cockpit's loading state.
 *
 * Every cockpit page is `force-dynamic` and does real database work — the Fleet
 * page snapshots, baselines, incidents and command history per collector — so
 * there is a real gap to fill. Until now it was filled with nothing, and a
 * navigation looked like a broken link.
 *
 * Shaped like the content it replaces rather than a spinner, so the layout does
 * not jump when the data lands.
 */
export default function FleetLoading() {
  return (
    // `role="status"` rather than a bare div: `aria-busy` and `aria-label` are
    // only meaningful on an element with a role that supports them, and status
    // is the one that announces "still working" without stealing focus.
    <div role="status" aria-busy="true" aria-label="Loading the fleet">
      <div className="page-head">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      <div className="grid gap-4">
        {[0, 1].map((card) => (
          <div key={card} className="card">
            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="mt-5 grid gap-1.5">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="grid grid-cols-[140px_1fr_56px] items-center gap-2.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5" />
                  <Skeleton className="h-3" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
