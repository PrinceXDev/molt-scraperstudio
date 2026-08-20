import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findCliEntryFrom, formatDisplay, resolveCliEntry } from '../src/command.js';

/**
 * `findCliEntryFrom` is the fallback that fixed a real production bug: once
 * `@molt/brightdata` is bundled by a tool like webpack (the Next.js web UI),
 * `createRequire(import.meta.url)` inside `resolveCliEntry` no longer points at
 * a real path on disk — it resolved to a phantom `apps/node_modules/...` that
 * never existed, and `bdata scraper approve` failed with `MODULE_NOT_FOUND` the
 * first time the web UI's Approve button was clicked for real. The CLI never
 * hit this because `tsx` never bundles.
 *
 * This fallback is a pure filesystem walk anchored on a directory rather than
 * a module URL, so it is unaffected by bundling. These tests build a fake
 * workspace under a temp directory rather than depending on this repository's
 * real node_modules, so they still prove the walk logic once run somewhere
 * `@brightdata/cli` genuinely is not installed.
 */

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'molt-cli-resolve-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('findCliEntryFrom', () => {
  it('finds the CLI entry in the starting directory itself', () => {
    const root = makeTempDir();
    const entry = join(root, 'node_modules', '@brightdata', 'cli', 'dist', 'index.js');
    mkdirSync(join(root, 'node_modules', '@brightdata', 'cli', 'dist'), { recursive: true });
    writeFileSync(entry, '// stub\n');

    expect(findCliEntryFrom(root)).toBe(entry);
  });

  it('walks upward through nested directories to find it', () => {
    // The exact shape of the real bug: resolving from apps/web (nested two
    // levels below the workspace root where node_modules actually lives).
    const root = makeTempDir();
    const entry = join(root, 'node_modules', '@brightdata', 'cli', 'dist', 'index.js');
    mkdirSync(join(root, 'node_modules', '@brightdata', 'cli', 'dist'), { recursive: true });
    writeFileSync(entry, '// stub\n');

    const nested = join(root, 'apps', 'web');
    mkdirSync(nested, { recursive: true });

    expect(findCliEntryFrom(nested)).toBe(entry);
  });

  it('returns null rather than throwing when nothing is found', () => {
    const root = makeTempDir();
    const empty = join(root, 'nowhere', 'near', 'anything');
    mkdirSync(empty, { recursive: true });

    expect(findCliEntryFrom(empty)).toBeNull();
  });

  it('does not match a directory named node_modules with the wrong contents', () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    // No @brightdata/cli inside it.

    expect(findCliEntryFrom(root)).toBeNull();
  });
});

describe('resolveCliEntry — against this repository', () => {
  it('resolves to a file that actually exists', () => {
    // Sanity check against the real, installed dependency: the primary
    // createRequire path should still succeed in an unbundled test run, and the
    // added existsSync guard must not reject a genuinely valid resolution.
    const entry = resolveCliEntry();
    expect(entry).toMatch(/@brightdata[\\/]cli[\\/]dist[\\/]index\.js$/);
  });
});

describe('formatDisplay', () => {
  it('elides a long argument rather than burying the command in prose', () => {
    // A heal prompt runs to several hundred characters.
    const prompt = 'x'.repeat(200);
    const display = formatDisplay(['scraper', 'heal', 'c_abc', prompt]);

    expect(display.length).toBeLessThan(prompt.length);
    expect(display).toContain('…');
  });

  it('quotes an argument containing whitespace', () => {
    expect(formatDisplay(['scraper', 'heal', 'c_abc', 'fix the price field'])).toBe(
      'bdata scraper heal c_abc "fix the price field"',
    );
  });

  it('leaves short, plain arguments unquoted', () => {
    expect(formatDisplay(['scraper', 'run', 'c_abc'])).toBe('bdata scraper run c_abc');
  });
});
