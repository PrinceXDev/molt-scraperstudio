import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLayoutVersion, renderPage } from '../src/render.js';

/**
 * Pre-render the chaos site to static HTML.
 *
 * `index.html` is the layout currently live, and it is the only file emitted.
 * Changing layout means rebuilding and redeploying — which is exactly how a real
 * site redesign reaches production, and the only honest way to simulate one: the
 * same URL starts returning different markup.
 *
 * Exactly one page, with no links off it. An earlier build also emitted
 * `v1.html`, `v2.html` and `v3.html` for side-by-side human comparison, and
 * Scraper Studio's AI generated a crawler that followed the switcher links and
 * scraped `v3.html` instead of the index — silently baselining the wrong page.
 * Compare layouts with the local dev server instead (`pnpm --filter @molt/chaos
 * dev`, then `?v=2`).
 *
 * Usage: `pnpm --filter @molt/chaos build -- --version 2`
 */

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'dist');

function readVersionFlag(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--version');
  if (index !== -1) return argv[index + 1];

  const inline = argv.find((arg) => arg.startsWith('--version='));
  return inline?.split('=')[1];
}

async function main(): Promise<void> {
  const requested = readVersionFlag(process.argv.slice(2));
  const live = parseLayoutVersion(requested ?? process.env['CHAOS_VERSION'] ?? '1');

  // Removed rather than merged, so a previously-deployed v1.html/v2.html/v3.html
  // cannot linger in the output and become a crawlable surface again.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await writeFile(join(outDir, 'index.html'), renderPage(live, { mode: 'static' }), 'utf8');

  // Emitted alongside the HTML so the deployed site can never be served from a
  // stale CDN copy. Without this, flipping the layout would redeploy correctly
  // and the collector would keep scraping the old markup from cache — the
  // demo would appear to prove that healing was unnecessary.
  await writeFile(
    join(outDir, 'vercel.json'),
    `${JSON.stringify(
      {
        $schema: 'https://openapi.vercel.sh/vercel.json',
        headers: [
          {
            source: '/(.*)',
            headers: [
              { key: 'cache-control', value: 'no-store, max-age=0, must-revalidate' },
              // Records which layout is live, so a scrape can be audited after
              // the fact without guessing.
              { key: 'x-chaos-layout', value: String(live) },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  process.stdout.write(`chaos build complete — index.html is layout v${live}\n`);
  process.stdout.write(`  ${outDir}\n`);
}

await main();
