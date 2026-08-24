'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { CloseIcon, ExternalLinkIcon, MenuIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { LANDING_SECTIONS, NAV, SITE, type NavItem } from '@/lib/site';

/**
 * Which landing section is currently in view.
 *
 * `IntersectionObserver` over the known section ids, not a scroll handler. It
 * tracks the topmost intersecting section rather than the last one to fire,
 * because entries arrive in DOM order and taking the last would make the nav
 * highlight jump ahead of the reader when two sections overlap the viewport.
 *
 * Runs only on the landing page -- `ids` is empty elsewhere, and the effect
 * exits before allocating an observer.
 */
function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) return;

    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        setActive(ids.find((id) => visible.has(id)) ?? null);
      },
      // The band excludes the sticky header's own height at the top and most of
      // the lower viewport, so a section becomes "active" as it settles into the
      // reading position rather than the moment its first pixel appears.
      { rootMargin: '-88px 0px -55% 0px' },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/** A nav entry. Three shapes: external, not-built-yet, and ordinary. */
function NavLink({
  item,
  active,
  onNavigate,
  className,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  // The underline is a background-image whose width animates. That runs on the
  // compositor, unlike animating a pseudo-element's `width`, and it needs no
  // extra DOM node.
  const shared =
    'relative inline-flex items-center gap-1.5 bg-[linear-gradient(currentColor,currentColor)] ' +
    'bg-no-repeat bg-[position:0_calc(100%-0.125rem)] transition-[background-size,color] duration-200 ' +
    'ease-[cubic-bezier(0.22,1,0.36,1)]';

  if (item.soon === true) {
    return (
      <span
        // Not a link, and says so: `aria-disabled` alone on an anchor still
        // leaves it focusable and clickable in most browsers.
        aria-disabled="true"
        className={cn('inline-flex cursor-default items-center gap-2 text-faint', className)}
        title={`${item.label} — not built yet`}
      >
        {item.label}
        <span className="rounded-full border border-line bg-surface-2 px-1.5 py-px font-mono text-[0.625rem] uppercase tracking-wider text-faint">
          soon
        </span>
      </span>
    );
  }

  if (item.external === true) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noreferrer"
        onClick={onNavigate}
        className={cn(
          shared,
          'bg-[length:0%_1px] text-muted hover:bg-[length:100%_1px] hover:text-ink',
          className,
        )}
      >
        {item.label}
        <ExternalLinkIcon className="text-[0.875em]" />
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'true' : undefined}
      className={cn(
        shared,
        active
          ? 'bg-[length:100%_1px] text-ink'
          : 'bg-[length:0%_1px] text-muted hover:bg-[length:100%_1px] hover:text-ink',
        className,
      )}
    >
      {item.label}
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const onLanding = pathname === '/';
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const activeSection = useActiveSection(onLanding ? LANDING_SECTIONS.map((s) => s.id) : []);

  // A one-pixel sentinel observed instead of a scroll listener: the header needs
  // to know "are we at the very top or not", which is a boolean, and an
  // IntersectionObserver answers it without running code on every scroll frame.
  useEffect(() => {
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;pointer-events:none';
    document.body.append(sentinel);

    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(entry !== undefined && !entry.isIntersecting),
      { threshold: 1 },
    );
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, []);

  // Close the sheet whenever the route changes. The links already close it on
  // click, but that misses the back button and any programmatic navigation —
  // leaving the sheet covering the page the visitor just navigated to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the trigger, not an input. The rule sees an unread dependency; removing it would make this run once on mount and never again, which is the opposite of the intent.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const isActive = (item: NavItem): boolean => {
    if (item.href.startsWith('/#')) return onLanding && `#${activeSection}` === item.href.slice(1);
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  return (
    <>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow-lg"
      >
        Skip to content
      </a>

      <header
        className={cn(
          'sticky top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300',
          // At the top the header is part of the page; once scrolled it becomes
          // a surface with a hairline and a blur. Two states, no in-between.
          scrolled
            ? 'border-b border-line-soft bg-canvas/80 backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-6 px-5 sm:px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-[0.9375rem] font-semibold tracking-tight"
          >
            {/* The ember dot. The only decorative use of the accent anywhere,
             * earned because it is the product's mark. */}
            <span className="size-[7px] rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
            {SITE.name}
          </Link>

          <nav
            className="ml-auto hidden items-center gap-7 text-[0.8125rem] md:flex"
            aria-label="Main"
          >
            {NAV.map((item) => (
              <NavLink key={item.label} item={item} active={isActive(item)} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <ThemeToggle />
            <Link
              href="/fleet"
              className={buttonClasses({
                variant: 'primary',
                size: 'sm',
                className: 'hidden sm:inline-flex',
              })}
            >
              Open the cockpit
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              className="grid size-9 place-items-center rounded-sm border border-line text-muted transition-colors hover:text-ink md:hidden"
            >
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </header>

      {/*
       * The mobile sheet.
       *
       * A full-height panel rather than a dropdown, and it is rendered only when
       * open -- an always-present sheet moved offscreen keeps its links in the
       * tab order, which is the standard way a mobile menu becomes a trap for
       * keyboard users on desktop.
       */}
      {menuOpen && (
        <div
          id="mobile-nav"
          className="fixed inset-0 top-16 z-30 flex flex-col gap-1 border-t border-line-soft bg-canvas px-5 pt-6 md:hidden"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              item={item}
              active={isActive(item)}
              onNavigate={() => setMenuOpen(false)}
              className="py-3 text-[1.0625rem]"
            />
          ))}
          <Link
            href="/fleet"
            onClick={() => setMenuOpen(false)}
            className={buttonClasses({ variant: 'primary', size: 'lg', className: 'mt-4' })}
          >
            Open the cockpit
          </Link>
        </div>
      )}
    </>
  );
}
