import { ENTRIES, type Entry } from './data.js';

/**
 * Layout versions of the chaos site.
 *
 * The point of this app is to make a website change on demand, so that healing
 * can be demonstrated on camera instead of waiting for a real site to be
 * redesigned during hackathon week.
 *
 * - `1` — the baseline every scraper is built against.
 * - `2` — two numeric fields move out of their named elements into a generic
 *   `metric-list` keyed by data attribute. The entry container and the title are
 *   untouched, so **the scraper still finds all 60 rows** and only
 *   `download_count` and `comment_count` come back empty. This is the silent
 *   failure: HTTP 200, job done, row count unchanged, data quietly wrong. The
 *   values remain in the DOM, so it is genuinely healable.
 * - `3` — the values stay where they are but go wrong: downloads read zero and
 *   titles are truncated. Passes a null check, fails the truth test.
 */
export const LAYOUT_VERSIONS = [1, 2, 3] as const;

export type LayoutVersion = (typeof LAYOUT_VERSIONS)[number];

export function isLayoutVersion(value: unknown): value is LayoutVersion {
  return LAYOUT_VERSIONS.some((v) => v === Number(value));
}

/** Coerce untrusted query input to a layout version, defaulting to baseline. */
export function parseLayoutVersion(raw: string | null | undefined): LayoutVersion {
  if (raw === null || raw === undefined || raw === '') return 1;
  const n = Number(raw);
  return isLayoutVersion(n) ? n : 1;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** v3 truncates titles to a fragment, which is the distortion signal. */
function titleFor(entry: Entry, version: LayoutVersion): string {
  return version === 3 ? `${entry.title.slice(0, 3)}…` : entry.title;
}

/** v3 zeroes the download counts while leaving the element in place. */
function downloadsFor(entry: Entry, version: LayoutVersion): number {
  return version === 3 ? 0 : entry.downloads;
}

/**
 * The two metrics that move in v2.
 *
 * v1 and v3 keep them in dedicated, semantically-named elements. v2 collapses
 * them into a generic metric list keyed by a data attribute — exactly the kind
 * of refactor a real design system migration produces, and exactly what breaks
 * a selector-based scraper while leaving the page looking identical.
 */
function metricsMarkup(entry: Entry, version: LayoutVersion): string {
  const downloads = downloadsFor(entry, version);

  if (version === 2) {
    return `
        <ul class="metric-list">
          <li><span class="metric" data-kind="downloads">${downloads.toLocaleString('en-US')}</span></li>
          <li><span class="metric" data-kind="comments">${entry.commentCount}</span></li>
        </ul>`;
  }

  return `
        <div class="entry-meta">
          <span class="entry-downloads">${downloads.toLocaleString('en-US')} downloads</span>
          <span class="entry-comments">${entry.commentCount} comments</span>
        </div>`;
}

function entryMarkup(entry: Entry, version: LayoutVersion): string {
  const title = escapeHtml(titleFor(entry, version));

  // The container and the title are deliberately stable across every layout.
  //
  // An earlier v2 renamed them too, and the result was a scraper that could not
  // find a single entry — an empty harvest, which is a real failure but the
  // *easy* one: zero rows is obvious to any monitor. The failure worth
  // demonstrating is the silent one, where the row count is unchanged, the job
  // reports done, and two fields are quietly empty. So v2 moves only the
  // metrics, exactly as a design-system migration would.
  const containerClass = 'entry';
  const titleMarkup = `<h3 class="entry-title">${title}</h3>`;

  const tags = entry.tags
    .map((tag) => `<li class="tag">${escapeHtml(tag)}</li>`)
    .join('\n            ');

  const related =
    entry.relatedLink === null
      ? ''
      : `
        <a class="entry-related" href="${escapeHtml(entry.relatedLink)}">Read the docs</a>`;

  // No `id` on the entry. Scraper Studio's AI treated per-entry anchors as a
  // discovery surface, constructing one "page" per `#fragment` and re-scraping
  // the whole document for each — 60 page loads per run instead of 1, and every
  // record duplicated sixty times. Anchors are navigation as far as the
  // generator is concerned, even when nothing links to them.
  return `
      <article class="${containerClass}">
        <header>
          <time class="entry-date" datetime="${escapeHtml(entry.date)}">${escapeHtml(entry.date)}</time>
          <span class="entry-version">${escapeHtml(entry.version)}</span>
          <span class="entry-category" data-category="${escapeHtml(entry.category)}">${escapeHtml(entry.category)}</span>
        </header>
        ${titleMarkup}
        <p class="entry-body">${escapeHtml(entry.body)}</p>
        <ul class="tag-list">
            ${tags}
        </ul>${metricsMarkup(entry, version)}${related}
      </article>`;
}

const STYLES = `
    :root { color-scheme: light dark; --fg: #16161a; --bg: #fbfbfd; --muted: #6b6b76; --line: #e4e4ea; --accent: #c8352a; }
    @media (prefers-color-scheme: dark) {
      :root { --fg: #e9e9ee; --bg: #0f0f11; --muted: #9a9aa6; --line: #26262c; --accent: #ff6b5e; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 3rem 1.25rem 6rem; background: var(--bg); color: var(--fg);
           font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 46rem; margin: 0 auto; }
    h1 { font-size: 1.75rem; letter-spacing: -0.02em; margin: 0 0 .25rem; }
    .lede { color: var(--muted); margin: 0 0 2.5rem; }
    .entry, .release-item { border-top: 1px solid var(--line); padding: 1.75rem 0; }
    .entry header, .release-item header { display: flex; gap: .75rem; align-items: baseline;
           font-size: .8125rem; color: var(--muted); margin-bottom: .5rem; }
    .entry-version { font-family: ui-monospace, "SFMono-Regular", monospace; }
    .entry-category { text-transform: uppercase; letter-spacing: .06em; font-size: .6875rem; }
    h3 { font-size: 1.0625rem; margin: 0 0 .5rem; }
    .entry-body { margin: 0 0 .875rem; }
    .tag-list, .metric-list { list-style: none; display: flex; gap: .5rem; padding: 0; margin: 0 0 .5rem; flex-wrap: wrap; }
    .tag { font-size: .75rem; border: 1px solid var(--line); border-radius: 999px; padding: .0625rem .5rem; color: var(--muted); }
    .entry-meta, .metric-list { display: flex; gap: 1rem; font-size: .8125rem; color: var(--muted);
           font-family: ui-monospace, "SFMono-Regular", monospace; }
    .entry-related { font-size: .8125rem; color: var(--accent); }
    .banner { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 4px;
           padding: .75rem 1rem; margin-bottom: 2.5rem; font-size: .8125rem; color: var(--muted); }
    .banner strong { color: var(--fg); }
    nav { display: flex; gap: .5rem; margin-top: .75rem; }
    nav a { font-family: ui-monospace, monospace; font-size: .75rem; text-decoration: none;
           border: 1px solid var(--line); border-radius: 4px; padding: .125rem .5rem; color: var(--muted); }
    nav a[aria-current="page"] { border-color: var(--accent); color: var(--accent); }`;

const VERSION_LABELS: Readonly<Record<LayoutVersion, string>> = {
  1: 'baseline markup',
  2: 'two metrics relocated into a generic metric list',
  3: 'values distorted — downloads zeroed, titles truncated',
};

export interface RenderOptions {
  /**
   * `server` renders a version switcher for local comparison. `static` renders
   * none at all.
   *
   * This is not cosmetic. The first deployed build linked to `v1.html`,
   * `v2.html` and `v3.html` so a human could compare layouts — and Scraper
   * Studio's AI treated those links as a discovery surface, generating a crawler
   * that followed them and scraped `v3.html`, the deliberately-distorted layout.
   * The captured baseline was therefore of the wrong page, and flipping
   * `index.html` would never have been noticed.
   *
   * A chaos target must have no outbound navigation whatsoever: exactly one URL,
   * whose markup changes on deploy.
   */
  readonly mode?: 'static' | 'server';
  readonly entries?: readonly Entry[];
}

/**
 * Render the whole page. Pure: same inputs, same bytes out.
 *
 * Deliberately server-rendered with no client JavaScript, so the data is
 * present in the raw HTML and a scraper is exercising markup rather than
 * waiting on hydration.
 */
export function renderPage(version: LayoutVersion, options: RenderOptions = {}): string {
  const { mode = 'server', entries = ENTRIES } = options;

  // Deliberately empty in a static build — see `RenderOptions.mode`.
  const nav =
    mode === 'server'
      ? `<nav>
        ${LAYOUT_VERSIONS.map((v) => {
          const current = v === version ? ' aria-current="page"' : '';
          return `<a href="?v=${v}"${current}>v${v}</a>`;
        }).join('\n        ')}
        </nav>`
      : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chaos Changelog — layout v${version}</title>
    <meta name="description" content="A deliberately breakable changelog used to demonstrate scraper self-healing." />
    <style>${STYLES}
    </style>
  </head>
  <body>
    <main>
      <h1>Chaos Changelog</h1>
      <p class="lede">${entries.length} releases. A fixed dataset behind a switchable layout.</p>

      <div class="banner">
        <strong>Layout v${version}</strong> &mdash; ${VERSION_LABELS[version]}.<br />
        This page exists to break scrapers on purpose. The content never changes; only the markup does.
        ${nav}
      </div>
${entries.map((entry) => entryMarkup(entry, version)).join('\n')}
    </main>
  </body>
</html>
`;
}
