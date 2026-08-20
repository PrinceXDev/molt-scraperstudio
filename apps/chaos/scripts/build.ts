import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAYOUT_VERSIONS, parseLayoutVersion, renderPage } from '../src/render.js';

/**
 * Pre-render the chaos site to static HTML.
 *
 * `index.html` is the layout currently live, and it is the only URL the Bright
 * Data collector ever targets. Changing layout means rebuilding and
 * redeploying — which is exactly how a real site redesign reaches production,
 * and the only honest way to simulate one: the same URL starts returning
 * different markup.
 *
 * `v1.html`, `v2.html` and `v3.html` are also emitted so a reviewer can compare
 * the layouts side by side without a redeploy.
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

  await mkdir(outDir, { recursive: true });

  await Promise.all(
    LAYOUT_VERSIONS.map((version) =>
      writeFile(
        join(outDir, `v${version}.html`),
        renderPage(version, { mode: 'static' }),
        'utf8',
      ),
    ),
  );

  await writeFile(join(outDir, 'index.html'), renderPage(live, { mode: 'static' }), 'utf8');

  process.stdout.write(`chaos build complete — index.html is layout v${live}\n`);
  process.stdout.write(`  ${outDir}\n`);
}

await main();
