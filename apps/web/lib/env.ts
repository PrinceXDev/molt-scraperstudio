import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Loads the monorepo root's `.env` into `process.env`, once per server process.
 *
 * Next.js's own built-in env loading only looks inside `apps/web` (wherever
 * `next dev`/`next build` actually runs), but this repo's single `.env` lives at
 * the workspace root, next to `pnpm-workspace.yaml` — the same file the CLI
 * reads. `lib/context.ts` used to load it inline, as a side effect of
 * `getContext()`. That was a real bug, not just a wart: any code that reads an
 * env-gated flag *without* first calling `getContext()` — which is exactly what
 * `lib/playground-config.ts` does, since checking a feature flag has no reason
 * to open a database connection — ran before the root `.env` had ever been read.
 * Whether the flag worked then depended on which route happened to hit
 * `getContext()` first in that server process, which is not a thing a person
 * setting an env var should ever have to reason about.
 *
 * `ensureEnvLoaded` is the fix: pulled out so any module can trigger the same
 * load explicitly, memoised so doing it from three different call sites costs
 * one file read total, not three.
 */

let loaded = false;

function findRepoRoot(from: string): string {
  let current = from;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return from;
}

function parseAndApply(contents: string): void {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // A real environment variable (set by the shell, the hosting platform, or
    // an earlier call) always wins over the file — `.env` fills gaps, it does
    // not override configuration that was deliberately set elsewhere.
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

/**
 * The repo root, resolved from wherever the current process's cwd is. Exported
 * because `lib/context.ts` needs the same root to locate the SQLite file
 * relative to it, not just to find `.env`.
 */
export function repoRoot(): string {
  return findRepoRoot(process.cwd());
}

/**
 * Ensure the root `.env` has been read into `process.env`. Safe to call many
 * times and from many modules — only the first call in a process does any I/O.
 */
export function ensureEnvLoaded(): void {
  if (loaded) return;
  loaded = true;

  let contents: string;
  try {
    contents = readFileSync(resolve(repoRoot(), '.env'), 'utf8');
  } catch {
    return;
  }
  parseAndApply(contents);
}
