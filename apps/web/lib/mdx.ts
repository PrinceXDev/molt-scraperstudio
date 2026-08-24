import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cache } from 'react';
import type { ComponentType } from 'react';

import { evaluate } from '@mdx-js/mdx';
import matter from 'gray-matter';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypePrettyCode from 'rehype-pretty-code';
import * as runtime from 'react/jsx-runtime';

// Resolved from this module's own location rather than `process.cwd()`. Next
// always runs with the app directory as cwd, so `process.cwd()` would work
// there — but the test suite (and any script run from the repo root) does not
// share that assumption, and a path that only works under one runner is a bug
// waiting to be tripped by the other.
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../content/docs');

/**
 * The two Shiki themes code blocks render in.
 *
 * `github-light` / `github-dark-dimmed` rather than a from-scratch theme: code
 * colour is one of the few places a reader's trust depends on convention (a
 * keyword should look like a keyword), and both are legible, widely recognised,
 * and close enough in temperature to this app's own palette not to clash with
 * it. `keepBackground: false` in the options below drops Shiki's own background
 * so the block sits on `--inset` like every other machine-text surface in the
 * app, in both themes.
 */
const SHIKI_THEME = { light: 'github-light', dark: 'github-dark-dimmed' } as const;

export interface DocHeading {
  readonly depth: 2 | 3;
  readonly id: string;
  readonly text: string;
}

export interface DocFrontmatter {
  readonly title: string;
  readonly description?: string;
}

export interface CompiledDoc {
  readonly Component: ComponentType<{ components?: Record<string, unknown> }>;
  readonly frontmatter: DocFrontmatter;
  readonly headings: readonly DocHeading[];
}

/** The minimal hast shape this module walks. Avoids a `@types/hast` dependency for ~10 lines of tree-walking. */
interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly children?: readonly HastNode[];
  readonly value?: string;
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/**
 * A rehype plugin that collects `h2`/`h3` text and ids into `out`.
 *
 * Must run after `rehypeSlug` in the pipeline — it reads the `id` slug already
 * stamped onto each heading rather than recomputing one, so the table of
 * contents can never disagree with the anchor the heading actually rendered.
 * `h1` is excluded deliberately: it is the page title, rendered once outside
 * the compiled body, and a TOC entry for it would just repeat the page's own
 * heading in the same breath as its subsections.
 */
function collectHeadings(out: DocHeading[]) {
  return () => (tree: HastNode) => {
    const walk = (node: HastNode): void => {
      if (node.type === 'element' && (node.tagName === 'h2' || node.tagName === 'h3')) {
        const id = node.properties?.['id'];
        const text = textOf(node);
        if (typeof id === 'string' && id !== '' && text !== '') {
          out.push({ depth: node.tagName === 'h2' ? 2 : 3, id, text });
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

/**
 * Compile one doc from `content/docs/<slug>.mdx`, or `null` if it does not exist.
 *
 * `cache()` (React's request-scoped memoisation, not a cross-request cache)
 * means the page component and `generateMetadata` can both call this for the
 * same slug within one render without compiling MDX twice. Content is static
 * during `next build`, so there is no staleness risk to weigh against that.
 *
 * No import statements are supported inside the `.mdx` source: `evaluate`'s
 * runtime module execution cannot resolve a bare specifier like
 * `@/components/docs/Callout`. Every custom element used in prose — headings,
 * callouts, code — is supplied instead through the `components` prop when the
 * compiled component is rendered (see `components/docs/mdx-components.tsx`),
 * which is the supported pattern for MDX compiled this way.
 */
export const getDoc = cache(async (slug: string): Promise<CompiledDoc | null> => {
  let raw: string;
  try {
    raw = await readFile(join(CONTENT_DIR, `${slug}.mdx`), 'utf8');
  } catch {
    return null;
  }

  const { content, data } = matter(raw);
  if (typeof data['title'] !== 'string') {
    throw new Error(`content/docs/${slug}.mdx is missing a "title" in its frontmatter.`);
  }

  const headings: DocHeading[] = [];

  const { default: Component } = await evaluate(content, {
    ...runtime,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      rehypeSlug,
      collectHeadings(headings),
      [rehypePrettyCode, { theme: SHIKI_THEME, keepBackground: false }],
    ],
  });

  return {
    Component: Component as CompiledDoc['Component'],
    frontmatter: {
      title: data['title'],
      ...(typeof data['description'] === 'string' ? { description: data['description'] } : {}),
    },
    headings,
  };
});
