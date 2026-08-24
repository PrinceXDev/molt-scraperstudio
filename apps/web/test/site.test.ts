import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LANDING_SECTIONS, NAV, SITE } from '../lib/site.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../app');

/**
 * Nav integrity.
 *
 * The nav is data (`lib/site.ts`) precisely so it can be checked here rather than
 * by clicking every link after every change. Two failures these catch:
 *
 * 1. A nav entry pointing at a route that does not exist — the standard outcome
 *    when a page is renamed or a phase slips.
 * 2. A `soon` flag left on after the route has actually been built, so a shipped
 *    page stays unreachable from the header.
 *
 * Route existence is resolved against the real `app/` tree, walking route groups
 * (`(site)`, `(fleet)`) since those contribute nothing to the URL.
 */

/** Every URL path the app router actually serves, ignoring dynamic segments. */
function collectRoutes(dir: string, urlPath = ''): string[] {
  const routes: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (!statSync(full).isDirectory()) {
      if (entry === 'page.tsx') routes.push(urlPath === '' ? '/' : urlPath);
      continue;
    }

    // Route groups are organisational only — they do not appear in the URL.
    const isGroup = entry.startsWith('(') && entry.endsWith(')');
    // Dynamic and private segments are not static destinations.
    if (entry.startsWith('_') || entry.startsWith('@') || entry === 'api') continue;

    routes.push(...collectRoutes(full, isGroup ? urlPath : `${urlPath}/${entry}`));
  }

  return routes;
}

const ROUTES = new Set(collectRoutes(APP_DIR));

describe('routes', () => {
  it('serves the public landing page and the cockpit', () => {
    expect(ROUTES.has('/')).toBe(true);
    expect(ROUTES.has('/fleet')).toBe(true);
  });
});

describe('NAV', () => {
  it('has no duplicate labels or hrefs', () => {
    expect(new Set(NAV.map((i) => i.label)).size).toBe(NAV.length);
    expect(new Set(NAV.map((i) => i.href)).size).toBe(NAV.length);
  });

  it('marks external links as external and nothing else', () => {
    for (const item of NAV) {
      const isAbsolute = item.href.startsWith('http');
      expect(item.external === true).toBe(isAbsolute);
    }
  });

  it.each(NAV.filter((i) => i.soon !== true && i.external !== true))(
    'points $label at a route that exists',
    (item) => {
      // In-page anchors resolve to the page they hang off.
      const path = item.href.split('#')[0] ?? '/';
      expect(ROUTES.has(path === '' ? '/' : path)).toBe(true);
    },
  );

  it.each(NAV.filter((i) => i.soon === true))(
    '$label is still genuinely unbuilt, or the soon flag is stale',
    (item) => {
      // This is the one that fails on purpose in a later phase: build `/docs`,
      // and this test tells you to take the flag off so the link goes live.
      expect(ROUTES.has(item.href)).toBe(false);
    },
  );

  it('anchors every in-page nav target to a declared landing section', () => {
    const ids = new Set<string>(LANDING_SECTIONS.map((s) => s.id));
    for (const item of NAV) {
      const [, hash] = item.href.split('#');
      if (hash !== undefined) expect(ids.has(hash)).toBe(true);
    }
  });
});

describe('LANDING_SECTIONS', () => {
  it('has unique ids usable as URL fragments', () => {
    const ids = LANDING_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe('SITE', () => {
  it('carries a repository URL the footer and hero can link to', () => {
    expect(SITE.repository).toMatch(/^https:\/\/github\.com\/.+\/.+$/);
    expect(SITE.repository).not.toMatch(/\/$/);
  });

  it('keeps the description within a sensible meta length', () => {
    // Search results and social cards truncate past roughly this point, and a
    // description that gets cut mid-clause reads worse than a shorter one.
    expect(SITE.description.length).toBeLessThanOrEqual(320);
    expect(SITE.description.length).toBeGreaterThan(60);
  });
});
