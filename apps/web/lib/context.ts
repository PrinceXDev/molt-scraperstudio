import { isAbsolute, resolve } from 'node:path';

import { CliScraper, Engine, systemClock } from '@molt/core';
import { openDatabase, Repository, type Database } from '@molt/store';

import { ensureEnvLoaded, repoRoot } from '@/lib/env';

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

function resolveDatabaseUrl(root: string): string {
  const configured = process.env['MOLT_DATABASE_URL'] ?? 'file:./data/molt.db';
  if (!configured.startsWith('file:')) return configured;
  const path = configured.slice('file:'.length);
  if (path === ':memory:' || isAbsolute(path)) return configured;
  return `file:${resolve(root, path)}`;
}

async function build(): Promise<Context> {
  ensureEnvLoaded();
  const root = repoRoot();

  const authToken = process.env['MOLT_DATABASE_AUTH_TOKEN'];
  const db = await openDatabase({
    url: resolveDatabaseUrl(root),
    ...(authToken === undefined || authToken === '' ? {} : { authToken }),
  });
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
