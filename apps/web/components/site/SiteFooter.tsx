import Link from 'next/link';

import { ExternalLinkIcon } from '@/components/icons';
import { NAV, SITE } from '@/lib/site';

/**
 * The footer.
 *
 * A server component, and short on purpose. There is one product, one repo and
 * one platform credit; inventing four columns of links to fill the width would
 * be exactly the decorative padding the brief rules out.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line-soft">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-5 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-sm flex-col gap-3">
          <div className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight">
            <span className="size-[7px] rounded-full bg-accent" />
            {SITE.name}
          </div>
          <p className="text-[0.8125rem] leading-relaxed text-muted">{SITE.tagline}.</p>
          <p className="text-[0.75rem] text-faint">
            Powered by <strong className="font-semibold text-accent">{SITE.platform}</strong>
          </p>
        </div>

        <nav className="flex flex-col gap-2.5 text-[0.8125rem]" aria-label="Footer">
          {NAV.map((item) =>
            item.soon === true ? (
              <span key={item.label} className="text-faint" aria-disabled="true">
                {item.label} <span className="font-mono text-[0.6875rem] uppercase">· soon</span>
              </span>
            ) : item.external === true ? (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-ink"
              >
                {item.label}
                <ExternalLinkIcon className="text-[0.875em]" />
              </a>
            ) : (
              <Link
                key={item.label}
                href={item.href}
                className="text-muted transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ),
          )}
          <Link href="/fleet" className="text-muted transition-colors hover:text-ink">
            Cockpit
          </Link>
        </nav>
      </div>

      <div className="mx-auto max-w-[1180px] border-t border-line-soft px-5 py-5 sm:px-6">
        <p className="font-mono text-[0.6875rem] text-faint">
          Credit figures shown anywhere in {SITE.name} are estimates. Bright Data publishes no
          per-operation price list.
        </p>
      </div>
    </footer>
  );
}
