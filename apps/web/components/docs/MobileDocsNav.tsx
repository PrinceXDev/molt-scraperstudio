'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { DocsSidebar } from '@/components/docs/DocsSidebar';
import { CloseIcon, MenuIcon } from '@/components/icons';

/** The docs sidebar as a slide-over, for viewports too narrow to show it inline. */
export function MobileDocsNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the trigger (close on navigation), not a read.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="docs-mobile-nav"
        className="flex items-center gap-2 rounded-sm border border-line bg-surface-2 px-3 py-2 text-[0.8125rem] text-muted"
      >
        <MenuIcon />
        Contents
      </button>

      {open && (
        <div
          id="docs-mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Documentation contents"
          className="fixed inset-0 z-50 bg-canvas"
        >
          <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
            <span className="font-mono text-eyebrow font-semibold uppercase tracking-wider text-faint">
              Documentation
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="grid size-9 place-items-center rounded-sm border border-line text-muted"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="scrollable-x h-[calc(100dvh-4rem)] overflow-y-auto px-5 py-6">
            <DocsSidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
