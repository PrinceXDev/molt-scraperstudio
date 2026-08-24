import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { TerminalDrawer } from '@/components/TerminalDrawer';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { getContext } from '@/lib/context';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Cockpit',
};

/**
 * The cockpit rail.
 *
 * Still a server component that queries the DB, but it now lives under
 * `(fleet)` rather than the root layout, so the public pages no longer inherit a
 * `listCollectors()` call they have no use for.
 *
 * Collectors are labelled by `name`, not `kind`. `kind` is an internal
 * discriminator with three values (`primary` / `chaos` / `custom`) and two
 * collectors of the same kind would have rendered as two identical nav items.
 */
async function Rail() {
  const { repo } = await getContext();
  const collectors = await repo.listCollectors();

  return (
    <header className="rail">
      <Link href="/" className="rail-brand" aria-label={`${SITE.name} home`}>
        <span className="dot" />
        {SITE.name}
      </Link>

      <nav className="rail-nav" aria-label="Cockpit">
        <Link href="/fleet">Fleet</Link>
        {collectors.map((c) => (
          <Link key={c.id} href={`/fleet/c/${c.id}`} title={c.targetUrl}>
            {c.name}
          </Link>
        ))}
      </nav>

      <div className="rail-powered">
        <ThemeToggle />
        {/* The sponsor credit is the first thing to go on a narrow screen: it is
         * the least actionable element in the rail, and it also has a permanent
         * home in the public footer. The theme control stays at every width. */}
        <span className="hidden sm:inline">
          Powered by <strong>{SITE.platform}</strong>
        </span>
      </div>
    </header>
  );
}

export default function FleetLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Rail />
      {/* The bottom padding clears the fixed terminal drawer. */}
      <main className="shell pb-[140px]">{children}</main>
      <TerminalDrawer />
    </>
  );
}
