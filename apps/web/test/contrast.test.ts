import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Contrast, as a test rather than a one-off audit.
 *
 * Both themes were measured by hand once and three light tokens plus one dark
 * token had to be darkened or lightened to clear AA. That measurement is worth
 * nothing if the next person nudges a hex value for aesthetic reasons and never
 * re-runs it — which is the normal way a design system loses its accessibility.
 *
 * So the ratios are asserted here, read from the real `globals.css`. This is a
 * unit test with no DOM: the WCAG relative-luminance formula is arithmetic, and
 * the token blocks are plain `--name: #hex` declarations.
 *
 * It intentionally does *not* check tokens defined as `rgba(...)` — the `-soft`
 * fills — because their effective contrast depends on what they composite over,
 * which is a question only a rendered page can answer.
 */

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../app/globals.css'),
  'utf8',
);

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pull the hex tokens out of one theme block.
 *
 * The light theme is the `:root` block and dark is `[data-theme="dark"]`. Both
 * are matched up to their closing brace, and only six-digit hex values are
 * collected — aliases (`var(...)`) and rgba fills are skipped by the pattern.
 */
function tokensFor(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  expect(start, `expected ${selector} in globals.css`).toBeGreaterThan(-1);
  const block = CSS.slice(start, CSS.indexOf('}', start));

  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, hex] = match;
    if (name !== undefined && hex !== undefined) tokens[name] = hex.toLowerCase();
  }
  return tokens;
}

const THEMES = {
  light: tokensFor(':root {'),
  dark: tokensFor('[data-theme="dark"] {'),
} as const;

/** AA for body-sized text. Everything below is used at body size somewhere. */
const AA_NORMAL = 4.5;

describe.each(Object.entries(THEMES))('%s theme', (_name, tokens) => {
  it('declares every colour the audit depends on', () => {
    for (const token of [
      'canvas',
      'surface',
      'ink',
      'ink-muted',
      'ink-faint',
      'accent',
      'accent-ink',
      'verified',
      'good',
      'warn',
      'bad',
      'info',
    ]) {
      expect(tokens[token], `missing --${token}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each([
    ['ink', 'canvas'],
    ['ink-muted', 'canvas'],
    // `faint` is checked against the raised surface too: it is the tier that
    // carries timestamps and eyebrow labels inside cards, where the background
    // is lighter (or darker) than the page and the ratio is worse.
    ['ink-faint', 'canvas'],
    ['ink-faint', 'surface'],
    ['accent', 'canvas'],
    ['good', 'surface'],
    ['warn', 'surface'],
    ['bad', 'surface'],
    ['info', 'surface'],
    ['verified', 'surface'],
  ])('%s on %s clears AA for normal text', (foreground, background) => {
    const fg = tokens[foreground];
    const bg = tokens[background];
    expect(fg).toBeDefined();
    expect(bg).toBeDefined();
    expect(contrast(fg as string, bg as string)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('keeps the primary button label legible on the ember', () => {
    // The one pair where both sides are brand colours rather than a text tier.
    // It is also the pair that constrains how dark the accent may go.
    expect(
      contrast(tokens['accent-ink'] as string, tokens['accent'] as string),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('separates the surface steps enough to read as elevation', () => {
    // Not a WCAG rule — a design one. If `surface` and `canvas` are within a
    // hair of each other, cards stop being visible as cards and the layout
    // flattens. A ratio near 1.0 means they are the same colour.
    expect(contrast(tokens['surface'] as string, tokens['canvas'] as string)).toBeGreaterThan(1.02);
  });
});
