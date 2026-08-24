import { describe, expect, it } from 'vitest';

import {
  analyseLinks,
  isPathAllowed,
  parseRobots,
  preflightTarget,
  TARGET_SIZE_LIMIT_BYTES,
} from '../src/preflight.js';

/**
 * The preflight rules, offline.
 *
 * Each of these encodes a lesson that was paid for with a real, undeletable
 * orphan collector or a mis-generated crawler.
 */

describe('parseRobots', () => {
  // The real postgresql.org robots.txt shape that the primary target was
  // validated against.
  const PG_STYLE = `
User-agent: *
Disallow: /admin/
Disallow: /account/
Disallow: /docs/devel/
Disallow: /list/
Disallow: /search/
`;

  it('collects the rules for the wildcard agent', () => {
    const rules = parseRobots(PG_STYLE);
    expect(rules).toHaveLength(5);
    expect(rules.every((r) => !r.allow)).toBe(true);
  });

  it('treats an empty Disallow as everything permitted', () => {
    // Tailscale's robots.txt was exactly this.
    const rules = parseRobots('User-agent: *\nDisallow:');
    expect(rules).toEqual([]);
    expect(isPathAllowed(rules, '/changelog')).toBe(true);
  });

  it('ignores groups for other agents', () => {
    const rules = parseRobots(`
User-agent: GPTBot
Disallow: /

User-agent: *
Disallow: /admin/
`);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.path).toBe('/admin/');
  });

  it('strips comments and blank lines', () => {
    const rules = parseRobots('User-agent: * # everyone\nDisallow: /x/ # private\n\n');
    expect(rules[0]?.path).toBe('/x/');
  });
});

describe('isPathAllowed', () => {
  const rules = parseRobots(`
User-agent: *
Disallow: /admin/
Disallow: /search/
Allow: /search/help
`);

  it('permits paths no rule touches', () => {
    expect(isPathAllowed(rules, '/support/security/')).toBe(true);
  });

  it('refuses a disallowed prefix', () => {
    expect(isPathAllowed(rules, '/admin/users')).toBe(false);
  });

  it('lets the longer Allow win over a shorter Disallow', () => {
    expect(isPathAllowed(rules, '/search/help')).toBe(true);
    expect(isPathAllowed(rules, '/search/anything-else')).toBe(false);
  });

  it('honours wildcards and end anchors', () => {
    const wild = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /message-id/*/raw');
    expect(isPathAllowed(wild, '/paper.pdf')).toBe(false);
    expect(isPathAllowed(wild, '/paper.pdf.html')).toBe(true);
    expect(isPathAllowed(wild, '/message-id/abc/raw')).toBe(false);
  });
});

describe('analyseLinks', () => {
  const URL = 'https://molt-chaos.vercel.app/';

  it('sees a linkless page as zero discovery surface', () => {
    const html = '<main><article class="entry"><h2>Title</h2></article></main>';
    expect(analyseLinks(html, URL)).toEqual({ internalLinks: 0, anchorIds: 0 });
  });

  it('counts relative and same-origin links, but not external ones', () => {
    const html = `
      <a href="/v2.html">switch</a>
      <a href="other.html">sibling</a>
      <a href="https://molt-chaos.vercel.app/v3.html">absolute internal</a>
      <a href="https://example.com/">external</a>
      <a href="mailto:x@example.com">mail</a>
    `;
    expect(analyseLinks(html, URL).internalLinks).toBe(3);
  });

  it('counts id anchors — the generator fragment-addresses them as pages', () => {
    // The chaos-site incident: 60 anchored articles became 60 page loads.
    const html = Array.from(
      { length: 60 },
      (_, i) => `<article id="2026-07-${String(i)}-client">…</article>`,
    ).join('\n');

    expect(analyseLinks(html, URL).anchorIds).toBe(60);
  });
});

describe('preflightTarget', () => {
  function fakeFetch(pages: Record<string, { body: string; status?: number }>): typeof fetch {
    return (async (input: string | URL | Request) => {
      const href = String(input instanceof Request ? input.url : input);
      const page = pages[href];

      if (page === undefined) {
        return new Response('not found', { status: 404 });
      }
      return new Response(page.body, { status: page.status ?? 200 });
    }) as typeof fetch;
  }

  it('clears a small, permitted, linkless page', async () => {
    const report = await preflightTarget('https://site.example/data', {
      fetchImpl: fakeFetch({
        'https://site.example/data': { body: '<table><tr><td>1</td></tr></table>' },
        'https://site.example/robots.txt': { body: 'User-agent: *\nDisallow: /admin/' },
      }),
    });

    expect(report.blockers).toEqual([]);
    expect(report.withinSizeLimit).toBe(true);
    expect(report.robotsAllowed).toBe(true);
    expect(report.robotsFound).toBe(true);
  });

  it('blocks a page over the size ceiling', async () => {
    // The Tailscale lesson: 1.63 MB killed two creates at the first step.
    const report = await preflightTarget('https://site.example/huge', {
      fetchImpl: fakeFetch({
        'https://site.example/huge': { body: 'x'.repeat(TARGET_SIZE_LIMIT_BYTES + 1) },
      }),
    });

    expect(report.withinSizeLimit).toBe(false);
    expect(report.blockers.some((b) => b.includes('ceiling'))).toBe(true);
  });

  it('blocks a robots-disallowed path', async () => {
    const report = await preflightTarget('https://site.example/list/all', {
      fetchImpl: fakeFetch({
        'https://site.example/list/all': { body: '<p>rows</p>' },
        'https://site.example/robots.txt': { body: 'User-agent: *\nDisallow: /list/' },
      }),
    });

    expect(report.robotsAllowed).toBe(false);
    expect(report.blockers.some((b) => b.includes('robots.txt'))).toBe(true);
  });

  it('warns — without blocking — about internal links', async () => {
    const report = await preflightTarget('https://site.example/', {
      fetchImpl: fakeFetch({
        'https://site.example/': { body: '<a href="/v2.html">v2</a>' },
      }),
    });

    expect(report.blockers).toEqual([]);
    expect(report.warnings.some((w) => w.includes('crawler'))).toBe(true);
  });

  it('treats a missing robots.txt as permission', async () => {
    const report = await preflightTarget('https://site.example/', {
      fetchImpl: fakeFetch({ 'https://site.example/': { body: '<p>hi</p>' } }),
    });

    expect(report.robotsFound).toBe(false);
    expect(report.robotsAllowed).toBe(true);
  });

  it('throws on a non-OK target rather than reporting on an error page', async () => {
    await expect(
      preflightTarget('https://site.example/gone', {
        fetchImpl: fakeFetch({ 'https://site.example/gone': { body: 'x', status: 403 } }),
      }),
    ).rejects.toThrow('403');
  });
});
