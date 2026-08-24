/**
 * Theme resolution -- the pure half, so it can be unit-tested without a DOM.
 *
 * Three states, not two. `system` is a real preference meaning "follow the OS,
 * and keep following it when it changes"; collapsing it into an initial default
 * loses that, and a visitor whose laptop flips to dark at sunset would be left
 * on light until they intervened.
 *
 * The applied value is always the resolved one -- `light` or `dark` -- written
 * to `data-theme` on `<html>`. CSS never sees `system`.
 */

export const THEME_STORAGE_KEY = 'molt-theme';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What actually lands on the `data-theme` attribute. */
export type ResolvedTheme = 'light' | 'dark';

/** The canvas colour per theme, for `<meta name="theme-color">`. Mirrors `globals.css`. */
export const THEME_CANVAS: Record<ResolvedTheme, string> = {
  light: '#fbfaf9',
  dark: '#0a0a0c',
};

/** Narrow an unknown value (a `localStorage` read) to a preference. */
export function parseThemePreference(value: unknown): ThemePreference | null {
  return THEME_PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : null;
}

/** Collapse a preference plus the OS signal into the value CSS understands. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * The blocking script that sets `data-theme` before first paint.
 *
 * This has to be an inline string injected into `<head>`, not a React effect:
 * an effect runs after hydration, which is after the browser has already
 * painted a frame -- the flash of the wrong theme that the brief calls out
 * explicitly. Keeping it as an exported constant means the exact source that
 * ships is also the source a test can read.
 *
 * It is deliberately defensive. `localStorage` throws outright in Safari's
 * private mode and under some embedded webviews, and a theme script that throws
 * would leave `data-theme` unset -- which renders the light token block. So the
 * fallback is an explicit `dark`, matching what the OS query would most often
 * have said for this audience, rather than an accident.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var t=s==="light"||s==="dark"?s:(d?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch{document.documentElement.setAttribute("data-theme","dark");}})();`;
