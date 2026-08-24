'use client';

import { useEffect, useState } from 'react';

/**
 * The single motion policy.
 *
 * Every animation in the app -- CSS or JS -- draws its timing from here, so
 * "how fast does this app feel" is one file, not a decision re-made per
 * component. The numbers are deliberately short: premium reads as *responsive*,
 * and anything over ~400ms on an interaction starts to feel like latency rather
 * than polish.
 *
 * The easings match the CSS custom properties declared in `globals.css`
 * (`--ease-out-quint`, `--ease-in-out-quart`) so a CSS transition and a JS
 * animation on the same element cannot disagree.
 */

/** Cubic-beziers, as Framer Motion tuples. Mirrors the CSS easings. */
export const EASE = {
  /** Decelerating. The default for anything entering or responding to input. */
  out: [0.22, 1, 0.36, 1],
  /** Symmetric. For things that move from one place to another. */
  inOut: [0.76, 0, 0.24, 1],
} as const;

/** Seconds, because that is Framer Motion's unit. */
export const DURATION = {
  /** Hover, focus, press. Must feel instantaneous. */
  fast: 0.15,
  /** The default: state changes, toggles, small reveals. */
  base: 0.24,
  /** Entrances that cover distance, or that a reader is meant to notice. */
  slow: 0.4,
  /** Reserved for the hero sequence. Nothing interactive may use this. */
  deliberate: 0.7,
} as const;

/** Stagger between siblings in a revealed group. */
export const STAGGER = 0.06;

/**
 * Whether the visitor has asked for less motion.
 *
 * `globals.css` already collapses CSS transitions under
 * `prefers-reduced-motion`, but that floor is not sufficient on its own: a
 * 0.01ms transition still schedules frames, and a JS sequence (the hero
 * heatmap, staggered reveals) would still run to completion invisibly. Client
 * components consult this and skip the animation entirely, rendering the final
 * state directly.
 *
 * Returns `false` on the server and for the first client frame, then corrects
 * itself in an effect. That order matters: the un-animated final state is the
 * safe thing to show while we do not yet know, so components must treat `true`
 * as "render finished" rather than "render hidden".
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

/**
 * Shared variants for scroll-revealed content.
 *
 * Small travel on purpose. A 40px slide-up reads as a page assembling itself;
 * 8px reads as the content settling, which is what we want on a docs-adjacent
 * product where the reader came to read, not to watch.
 */
export const revealVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
} as const;
