'use client';

import { useEffect, useState } from 'react';

/**
 * The motion policy.
 *
 * Every animation in the app draws its timing from here or from the matching CSS
 * custom properties in `globals.css` (`--ease-out-quint`, `--ease-in-out-quart`),
 * so "how fast does this app feel" is one decision rather than one per component.
 * The numbers are deliberately short: premium reads as *responsive*, and anything
 * over ~400ms on an interaction starts to feel like latency rather than polish.
 *
 * There is no animation library behind this. `motion` was installed for this
 * phase and then removed unused: every effect the landing page needed — the
 * staggered grid reveal, the scroll reveals, the animated nav underline, the
 * header's blur-on-scroll — is a CSS transition driven by a class change, which
 * runs on the compositor and ships no JavaScript on the animation path. If a
 * later phase needs spring physics, gesture tracking or layout animation, that
 * is the moment to add one back.
 */

/** Milliseconds. Mirrors the durations used in the Tailwind classes. */
export const DURATION = {
  /** Hover, focus, press. Must feel instantaneous. */
  fast: 150,
  /** The default: state changes, toggles, small reveals. */
  base: 240,
  /** Entrances that cover distance, or that a reader is meant to notice. */
  slow: 400,
} as const;

/** Stagger between siblings in a revealed group, in seconds. */
export const STAGGER = 0.04;

/** Cap on total stagger, so a long list never leaves the reader waiting. */
export const MAX_STAGGER = 0.16;

/**
 * Whether the visitor has asked for less motion.
 *
 * `globals.css` already collapses CSS transitions under
 * `prefers-reduced-motion`, but that floor is not sufficient on its own: a
 * 0.01ms transition still schedules frames, and a JS-driven sequence (the hero
 * grid stepping through twelve runs on an interval) would still run to completion
 * invisibly. Components consult this and skip the sequence entirely, rendering
 * the final state directly.
 *
 * Returns `false` on the server and for the first client frame, then corrects
 * itself in an effect. That order matters: components must treat `true` as
 * "render finished" rather than "render hidden", so the un-animated final state
 * is always the safe thing to fall back to.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
