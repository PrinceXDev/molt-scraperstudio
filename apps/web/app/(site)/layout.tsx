import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';

/**
 * The public shell: landing page, and later `/docs` and `/playground`.
 *
 * Deliberately free of any database access. Everything under `(site)` can be
 * statically rendered, which is why the cockpit's rail and terminal drawer live
 * in the sibling `(fleet)` group instead of the root layout.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      {/* The skip link targets this. `scroll-mt` keeps the sticky header from
       * covering whatever the anchor lands on. */}
      <main id="content" className="flex-1 scroll-mt-24">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
