/**
 * Target preflight — every lesson from `docs/DECISIONS.md` that was learned by
 * burning a collector, turned into a check that runs *before* `scraper create`.
 *
 * 1. **Size.** The AI-Flow intent analyser fails outright on large documents:
 *    a 1.63 MB page killed two `create` attempts at the first pipeline step
 *    and left two undeletable orphan collectors. Rule adopted: measure first,
 *    stay under ~200 KB.
 * 2. **Robots.** A target whose robots.txt disallows the path is not a target.
 * 3. **Link graph.** The generator decides *what kind of scraper to build*
 *    from the page it is pointed at: internal links become a crawler, and
 *    even bare `id` anchors become addressable pages (observed: 60 page loads
 *    per run and 60× duplicated data). A page with internal navigation
 *    deserves a loud warning before a collector is pinned to it.
 *
 * The network entry point takes an injectable `fetch`, so the analysis rules
 * are testable offline like everything else — only the two-line fetch wrapper
 * needs the real network.
 */

/** Stay under this. The intent analyser has failed on far smaller than 1 MB. */
export const TARGET_SIZE_LIMIT_BYTES = 200 * 1024;

/* ------------------------------------------------------------------ *
 * robots.txt
 * ------------------------------------------------------------------ */

export interface RobotsRule {
  readonly allow: boolean;
  readonly path: string;
}

/** The rules that apply to a given user-agent (default `*`). */
export function parseRobots(robotsTxt: string, userAgent = '*'): RobotsRule[] {
  const rules: RobotsRule[] = [];

  let inMatchingGroup = false;
  let groupHasRules = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      // A new group starts after at least one rule; consecutive user-agent
      // lines extend the same group.
      if (groupHasRules) {
        inMatchingGroup = false;
        groupHasRules = false;
      }
      if (value === '*' || value.toLowerCase() === userAgent.toLowerCase()) {
        inMatchingGroup = true;
      }
      continue;
    }

    if (field === 'allow' || field === 'disallow') {
      groupHasRules = true;
      // An empty Disallow means "everything permitted" and adds no rule.
      if (inMatchingGroup && value !== '') {
        rules.push({ allow: field === 'allow', path: value });
      }
    }
  }

  return rules;
}

/**
 * Whether `path` is permitted by the parsed rules.
 *
 * Longest-match wins, `Allow` beats `Disallow` on a tie — the interpretation
 * every major crawler uses. `*` wildcards inside a rule path are honoured;
 * `$` anchors the end.
 */
export function isPathAllowed(rules: readonly RobotsRule[], path: string): boolean {
  let verdict = true;
  let matchLength = -1;

  for (const rule of rules) {
    if (!ruleMatches(rule.path, path)) continue;

    if (rule.path.length > matchLength || (rule.path.length === matchLength && rule.allow)) {
      matchLength = rule.path.length;
      verdict = rule.allow;
    }
  }

  return verdict;
}

function ruleMatches(rulePath: string, path: string): boolean {
  if (!rulePath.includes('*') && !rulePath.endsWith('$')) {
    return path.startsWith(rulePath);
  }

  const pattern = rulePath
    .split('')
    .map((ch) => {
      if (ch === '*') return '.*';
      return /[a-zA-Z0-9/]/.test(ch) ? ch : `\\${ch}`;
    })
    .join('')
    .replace(/\\\$$/, '$');

  return new RegExp(`^${pattern}`).test(path);
}

/* ------------------------------------------------------------------ *
 * Link graph
 * ------------------------------------------------------------------ */

export interface LinkAnalysis {
  /** `href`s that stay on the target's origin (relative, or same host). */
  readonly internalLinks: number;
  /** Elements carrying an `id` attribute — addressable anchors. */
  readonly anchorIds: number;
}

/**
 * Count the discovery surfaces on a page.
 *
 * Anything the generator could treat as "another page to visit": internal
 * hrefs, and `id` anchors (which it fragment-addresses even when nothing
 * links to them — observed on the chaos site, 60 loads per run).
 */
export function analyseLinks(html: string, pageUrl: string): LinkAnalysis {
  let origin: string | null = null;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = null;
  }

  let internalLinks = 0;

  for (const match of html.matchAll(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/gi)) {
    const href = (match[1] ?? match[2] ?? '').trim();
    if (href === '' || href === '#') continue;
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;

    if (/^https?:\/\//i.test(href)) {
      if (origin !== null && href.startsWith(origin)) internalLinks += 1;
      continue;
    }

    if (href.startsWith('//')) continue; // protocol-relative external
    internalLinks += 1; // relative or fragment: same document tree
  }

  const anchorIds = [...html.matchAll(/<[a-zA-Z][^>]*\sid\s*=\s*["'][^"']+["']/g)].length;

  return { internalLinks, anchorIds };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export interface PreflightReport {
  readonly url: string;
  /** Measured size of the fetched document, in bytes. */
  readonly bytes: number;
  readonly withinSizeLimit: boolean;
  /** Verdict from robots.txt, and whether one was found at all. */
  readonly robotsAllowed: boolean;
  readonly robotsFound: boolean;
  readonly links: LinkAnalysis;
  /** Human-readable reasons not to proceed. Empty means go. */
  readonly blockers: readonly string[];
  /** Worth knowing, not worth refusing over. */
  readonly warnings: readonly string[];
}

export interface PreflightOptions {
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Fetch the target and its robots.txt, and assemble the go/no-go report.
 *
 * Blockers (size, robots) should stop a `create`; warnings (link graph)
 * should be read and consciously overridden. The caller owns that decision —
 * this function only measures.
 */
export async function preflightTarget(
  url: string,
  options: PreflightOptions = {},
): Promise<PreflightReport> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const target = new URL(url);

  const pageResponse = await fetchImpl(target.href, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });

  if (!pageResponse.ok) {
    throw new Error(`target responded ${String(pageResponse.status)} for ${target.href}`);
  }

  const html = await pageResponse.text();
  const bytes = Buffer.byteLength(html, 'utf8');

  let robotsFound = false;
  let robotsAllowed = true;

  try {
    const robotsResponse = await fetchImpl(new URL('/robots.txt', target.origin).href, {
      redirect: 'follow',
    });

    if (robotsResponse.ok) {
      robotsFound = true;
      const rules = parseRobots(await robotsResponse.text());
      robotsAllowed = isPathAllowed(rules, target.pathname);
    }
  } catch {
    // No robots.txt reachable — nothing forbids the path.
  }

  const links = analyseLinks(html, target.href);

  const blockers: string[] = [];
  const warnings: string[] = [];

  const withinSizeLimit = bytes <= TARGET_SIZE_LIMIT_BYTES;
  if (!withinSizeLimit) {
    blockers.push(
      `page is ${formatKb(bytes)}, over the ~${formatKb(TARGET_SIZE_LIMIT_BYTES)} ceiling — ` +
        `the intent analyser has failed on documents this large and a failed create leaves an orphan collector`,
    );
  }

  if (!robotsAllowed) {
    blockers.push(`robots.txt disallows ${target.pathname}`);
  }

  if (links.internalLinks > 0) {
    warnings.push(
      `${String(links.internalLinks)} internal link(s): the generator may build a crawler that follows them instead of a single-page extractor`,
    );
  }

  if (links.anchorIds > 20) {
    warnings.push(
      `${String(links.anchorIds)} id anchors: the generator has been observed fragment-addressing anchors as pages (once: 60 loads per run)`,
    );
  }

  return {
    url: target.href,
    bytes,
    withinSizeLimit,
    robotsAllowed,
    robotsFound,
    links,
    blockers,
    warnings,
  };
}

function formatKb(bytes: number): string {
  return `${String(Math.round(bytes / 1024))} KB`;
}
