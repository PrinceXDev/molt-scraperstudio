/**
 * Site-wide constants.
 *
 * One file for the handful of strings that appear in more than one place --
 * product name, repository URL, the nav -- because the alternative is the
 * failure mode every marketing site has: the footer links to a stale URL, or the
 * header says "Playground" while the route is `/play`, and nobody notices for a
 * month. It is also what lets the nav be unit-tested (see
 * `apps/web/test/nav.test.ts`) without rendering React.
 */

export const SITE = {
  name: 'Molt',
  tagline: 'Scraper Reliability Engineering',
  description:
    'Molt watches Bright Data Scraper Studio collectors for silent breakage, diagnoses it from measured drift, heals the same collector, and verifies the fix before closing the incident.',
  repository: 'https://github.com/PrinceXDev/molt-scraperstudio',
  platform: 'Bright Data Scraper Studio',
} as const;

/**
 * The absolute origin, for resolving social-card and icon URLs.
 *
 * Open Graph tags must carry absolute URLs — a relative one is ignored by every
 * crawler — so Next needs an origin to resolve them against. Without this it
 * warns at build time and falls back to `http://localhost:3000`, which would
 * ship a social card nobody outside this machine can fetch.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is the stable production hostname (unlike
 * `VERCEL_URL`, which is the per-deployment one and would pin cards to a
 * throwaway preview). `MOLT_SITE_URL` overrides both for any other host.
 */
export function siteOrigin(): URL {
  const explicit = process.env['MOLT_SITE_URL'];
  if (explicit !== undefined && explicit !== '') return new URL(explicit);

  const vercel = process.env['VERCEL_PROJECT_PRODUCTION_URL'];
  if (vercel !== undefined && vercel !== '') return new URL(`https://${vercel}`);

  return new URL('http://localhost:3000');
}

export interface NavItem {
  readonly label: string;
  readonly href: string;
  /**
   * Marks a destination that does not exist yet.
   *
   * Deliberately modelled rather than handled by "just don't add the link".
   * `/docs` and `/playground` are being built in later phases, and the honest
   * options were to hide them (so the nav changes shape twice) or to ship links
   * that 404. Neither is good. A visible, non-navigating item with a `soon`
   * marker tells a visitor what is coming and never lies to them; flipping the
   * flag off is the only change the later phase needs to make here.
   */
  readonly soon?: boolean;
  /** External links get the arrow affordance and `rel="noreferrer"`. */
  readonly external?: boolean;
}

export const NAV: readonly NavItem[] = [
  { label: 'How it works', href: '/#how' },
  { label: 'Docs', href: '/docs' },
  { label: 'Playground', href: '/playground' },
  { label: 'GitHub', href: SITE.repository, external: true },
] as const;

/**
 * The anchors the landing page exposes, in document order.
 *
 * Exported so the header's scroll-spy and the section markup cannot disagree
 * about an id -- the classic way an in-page nav quietly stops highlighting.
 */
export const LANDING_SECTIONS = [
  { id: 'lie', label: 'The failure' },
  { id: 'memory', label: 'The missing memory' },
  { id: 'how', label: 'How it works' },
  { id: 'gate', label: 'The human gate' },
  { id: 'platform', label: 'Bright Data' },
  { id: 'limits', label: 'Honest limits' },
] as const;

export type LandingSectionId = (typeof LANDING_SECTIONS)[number]['id'];
