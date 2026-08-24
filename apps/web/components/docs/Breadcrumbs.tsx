import Link from 'next/link';

import { ChevronRightIcon } from '@/components/icons';

export function Breadcrumbs({ group, title }: { group: string; title: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex items-center gap-1.5 text-[0.78125rem] text-faint"
    >
      <Link href="/docs" className="transition-colors hover:text-ink">
        Docs
      </Link>
      <ChevronRightIcon className="shrink-0 text-[0.7em]" />
      <span>{group}</span>
      <ChevronRightIcon className="shrink-0 text-[0.7em]" />
      <span aria-current="page" className="font-medium text-ink">
        {title}
      </span>
    </nav>
  );
}
