'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DOCS_NAV } from '@/content/docs/nav';
import { cn } from '@/lib/cn';

/**
 * The doc tree, shared by the desktop rail and the mobile drawer.
 *
 * A client component because the active-item highlight depends on the current
 * pathname, which is not known at the server-rendering point for a page shared
 * across every doc route. The tree itself (`DOCS_NAV`) is static data, so this
 * costs a tiny client bundle for a large win in feel: the sidebar highlight
 * updates instantly on navigation instead of waiting on a server round trip.
 */
export function DocsSidebar({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className={cn('grid gap-6', className)}>
      {DOCS_NAV.map((group) => (
        <div key={group.title}>
          <p className="mb-2 px-2 font-mono text-eyebrow font-semibold uppercase tracking-wider text-faint">
            {group.title}
          </p>
          <ul className="grid gap-0.5">
            {group.items.map((item) => {
              const href = item.slug === 'quickstart' ? '/docs' : `/docs/${item.slug}`;
              const active = pathname === href;

              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-sm px-2 py-1.5 text-[0.84375rem] transition-colors',
                      active
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-muted hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
