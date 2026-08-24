import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { TerminalDrawer } from '@/components/TerminalDrawer';
import { getContext } from '@/lib/context';
import { THEME_CANVAS, THEME_INIT_SCRIPT } from '@/lib/theme';

import './globals.css';

/*
 * Fonts.
 *
 * `next/font/google` downloads these at build time and serves them from our own
 * origin, so there is no runtime request to Google and no third-party font
 * connection at all. This does mean the build now needs network access on a cold
 * cache -- a deliberate trade for a real type system, and the reason
 * `globals.css` no longer claims the app fetches nothing at build time.
 *
 * `display: 'swap'` with the fallback stacks declared in `globals.css`: text is
 * readable from the first paint, and the swap is imperceptible because the
 * metrics of the fallbacks are close.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: 'Molt — Scraper Reliability Engineering',
  description:
    'Detects silent breakage in Bright Data Scraper Studio collectors, heals it, and verifies the fix before closing the incident.',
};

export const viewport: Viewport = {
  // Two entries with media queries rather than one value: the browser chrome
  // then matches the theme without waiting for any JavaScript to run.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_CANVAS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_CANVAS.dark },
  ],
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
        <ThemeToggle />
        {/* The sponsor credit is the first thing to go on a narrow screen: it is
         * the least actionable element in the rail, and it also gets a permanent
         * home in the public footer. The theme control stays at every width. */}
        <span className="hidden sm:inline">
          Powered by <strong>Bright Data Scraper Studio</strong>
        </span>
      </div>
    </div>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `suppressHydrationWarning` is required here and is not a papering-over.
    // The server cannot know the visitor's OS colour preference, so it renders
    // `<html>` with no `data-theme`; the pre-paint script below then adds one
    // before React ever runs. That is a deliberate, unavoidable difference on
    // exactly one attribute of exactly this element, and without the suppression
    // React logs a hydration error on every page load. It is scoped to this tag,
    // so a genuine mismatch anywhere inside the tree is still reported.
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
         * Sets `data-theme` before the first paint.
         *
         * This has to be inline and blocking. A React effect runs after
         * hydration, by which point the browser has already painted a frame in
         * whichever theme the CSS defaults to -- the flash of the wrong theme.
         * The script source lives in `lib/theme.ts` so it is testable.
         */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a blocking pre-paint script cannot be expressed any other way; the content is a module-level constant with no interpolated input. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <Rail />
          <main className="shell pb-[140px]">{children}</main>
          <TerminalDrawer />
        </ThemeProvider>
      </body>
    </html>
  );
}
