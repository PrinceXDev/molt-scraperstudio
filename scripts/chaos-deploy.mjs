#!/usr/bin/env node
/**
 * Build the chaos site at a given layout and deploy it to Vercel.
 *
 * Flipping the layout is the demo's central mechanic — it is how a website
 * "changes" on cue — so it has to be one command that cannot be got wrong:
 *
 *   node scripts/chaos-deploy.mjs 2
 *
 * Deploys the prebuilt `dist` directory rather than letting Vercel build the
 * workspace. A pnpm monorepo needs real configuration to build remotely, and
 * none of it earns anything here: the output is four static HTML files.
 *
 * Requires `npx vercel login` once, beforehand.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'apps', 'chaos', 'dist');

const VALID_VERSIONS = new Set(['1', '2', '3']);

/** Must match the Vercel project that owns molt-chaos.vercel.app. */
const PROJECT = 'molt-chaos';
const LIVE_URL = 'https://molt-chaos.vercel.app';

/** Run a command, inheriting stdio, and resolve with its exit code. */
function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      // `npx` and `pnpm` are shims on Windows, so a shell is required here.
      // Safe in this script: every argument is either a literal or a version
      // digit validated against an allow-list above. Never pass user text.
      shell: true,
      ...options,
    });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  const [versionArg = '1', ...rest] = process.argv.slice(2);

  if (!VALID_VERSIONS.has(versionArg)) {
    process.stderr.write(
      `Unknown layout "${versionArg}". Expected one of: ${[...VALID_VERSIONS].join(', ')}\n`,
    );
    process.exit(2);
  }

  process.stdout.write(`\n▸ building chaos site at layout v${versionArg}\n`);
  const buildCode = await run('pnpm', [
    '--filter',
    '@molt/chaos',
    'build',
    '--',
    '--version',
    versionArg,
  ]);
  if (buildCode !== 0) process.exit(buildCode);

  if (!existsSync(join(distDir, 'index.html'))) {
    process.stderr.write(`Build produced no index.html in ${distDir}\n`);
    process.exit(1);
  }

  process.stdout.write(`\n▸ deploying ${distDir} to Vercel production\n`);

  // `--name` is not optional here. Deploying a bare directory makes Vercel infer
  // the project from the directory's name, so `apps/chaos/dist` silently created
  // a project called "dist" with its own alias, while molt-chaos.vercel.app went
  // on serving the previous deployment. The layout flip appeared to do nothing.
  const deployCode = await run('npx', [
    'vercel',
    'deploy',
    distDir,
    '--prod',
    '--yes',
    '--name',
    PROJECT,
    ...rest,
  ]);
  if (deployCode !== 0) process.exit(deployCode);

  await verify(versionArg);

  process.stdout.write(
    `\n✓ layout v${versionArg} is live at ${LIVE_URL}\n` +
      `  The collector URL is unchanged — that is the point.\n` +
      `  Now run: pnpm molt check\n\n`,
  );
}

/**
 * Prove the alias actually moved.
 *
 * Without this the script once reported success while molt-chaos.vercel.app went
 * on serving the previous deployment — the most dangerous possible failure,
 * because a demo would then show Molt correctly reporting "no change" and look
 * like healing was never needed.
 */
async function verify(expectedVersion) {
  process.stdout.write(`\n▸ verifying ${LIVE_URL}\n`);

  // Vercel needs a moment to repoint the alias after the deployment goes ready.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(LIVE_URL, { cache: 'no-store' });
    const html = await response.text();

    const served = response.headers.get('x-chaos-layout');
    const internalLinks = [...html.matchAll(/href="(?!https?:)([^"]*)"/g)].map((m) => m[1]);

    const layoutOk = served === expectedVersion;
    const linksOk = internalLinks.length === 0;

    if (layoutOk && linksOk) {
      process.stdout.write(`  layout v${served}, no outbound navigation — ok\n`);
      return;
    }

    if (!layoutOk) {
      process.stdout.write(
        `  attempt ${attempt}: alias serves v${served ?? '?'}, want v${expectedVersion}\n`,
      );
    }
    if (!linksOk) {
      process.stderr.write(
        `\n✗ live page exposes internal links: ${internalLinks.join(', ')}\n` +
          `  A chaos target must be exactly one URL. Scraper Studio's AI will\n` +
          `  follow these and baseline the wrong page.\n\n`,
      );
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, 4000));
  }

  process.stderr.write(
    `\n✗ ${LIVE_URL} never reported layout v${expectedVersion}.\n` +
      `  The alias is probably still pinned to an older deployment. Check:\n` +
      `    npx vercel inspect ${LIVE_URL}\n\n`,
  );
  process.exit(1);
}

await main();
