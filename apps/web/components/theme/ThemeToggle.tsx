'use client';

import { useTheme } from '@/components/theme/ThemeProvider';
import { MonitorIcon, MoonIcon, SunIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme';

const LABEL: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const ICON: Record<ThemePreference, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

/**
 * The theme control.
 *
 * A three-way segmented control rather than the more common single toggle
 * button, because `system` is a state a visitor can be in and a two-state
 * button cannot show it: once tapped, a toggle silently pins the theme forever
 * with no way back to "follow my OS". Three explicit segments cost one extra
 * icon of width and remove that trap.
 *
 * Exposed as a group of toggle buttons (`aria-pressed`) rather than a radio
 * group. Semantically these are radios, but `role="radio"` on a `<button>`
 * promises arrow-key navigation and a single tab stop that this control does not
 * implement; real `<input type="radio">` elements would mean fighting the
 * platform's rendering for three icon buttons. Pressed toggle buttons describe
 * what is actually here and are read correctly.
 *
 * Until `ready` is true (the provider has not yet read storage) no segment is
 * marked pressed. Painting a selection before then would mean the server HTML
 * and the first client frame disagree on which segment is active.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference, ready } = useTheme();

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5',
        className,
      )}
    >
      {/* No wrapper role. Each button already carries its own accessible name
       * ("Light theme", "Dark theme", "System theme"), which is the whole of
       * what a group label would have added here. */}
      {THEME_PREFERENCES.map((option) => {
        const Glyph = ICON[option];
        const selected = ready && preference === option;

        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            aria-label={`${LABEL[option]} theme`}
            title={`${LABEL[option]} theme`}
            onClick={() => setPreference(option)}
            className={cn(
              'grid size-7 place-items-center rounded-full text-[0.8125rem] transition-colors duration-150',
              selected
                ? 'bg-surface text-ink shadow-sm'
                : 'text-faint hover:bg-surface-3 hover:text-ink',
            )}
          >
            <Glyph />
          </button>
        );
      })}
    </div>
  );
}
