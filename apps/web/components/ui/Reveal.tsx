'use client';

import { useEffect, useRef, useState } from 'react';
import type { ElementType, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { usePrefersReducedMotion } from '@/lib/motion';

/**
 * Scroll reveal -- the one implementation.
 *
 * `IntersectionObserver`, deliberately, and not a scroll handler: the browser
 * does the intersection maths off the main thread, whereas a scroll listener
 * runs our code on every scroll event and is the classic way a beautiful page
 * becomes a janky one. It is also why this phase adds no scroll library.
 *
 * Two behaviours worth knowing about:
 *
 * - It disconnects after the first reveal. Content does not re-hide when
 *   scrolled back past, because re-animating text a reader has already read is
 *   an irritation, not delight.
 * - Under `prefers-reduced-motion` it renders the final state immediately and
 *   never observes anything at all. The global CSS rule would have collapsed
 *   the transition anyway, but the observer would still have run; skipping it
 *   entirely is the honest reading of the request.
 *
 * No Framer Motion here on purpose. This is opacity and a few pixels of
 * translate -- a CSS transition on the compositor does it with no JS on the
 * animation path, and keeps `motion` out of the bundle for pages that only need
 * reveals.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className,
}: {
  readonly children: ReactNode;
  readonly as?: ElementType;
  /** Seconds. Use with an index to stagger siblings; keep the total under ~0.4s. */
  readonly delay?: number;
  readonly className?: string;
}) {
  const node = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }

    const element = node.current;
    if (element === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          observer.disconnect();
        }
      },
      // Fires slightly before the element reaches the fold, so the reveal has
      // finished by the time it is comfortably in view rather than animating
      // under the reader's eye.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <Tag
      ref={node}
      style={shown && delay > 0 ? { transitionDelay: `${String(delay)}s` } : undefined}
      className={cn(
        'transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
