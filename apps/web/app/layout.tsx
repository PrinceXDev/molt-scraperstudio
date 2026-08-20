import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { TerminalDrawer } from '@/components/TerminalDrawer';
import { getContext } from '@/lib/context';

import './globals.css';

export const metadata: Metadata = {
  title: 'Molt — Scraper Reliability Engineering',
  description:
    'Detects silent breakage in Bright Data Scraper Studio collectors, heals it, and verifies the fix before closing the incident.',
};

async function Rail() {
  const { repo } = await getContext();
  const collectors = await repo.listCollectors();

  return (
    <div className="rail">
      <div className="rail-brand">
        <span className="dot" />
        Molt
      </div>
      <nav className="rail-nav">
        <Link href="/">Fleet</Link>
        {collectors.map((c) => (
          <Link key={c.id} href={`/c/${c.id}`}>
            {c.kind}
          </Link>
        ))}
      </nav>
      <div className="rail-powered">
        Powered by <strong>Bright Data Scraper Studio</strong>
      </div>
    </div>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Rail />
        <main className="shell pb-[140px]">{children}</main>
        <TerminalDrawer />
      </body>
    </html>
  );
}
