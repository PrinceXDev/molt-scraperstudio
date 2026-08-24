import type { ReactNode } from 'react';

import { DocsSearch } from '@/components/docs/DocsSearch';
import { DocsSidebar } from '@/components/docs/DocsSidebar';
import { MobileDocsNav } from '@/components/docs/MobileDocsNav';
import { getSearchIndex } from '@/lib/docs-search';

/**
 * The three-column docs shell: sidebar, prose, table of contents.
 *
 * A server component wrapping client islands, not the other way round — the
 * search index is built from the filesystem (`getSearchIndex`), which only a
 * server component can do, and it is computed once here rather than per page so
 * navigating between docs pages does not re-read every `.mdx` file's headings on
 * every click.
 *
 * The sidebar is `sticky`, not fixed: it scrolls with the page until it reaches
 * the top of the viewport, then holds there, which keeps it visible without
 * requiring its own internal scroll region on ordinarily-sized doc trees.
 */
export default async function DocsLayout({ children }: { children: ReactNode }) {
  const index = await getSearchIndex();

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-6 lg:py-14">
      <div className="mb-8 flex items-center justify-between gap-4 lg:hidden">
        <MobileDocsNav />
        <div className="max-w-[14rem] flex-1">
          <DocsSearch index={index} />
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 grid max-h-[calc(100dvh-7rem)] gap-6 overflow-y-auto pb-10">
            <DocsSearch index={index} />
            <DocsSidebar />
          </div>
        </aside>

        {children}
      </div>
    </div>
  );
}
