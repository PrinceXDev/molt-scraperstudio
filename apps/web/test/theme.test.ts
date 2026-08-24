import { describe, expect, it } from 'vitest';

import {
  parseThemePreference,
  resolveTheme,
  THEME_CANVAS,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from '../lib/theme.js';

describe('parseThemePreference', () => {
  it('accepts the three real preferences', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('rejects anything else, including the shapes localStorage actually returns', () => {
    // `getItem` returns null for a missing key, and a stale build could have
    // left any string behind. Both must fall through to the default.
    expect(parseThemePreference(null)).toBeNull();
    expect(parseThemePreference('')).toBeNull();
    expect(parseThemePreference('Dark')).toBeNull();
    expect(parseThemePreference('midnight')).toBeNull();
    expect(parseThemePreference(1)).toBeNull();
  });
});

describe('resolveTheme', () => {
  it('honours an explicit preference regardless of the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

/**
 * The pre-paint script is the one piece of the theme system that cannot be
 * exercised by rendering a component, and it is also the piece whose failure is
 * most visible: get it wrong and every visitor sees a flash of the wrong theme.
 *
 * So it is run for real here rather than asserted against as a string. The
 * script reads `localStorage`, `window` and `document` as globals, so wrapping
 * it in a function whose parameters carry those names shadows them with stubs —
 * no jsdom needed, and what runs is the exact source that ships.
 */
function runInitScript(options: {
  stored: string | null;
  systemPrefersDark: boolean;
  storageThrows?: boolean;
}): string | null {
  let attribute: string | null = null;

  const localStorage = {
    getItem(key: string): string | null {
      if (options.storageThrows === true) throw new Error('storage disabled');
      return key === THEME_STORAGE_KEY ? options.stored : null;
    },
  };

  const windowStub = {
    matchMedia: (query: string) => ({
      matches: query.includes('dark') && options.systemPrefersDark,
    }),
  };

  const documentStub = {
    documentElement: {
      setAttribute(name: string, value: string) {
        if (name === 'data-theme') attribute = value;
      },
    },
  };

  // eslint-disable-next-line no-new-func -- deliberate: see the comment above.
  const run = new Function('localStorage', 'window', 'document', THEME_INIT_SCRIPT) as (
    l: unknown,
    w: unknown,
    d: unknown,
  ) => void;

  run(localStorage, windowStub, documentStub);
  return attribute;
}

describe('THEME_INIT_SCRIPT', () => {
  it('applies a stored preference', () => {
    expect(runInitScript({ stored: 'light', systemPrefersDark: true })).toBe('light');
    expect(runInitScript({ stored: 'dark', systemPrefersDark: false })).toBe('dark');
  });

  it('falls back to the OS when nothing is stored', () => {
    expect(runInitScript({ stored: null, systemPrefersDark: true })).toBe('dark');
    expect(runInitScript({ stored: null, systemPrefersDark: false })).toBe('light');
  });

  it('treats a stored "system" as no pin and re-reads the OS', () => {
    // `system` is stored by removing the key, but a value left behind by an
    // older build must not reach `data-theme` — CSS has no `system` block.
    expect(runInitScript({ stored: 'system', systemPrefersDark: false })).toBe('light');
    expect(runInitScript({ stored: 'system', systemPrefersDark: true })).toBe('dark');
  });

  it('still sets a theme when localStorage throws', () => {
    // Safari private mode and some embedded webviews throw on access. If the
    // script died here, `data-theme` would be absent and the light token block
    // would win by default — the exact flash this script exists to prevent.
    expect(runInitScript({ stored: null, systemPrefersDark: false, storageThrows: true })).toBe(
      'dark',
    );
  });

  it('never emits a value CSS cannot match', () => {
    const outcomes = [
      runInitScript({ stored: 'system', systemPrefersDark: true }),
      runInitScript({ stored: 'nonsense', systemPrefersDark: false }),
      runInitScript({ stored: null, systemPrefersDark: true }),
    ];
    for (const outcome of outcomes) {
      expect(Object.keys(THEME_CANVAS)).toContain(outcome);
    }
  });
});
