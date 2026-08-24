import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliScraper, Engine, systemClock } from '@molt/core';
import { openDatabase, Repository, type CollectorKind, type Database } from '@molt/store';

/**
 * Wiring.
 *
 * The one place that reads the environment and constructs the real
 * implementations. Everything downstream takes its dependencies as arguments, so
 * this file is the only thing a test would have to avoid.
 */

export interface CollectorConfig {
  readonly alias: string;
  readonly id: string;
  readonly targetUrl: string;
  readonly name: string;
  readonly kind: CollectorKind;
  /** Dot path to nested records in this collector's output. */
  readonly recordPath: string | null;
  readonly inherit: readonly string[];
  /** Held-out URL for canary verification, when one is configured. */
  readonly canaryUrl: string | null;
}

export interface Context {
  readonly db: Database;
  readonly repo: Repository;
  readonly engine: Engine;
  readonly collectors: readonly CollectorConfig[];
  close(): void;
}

/**
 * Minimal .env reader.
 *
 * A dependency for this would be hard to justify: the file is a handful of
 * `KEY=value` lines, and real environment variables still win so CI needs no
 * file at all.
 */
function loadDotEnv(cwd: string): void {
  let contents: string;
  try {
    contents = readFileSync(resolve(cwd, '.env'), 'utf8');
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

    // Real environment wins, so CI secrets are never shadowed by a stray file.
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

/**
 * Projection config per collector.
 *
 * Both collectors came back from Scraper Studio's AI with a nested schema — one
 * wrapper row per page holding an array of the records actually on it — so the
 * path to the real records is part of each collector's identity.
 */
const PROJECTIONS: Record<'primary' | 'chaos', { path: string; inherit: string[] }> = {
  primary: { path: 'security_advisories', inherit: ['product_page_url'] },
  chaos: { path: 'changelog_entries', inherit: [] },
};

function readCollectors(): CollectorConfig[] {
  const configs: CollectorConfig[] = [];

  const primaryId = process.env['MOLT_COLLECTOR_PRIMARY'];
  if (primaryId !== undefined && primaryId !== '') {
    configs.push({
      alias: 'primary',
      id: primaryId,
      name: 'molt-pg-advisories',
      targetUrl: 'https://www.postgresql.org/support/security/',
      kind: 'primary',
      recordPath: PROJECTIONS.primary.path,
      inherit: PROJECTIONS.primary.inherit,
      canaryUrl: emptyToNull(process.env['MOLT_CANARY_PRIMARY']),
    });
  }

  const chaosId = process.env['MOLT_COLLECTOR_CHAOS'];
  const chaosUrl = process.env['MOLT_CHAOS_BASE_URL'] ?? 'https://molt-chaos.vercel.app';
  if (chaosId !== undefined && chaosId !== '') {
    configs.push({
      alias: 'chaos',
      id: chaosId,
      name: 'molt-chaos',
      targetUrl: chaosUrl,
      kind: 'chaos',
      recordPath: PROJECTIONS.chaos.path,
      inherit: PROJECTIONS.chaos.inherit,
      canaryUrl: emptyToNull(process.env['MOLT_CANARY_CHAOS']),
    });
  }

  return configs;
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

export interface OpenContextOptions {
  readonly cwd?: string;
  /** Streams CLI output as it happens, for `molt watch`. */
  readonly onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  readonly maxAttempts?: number;
}

/**
 * Walk up to the workspace root.
 *
 * `pnpm --filter` runs a script with the *package* directory as cwd, so a
 * relative database path or `.env` would resolve against `apps/sentinel` and
 * quietly produce a second, empty database. Everything is anchored to the root
 * instead, so `pnpm molt`, `node apps/sentinel/src/main.ts` and a CI runner all
 * read the same state.
 */
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

/** Anchor a relative `file:` database URL to the repository root. */
function resolveDatabaseUrl(root: string): string {
  const configured = process.env['MOLT_DATABASE_URL'] ?? 'file:./data/molt.db';
  if (!configured.startsWith('file:')) return configured;

  const path = configured.slice('file:'.length);
  if (path === ':memory:' || isAbsolute(path)) return configured;

  return `file:${resolve(root, path)}`;
}

export async function openContext(options: OpenContextOptions = {}): Promise<Context> {
  const root = findRepoRoot(options.cwd ?? dirname(fileURLToPath(import.meta.url)));
  loadDotEnv(root);

  const authToken = process.env['MOLT_DATABASE_AUTH_TOKEN'];
  const db = await openDatabase({
    url: resolveDatabaseUrl(root),
    ...(authToken === undefined || authToken === '' ? {} : { authToken }),
  });
  const repo = new Repository(db);

  const scraper = new CliScraper({
    ...(options.onOutput === undefined ? {} : { onOutput: options.onOutput }),
  });

  const engine = new Engine({
    repo,
    scraper,
    clock: systemClock,
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  });

  return {
    db,
    repo,
    engine,
    collectors: readCollectors(),
    close: () => {
      db.close();
    },
  };
}

/** Resolve `primary`, `chaos`, or a literal `c_*` id against the config. */
export function resolveCollector(
  context: Context,
  selector: string | undefined,
): CollectorConfig | null {
  if (selector === undefined || selector === '') {
    return context.collectors[0] ?? null;
  }

  return context.collectors.find((c) => c.alias === selector || c.id === selector) ?? null;
}
