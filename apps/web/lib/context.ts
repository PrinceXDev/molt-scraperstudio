import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { CliScraper, Engine, systemClock } from '@molt/core';
import { openDatabase, Repository, type Database } from '@molt/store';

/**
 * Server-only wiring, mirroring `apps/sentinel/src/context.ts`.
 *
 * The web UI and the CLI read the exact same SQLite file and construct the exact
 * same `Engine`, so an approval clicked here runs the identical `bdata` call
 * `molt approve` would — the UI is a window onto the same control plane, not a
 * parallel one.
 *
 * Cached per server process: Next.js can call this many times per request across
 * server components, and a single libSQL connection is meant to be reused.
 */

let cached: Promise<Context> | null = null;

export interface Context {
  readonly db: Database;
  readonly repo: Repository;
  readonly engine: Engine;
}

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

function loadDotEnv(root: string): void {
  let contents: string;
  try {
    contents = readFileSync(resolve(root, '.env'), 'utf8');
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function resolveDatabaseUrl(root: string): string {
  const configured = process.env['MOLT_DATABASE_URL'] ?? 'file:./data/molt.db';
  if (!configured.startsWith('file:')) return configured;
  const path = configured.slice('file:'.length);
  if (path === ':memory:' || isAbsolute(path)) return configured;
  return `file:${resolve(root, path)}`;
}

async function build(): Promise<Context> {
  const root = findRepoRoot(process.cwd());
  loadDotEnv(root);

  const db = await openDatabase({ url: resolveDatabaseUrl(root) });
  const repo = new Repository(db);
  const scraper = new CliScraper();
  const engine = new Engine({ repo, scraper, clock: systemClock });

  return { db, repo, engine };
}

/** Get the shared server-side context. Safe to call from any server component. */
export function getContext(): Promise<Context> {
  cached ??= build();
  return cached;
}
