import { describe, expect, it } from 'vitest';

import { ENTRIES } from '../src/data.js';
import { escapeHtml, parseLayoutVersion, renderPage } from '../src/render.js';

const v1 = renderPage(1);
const v2 = renderPage(2);
const v3 = renderPage(3);

describe('chaos dataset', () => {
  it('is a fixed size', () => {
    expect(ENTRIES).toHaveLength(60);
  });

  it('is deterministic across imports', () => {
    // No clock, no randomness: two renders must be byte-identical, otherwise
    // Molt could not tell a markup change from a content change.
    expect(renderPage(1)).toBe(v1);
  });

  it('leaves the related link genuinely sparse', () => {
    // A field that is legitimately optional, so Molt gets to prove it does not
    // raise an incident for one.
    const withLink = ENTRIES.filter((e) => e.relatedLink !== null).length;

    expect(withLink).toBe(20);
    expect(withLink).toBeLessThan(ENTRIES.length);
  });

  it('spreads downloads over orders of magnitude', () => {
    const values = ENTRIES.map((e) => e.downloads);

    expect(Math.min(...values)).toBeGreaterThan(0);
    expect(Math.max(...values)).toBeGreaterThan(10_000);
  });
});

describe('parseLayoutVersion', () => {
  it('accepts the three known layouts', () => {
    expect(parseLayoutVersion('1')).toBe(1);
    expect(parseLayoutVersion('2')).toBe(2);
    expect(parseLayoutVersion('3')).toBe(3);
  });

  it('falls back to the baseline for anything else', () => {
    expect(parseLayoutVersion(null)).toBe(1);
    expect(parseLayoutVersion(undefined)).toBe(1);
    expect(parseLayoutVersion('')).toBe(1);
    expect(parseLayoutVersion('9')).toBe(1);
    expect(parseLayoutVersion('nonsense')).toBe(1);
    expect(parseLayoutVersion('<script>')).toBe(1);
  });
});

describe('escapeHtml', () => {
  it('neutralises markup characters', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('layout v1 — the baseline', () => {
  it('renders every entry', () => {
    const count = (v1.match(/class="entry"/g) ?? []).length;
    expect(count).toBe(60);
  });

  it('exposes the semantic selectors a scraper would be built against', () => {
    expect(v1).toContain('class="entry-title"');
    expect(v1).toContain('class="entry-downloads"');
    expect(v1).toContain('class="entry-comments"');
  });

  it('server-renders the data into the raw HTML', () => {
    // No hydration: the values are in the bytes.
    expect(v1).toContain('1,200 downloads');
  });
});

describe('layout v2 — the silent failure', () => {
  it('relocates the two metrics out of their named elements', () => {
    expect(v2).not.toContain('class="entry-downloads"');
    expect(v2).not.toContain('class="entry-comments"');
    expect(v2).toContain('class="metric" data-kind="downloads"');
    expect(v2).toContain('class="metric" data-kind="comments"');
  });

  it('leaves the entry container and the title untouched', () => {
    // Load-bearing. If v2 also renamed these, the scraper would find no entries
    // at all and the result would be an empty harvest — a real failure, but the
    // easy one. Zero rows is obvious to any monitor. The failure worth
    // demonstrating is the one where everything looks fine.
    expect(v2).toContain('class="entry"');
    expect(v2).toContain('class="entry-title"');
  });

  it('still renders every entry, so row count alone cannot detect the break', () => {
    expect((v2.match(/class="entry"/g) ?? []).length).toBe(60);
    expect((v1.match(/class="entry"/g) ?? []).length).toBe(60);
  });

  it('keeps the values in the DOM, so the break is genuinely healable', () => {
    // If v2 deleted the data, no amount of healing could recover it and the
    // demonstration would be dishonest.
    expect(v2).toContain('1,200');
    expect(v2).toContain(ENTRIES[0]?.title ?? '');
  });
});

describe('layout v3 — the distortion', () => {
  it('keeps the baseline selectors intact', () => {
    // Nothing a selector-based check would notice.
    expect(v3).toContain('class="entry-title"');
    expect(v3).toContain('class="entry-downloads"');
  });

  it('zeroes every download count', () => {
    expect(v3).toContain('0 downloads');
    expect(v3).not.toContain('1,200 downloads');
  });

  it('truncates every title to a fragment', () => {
    const full = ENTRIES[0]?.title ?? '';
    expect(v3).not.toContain(full);
    expect(v3).toContain(`${full.slice(0, 3)}…`);
  });
});

describe('version switcher', () => {
  it('is offered on the dev server, for local comparison', () => {
    expect(renderPage(1, { mode: 'server' })).toContain('href="?v=2"');
  });

  it('is absent from a static build', () => {
    // Load-bearing. The first deployed build linked to v1/v2/v3.html so a human
    // could compare them, and Scraper Studio's AI generated a crawler that
    // followed those links and scraped v3.html — the distorted layout — instead
    // of the index. The baseline was of the wrong page, and a layout flip would
    // never have been detected.
    const html = renderPage(1, { mode: 'static' });

    expect(html).not.toContain('<nav>');
    expect(html).not.toContain('v2.html');
    expect(html).not.toContain('href="?v=');
  });

  it('puts no id anchors on entries', () => {
    // Anchors are a discovery surface to the generator even though nothing links
    // to them: it built one "page" per `#fragment` and re-scraped the whole
    // document for each, turning 60 records into 3,600 across 60 page loads.
    const html = renderPage(1, { mode: 'static' });

    expect(html).not.toMatch(/<article[^>]*\sid=/);
  });

  it('leaves a static build with no outbound navigation at all', () => {
    // A chaos target must be exactly one URL. The only links permitted are the
    // per-entry related links, which point off-site and are never followed back
    // into another layout.
    const html = renderPage(1, { mode: 'static' });
    const internalLinks = [...html.matchAll(/href="(?!https?:)([^"]*)"/g)];

    expect(internalLinks).toEqual([]);
  });
});
