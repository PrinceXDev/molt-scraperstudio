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

describe('layout v2 — the class rename', () => {
  it('removes the selectors the scraper depends on', () => {
    expect(v2).not.toContain('class="entry-title"');
    expect(v2).not.toContain('class="entry-downloads"');
    expect(v2).not.toContain('class="entry-comments"');
  });

  it('relocates the fields behind new hooks', () => {
    expect(v2).toContain('data-test="title"');
    expect(v2).toContain('class="metric" data-kind="downloads"');
    expect(v2).toContain('class="metric" data-kind="comments"');
  });

  it('keeps the values in the DOM, so the break is genuinely healable', () => {
    // This is the whole point. If v2 deleted the data, no amount of healing
    // could recover it and the demo would be dishonest.
    expect(v2).toContain('1,200');
    expect(v2).toContain(ENTRIES[0]?.title ?? '');
  });

  it('still renders every entry, so row count alone cannot detect the break', () => {
    const count = (v2.match(/class="release-item"/g) ?? []).length;
    expect(count).toBe(60);
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
  it('links to sibling files in a static build', () => {
    expect(renderPage(1, { mode: 'static' })).toContain('href="v2.html"');
  });

  it('links by query string on the dev server', () => {
    expect(renderPage(1, { mode: 'server' })).toContain('href="?v=2"');
  });
});
