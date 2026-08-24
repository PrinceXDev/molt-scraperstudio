import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/docs/Breadcrumbs';
import { PrevNext } from '@/components/docs/PrevNext';
import { TableOfContents } from '@/components/docs/TableOfContents';
import { mdxComponents } from '@/components/docs/mdx-components';
import { allDocSlugs, DOCS_INDEX_SLUG, findAdjacentDocs, findDocGroup } from '@/content/docs/nav';
import { getDoc } from '@/lib/mdx';

/**
 * The docs catch-all.
 *
 * `/docs` itself renders the quickstart content — there is exactly one URL for
 * it, `/docs`, not two identical pages at `/docs` and `/docs/quickstart`. A
 * direct visit to the latter redirects rather than rendering a duplicate, which
 * is why `DOCS_INDEX_SLUG` is excluded from `generateStaticParams` below and
 * handled as a redirect instead.
 *
 * Everything else is one segment deep (`/docs/<slug>`); a second segment 404s,
 * since nothing in `content/docs` nests.
 */

interface DocParams {
  readonly slug?: string[];
}

function resolveSlug(params: DocParams): string {
  return params.slug?.[0] ?? DOCS_INDEX_SLUG;
}

export function generateStaticParams(): DocParams[] {
  // The bare `/docs` path is `{ slug: [] }` for an optional catch-all — its own
  // entry, not implied by omitting the index slug below. Leaving it out (as an
  // earlier version of this function did) meant `/docs` itself rendered on
  // demand at request time while every other doc page was pre-rendered, an
  // inconsistency with no reason behind it: the content is exactly as static as
  // the rest.
  return [
    { slug: [] },
    ...allDocSlugs()
      .filter((slug) => slug !== DOCS_INDEX_SLUG)
      .map((slug) => ({ slug: [slug] })),
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<DocParams>;
}): Promise<Metadata> {
  const resolved = await params;
  if (resolved.slug !== undefined && resolved.slug.length > 1) return {};

  const slug = resolveSlug(resolved);
  const doc = await getDoc(slug);
  if (doc === null) return {};

  return {
    title: doc.frontmatter.title,
    ...(doc.frontmatter.description !== undefined
      ? { description: doc.frontmatter.description }
      : {}),
  };
}

export default async function DocPage({ params }: { params: Promise<DocParams> }) {
  const resolved = await params;
  if (resolved.slug !== undefined && resolved.slug.length > 1) notFound();

  if (resolved.slug?.[0] === DOCS_INDEX_SLUG) redirect('/docs');

  const slug = resolveSlug(resolved);
  const doc = await getDoc(slug);
  if (doc === null) notFound();

  const group = findDocGroup(slug);
  const { Component } = doc;

  // A single wrapping grid, not a fragment: the docs layout hands this page one
  // `1fr` column, and the article/TOC split has to happen inside that column
  // rather than as two more items competing for it.
  return (
    <div className="grid min-w-0 gap-10 xl:grid-cols-[1fr_14rem]">
      <article className="min-w-0">
        <Breadcrumbs group={group?.title ?? 'Docs'} title={doc.frontmatter.title} />

        <h1 className="text-display-sm font-semibold sm:text-[2rem]">{doc.frontmatter.title}</h1>
        {doc.frontmatter.description !== undefined && (
          <p className="prose-measure mt-3 text-[1rem] leading-relaxed text-muted">
            {doc.frontmatter.description}
          </p>
        )}

        <div className="mt-8">
          <Component components={mdxComponents} />
        </div>

        <PrevNext {...findAdjacentDocs(slug)} />
      </article>

      <aside className="hidden xl:block">
        <div className="sticky top-24">
          <TableOfContents headings={doc.headings} />
        </div>
      </aside>
    </div>
  );
}
