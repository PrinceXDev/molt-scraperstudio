import Link from 'next/link';

import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';
import { buttonClasses } from '@/components/ui/Button';

/**
 * The root 404.
 *
 * It renders the public shell explicitly rather than inheriting one. A
 * `not-found.tsx` at the root sits outside both route groups, so it gets the root
 * layout only — and a 404 with no navigation is a dead end. Cockpit pages that
 * call `notFound()` for a missing collector or incident land here too, which is
 * why one of the routes offered is the fleet.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-24 sm:px-6">
          <p className="font-mono text-eyebrow font-semibold uppercase tracking-wider text-faint">
            404
          </p>
          <h1 className="mt-5 max-w-2xl text-display-sm font-semibold sm:text-display-md">
            <span className="block text-muted">That page is not here.</span>
            <span className="block text-ink">Nothing was silently substituted for it.</span>
          </h1>
          <p className="prose-measure mt-5 text-[0.9375rem] text-muted">
            If you followed a link to a collector or an incident, it may have been removed — or the
            URL may predate the move of the cockpit to <code className="pill">/fleet</code>.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/" className={buttonClasses({ variant: 'primary' })}>
              Back to the start
            </Link>
            <Link href="/fleet" className={buttonClasses({ variant: 'secondary' })}>
              Open the cockpit
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
