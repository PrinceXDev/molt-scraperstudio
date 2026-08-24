import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `ensureEnvLoaded`.
 *
 * This module exists because of a real bug: `lib/playground-config.ts`'s flag
 * checks used to read `process.env` directly, while the monorepo root's `.env`
 * was only ever loaded as a side effect of `lib/context.ts`'s `getContext()` —
 * which the playground page never calls just to check a flag. Whether
 * `MOLT_PLAYGROUND_LIVE`/`MOLT_PLAYGROUND_CREATE` took effect depended on
 * whether some *other* route had already primed `process.env` earlier in that
 * server process's life. Found by actually loading `/playground` as the first
 * request against a fresh dev server with the flag set only in `.env`.
 *
 * `env.ts`'s own module-level `loaded` flag makes this awkward to test through
 * a shared module instance (the first test to run "wins" the real load), so
 * each test here spins up its own temp directory and re-imports the module
 * fresh via `vi.resetModules()` — exercising the same code path a new server
 * process would take, once, in isolation.
 */

async function freshEnvModule(): Promise<typeof import('../lib/env.js')> {
  vi.resetModules();
  return import('../lib/env.js');
}

describe('ensureEnvLoaded', () => {
  let dir: string;
  const touchedKeys = new Set<string>();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'molt-env-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const key of touchedKeys) delete process.env[key];
    touchedKeys.clear();
    vi.restoreAllMocks();
  });

  /**
   * Point `process.cwd()` at a fake repo root without touching anything else on
   * `process` — it carries native bindings and an EventEmitter that a
   * shallow-cloned replacement would not faithfully reproduce, so only the one
   * method the module under test actually calls is stubbed.
   */
  function withRootAt(root: string): void {
    vi.spyOn(process, 'cwd').mockReturnValue(root);
  }

  it('finds the repo root by walking up to pnpm-workspace.yaml and loads its .env', async () => {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(dir, '.env'), 'MOLT_TEST_ENV_FLAG=from-file\n');
    touchedKeys.add('MOLT_TEST_ENV_FLAG');

    withRootAt(dir);
    const { ensureEnvLoaded } = await freshEnvModule();
    ensureEnvLoaded();

    expect(process.env['MOLT_TEST_ENV_FLAG']).toBe('from-file');
  });

  it('works from a subdirectory, walking upward to find the root', async () => {
    const nested = join(dir, 'apps', 'web');
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(dir, '.env'), 'MOLT_TEST_ENV_FLAG=from-parent\n');
    touchedKeys.add('MOLT_TEST_ENV_FLAG');
    mkdirSync(nested, { recursive: true });

    withRootAt(nested);
    const { ensureEnvLoaded } = await freshEnvModule();
    ensureEnvLoaded();

    expect(process.env['MOLT_TEST_ENV_FLAG']).toBe('from-parent');
  });

  it('never overwrites a value already set in the real environment', async () => {
    process.env['MOLT_TEST_ENV_FLAG'] = 'from-shell';
    touchedKeys.add('MOLT_TEST_ENV_FLAG');
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(dir, '.env'), 'MOLT_TEST_ENV_FLAG=from-file\n');

    withRootAt(dir);
    const { ensureEnvLoaded } = await freshEnvModule();
    ensureEnvLoaded();

    // A real environment variable — set by the shell or the hosting platform —
    // must win over the file. `.env` fills gaps; it does not override
    // configuration that was deliberately set elsewhere.
    expect(process.env['MOLT_TEST_ENV_FLAG']).toBe('from-shell');
  });

  it('loads only once per process, even across many calls', async () => {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(dir, '.env'), 'MOLT_TEST_ENV_FLAG=first-read\n');
    touchedKeys.add('MOLT_TEST_ENV_FLAG');

    withRootAt(dir);
    const { ensureEnvLoaded } = await freshEnvModule();
    ensureEnvLoaded();

    // Rewriting the file after the first load must not matter — this is what
    // "loaded once per process" means, and it is the guarantee that keeps three
    // call sites (context.ts, playground-config.ts's two flag checks) from
    // performing three redundant file reads on a single request.
    writeFileSync(join(dir, '.env'), 'MOLT_TEST_ENV_FLAG=second-read\n');
    ensureEnvLoaded();

    expect(process.env['MOLT_TEST_ENV_FLAG']).toBe('first-read');
  });

  it('does nothing, without throwing, when no .env file exists', async () => {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');

    withRootAt(dir);
    const { ensureEnvLoaded } = await freshEnvModule();
    expect(() => ensureEnvLoaded()).not.toThrow();
  });

  it('ignores blank lines and comments', async () => {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(
      join(dir, '.env'),
      ['# a comment', '', 'MOLT_TEST_ENV_FLAG=value', '# MOLT_TEST_ENV_OTHER=ignored'].join('\n'),
    );
    touchedKeys.add('MOLT_TEST_ENV_FLAG');
    touchedKeys.add('MOLT_TEST_ENV_OTHER');

    withRootAt(dir);
    const { ensureEnvLoaded } = await freshEnvModule();
    ensureEnvLoaded();

    expect(process.env['MOLT_TEST_ENV_FLAG']).toBe('value');
    expect(process.env['MOLT_TEST_ENV_OTHER']).toBeUndefined();
  });
});
