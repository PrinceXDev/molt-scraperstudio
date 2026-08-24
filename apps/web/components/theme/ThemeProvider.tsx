'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

interface ThemeContextValue {
  /** What the visitor chose. `system` means "keep following the OS". */
  readonly preference: ThemePreference;
  /** What is actually on the page right now. */
  readonly resolved: ResolvedTheme;
  readonly setPreference: (next: ThemePreference) => void;
  /** Flip light <-> dark, pinning the result (so it leaves `system`). */
  readonly toggle: () => void;
  /**
   * False until the effect has read `localStorage`. Controls that render
   * differently per theme must not paint a committed state before this is true,
   * or the server HTML and the first client frame disagree.
   */
  readonly ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Theme state for the whole app.
 *
 * The attribute on `<html>` is written by the inline script in `app/layout.tsx`
 * before paint; this provider's job is only to *keep* it in sync afterwards and
 * to expose the current value to controls. It never writes the attribute during
 * render -- that would be a side effect in the render phase, and under React 19
 * Strict Mode double-render it would run twice.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [systemPrefersDark, setSystemPrefersDark] = useState(true);
  const [ready, setReady] = useState(false);

  // Adopt whatever the pre-paint script already decided, so the provider agrees
  // with the DOM instead of fighting it.
  useEffect(() => {
    let stored: ThemePreference | null = null;
    try {
      stored = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      stored = null;
    }

    const query = window.matchMedia(DARK_QUERY);
    setSystemPrefersDark(query.matches);
    if (stored !== null) setPreferenceState(stored);
    setReady(true);

    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, systemPrefersDark);

  // One writer for the attribute, and it runs after commit.
  useEffect(() => {
    if (!ready) return;
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved, ready]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-mode storage refusal. The theme still applies for this
      // session; it just will not survive a reload. Not worth surfacing.
    }
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference, toggle, ready }),
    [preference, resolved, setPreference, toggle, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
