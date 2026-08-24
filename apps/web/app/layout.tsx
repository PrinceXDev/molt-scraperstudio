import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { SITE, siteOrigin } from '@/lib/site';
import { THEME_CANVAS, THEME_INIT_SCRIPT } from '@/lib/theme';

import './globals.css';

/*
 * Fonts.
 *
 * `next/font/google` downloads these at build time and serves them from our own
 * origin, so there is no runtime request to Google and no third-party font
 * connection at all. This does mean the build now needs network access on a cold
 * cache -- a deliberate trade for a real type system.
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
  metadataBase: siteOrigin(),
  // A template, so every page below contributes only its own name.
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s — ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  // Two entries with media queries rather than one value: the browser chrome
  // then matches the theme without waiting for any JavaScript to run.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_CANVAS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_CANVAS.dark },
  ],
};

/**
 * The root layout owns the document and nothing else.
 *
 * There are two shells below it and they share no chrome: `(site)` is the public
 * surface (header, footer, prose measure) and `(fleet)` is the cockpit (rail,
 * terminal drawer, data grids). Keeping the split at the route-group level means
 * the landing page does not carry the cockpit's DB query and the cockpit does not
 * carry the marketing header -- which is exactly what went wrong when the rail
 * lived here and every page, including future static ones, inherited a
 * `listCollectors()` call.
 */
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
