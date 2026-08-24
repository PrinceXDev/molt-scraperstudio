import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { isValidElement } from 'react';
import Link from 'next/link';

import { Constraint, Note, Warning } from '@/components/docs/Callout';
import { ExternalLinkIcon } from '@/components/icons';
import { CopyButton } from '@/components/ui/CopyButton';
import { cn } from '@/lib/cn';

/**
 * The component map every compiled doc renders through.
 *
 * `getDoc` in `lib/mdx.ts` compiles `.mdx` source with no import statements
 * available to it — `evaluate`'s runtime cannot resolve a bare specifier like
 * `@/components/docs/Callout`. This map is how `<Note>`, headings, code blocks
 * and links reach real components instead: it is passed as the `components`
 * prop on the compiled component, and MDX's own runtime looks up any element it
 * does not have a local binding for on that object.
 */

/**
 * Recover the literal source text of a compiled code block.
 *
 * `rehype-pretty-code` returns a tree of styled `<span>` tokens, not the raw
 * string — by the time it reaches this component it is already a nested React
 * element tree. Rather than have a separate rehype plugin thread the original
 * text through as a custom attribute (fragile: later transforms can drop
 * attributes they do not know about), this walks the *rendered* children and
 * concatenates their text, which reconstructs the source exactly because every
 * token span's only child is a string.
 */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

const LANGUAGE_LABEL: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  jsx: 'JSX',
  bash: 'Shell',
  sh: 'Shell',
  json: 'JSON',
  md: 'Markdown',
  mdx: 'MDX',
  yaml: 'YAML',
  yml: 'YAML',
  sql: 'SQL',
  css: 'CSS',
  html: 'HTML',
  text: 'Text',
  plaintext: 'Text',
};

interface FigureProps extends HTMLAttributes<HTMLElement> {
  readonly 'data-rehype-pretty-code-figure'?: string;
  readonly children?: ReactNode;
}

/**
 * `figure` is overridden rather than `pre` directly because rehype-pretty-code
 * wraps every block code element in `<figure data-rehype-pretty-code-figure>`
 * regardless of whether a title is set (see `lib/mdx.ts`'s theme comment for
 * why this pipeline is configured the way it is) — that attribute is the
 * reliable signal that this figure is a code block and not ordinary prose that
 * happens to use `<figure>`.
 */
function Figure({ children, ...props }: FigureProps) {
  if (!('data-rehype-pretty-code-figure' in props)) {
    return <figure {...props}>{children}</figure>;
  }

  const pre = isValidElement<{ 'data-language'?: string; children?: ReactNode }>(children)
    ? children
    : null;
  const language = pre?.props['data-language'] ?? 'text';
  const label = LANGUAGE_LABEL[language] ?? language.toUpperCase();
  const code = textOf(pre?.props.children).replace(/\n$/, '');

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-md border border-line bg-inset">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line-soft bg-surface-2/60 px-3.5 py-1.5">
        <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
          {label}
        </span>
        <CopyButton value={code} className="shrink-0" />
      </figcaption>
      <div className="scrollable-x">{children}</div>
    </figure>
  );
}

function Pre({ children, ...props }: HTMLAttributes<HTMLPreElement>) {
  return (
    <pre className="px-3.5 py-3.5 text-[0.8125rem] leading-relaxed" {...props}>
      {children}
    </pre>
  );
}

/** Ordinary inline code — the vast majority of `code` elements in prose. */
function InlineCode(props: HTMLAttributes<HTMLElement>) {
  return (
    <code
      className="rounded-xs border border-line bg-surface-2 px-[0.3em] py-[0.05em] font-mono text-[0.875em] text-ink"
      {...props}
    />
  );
}

function Heading({ level, id, children }: { level: 2 | 3 | 4; id?: string; children: ReactNode }) {
  const Tag = `h${level}` as const;
  const size =
    level === 2
      ? 'text-[1.375rem] mt-12 mb-4'
      : level === 3
        ? 'text-[1.0625rem] mt-9 mb-3'
        : 'text-[0.9375rem] mt-6 mb-2';

  if (id === undefined) {
    return <Tag className={cn('font-semibold text-ink scroll-mt-24', size)}>{children}</Tag>;
  }

  return (
    <Tag id={id} className={cn('group font-semibold text-ink scroll-mt-24', size)}>
      <a href={`#${id}`} className="no-underline">
        {children}
        <span
          aria-hidden="true"
          className="ml-2 text-faint opacity-0 transition-opacity group-hover:opacity-100"
        >
          #
        </span>
      </a>
    </Tag>
  );
}

function ProseLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href === undefined) return <a {...props}>{children}</a>;

  const isExternal = /^https?:\/\//.test(href);
  const shared =
    'font-medium text-accent underline decoration-accent/35 underline-offset-[3px] transition-colors hover:decoration-accent';

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(shared, 'inline-flex items-center gap-1')}
      >
        {children}
        <ExternalLinkIcon className="text-[0.85em]" />
      </a>
    );
  }

  return (
    <Link href={href} className={shared}>
      {children}
    </Link>
  );
}

function Table(props: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="not-prose scrollable-x my-6 rounded-md border border-line">
      <table className="w-full border-collapse text-[0.8125rem]" {...props} />
    </div>
  );
}

function Th(props: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className="border-b border-line bg-surface-2 px-3.5 py-2 text-left font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-faint"
      {...props}
    />
  );
}

function Td(props: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className="border-b border-line-soft px-3.5 py-2.5 align-top text-ink last:border-b-0"
      {...props}
    />
  );
}

function Blockquote(props: HTMLAttributes<HTMLQuoteElement>) {
  return (
    <blockquote
      className="my-6 border-l-2 border-line-strong pl-4 text-muted italic [&>p]:m-0"
      {...props}
    />
  );
}

export const mdxComponents = {
  h2: (props: HTMLAttributes<HTMLHeadingElement> & { id?: string }) => (
    <Heading level={2} id={props.id}>
      {props.children}
    </Heading>
  ),
  h3: (props: HTMLAttributes<HTMLHeadingElement> & { id?: string }) => (
    <Heading level={3} id={props.id}>
      {props.children}
    </Heading>
  ),
  h4: (props: HTMLAttributes<HTMLHeadingElement> & { id?: string }) => (
    <Heading level={4} id={props.id}>
      {props.children}
    </Heading>
  ),
  p: (props: HTMLAttributes<HTMLParagraphElement>) => (
    <p className="prose-measure my-4 text-[0.9375rem] leading-relaxed text-muted" {...props} />
  ),
  ul: (props: HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="prose-measure my-4 ml-5 grid list-disc gap-1.5 text-[0.9375rem] leading-relaxed text-muted marker:text-faint"
      {...props}
    />
  ),
  ol: (props: HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="prose-measure my-4 ml-5 grid list-decimal gap-1.5 text-[0.9375rem] leading-relaxed text-muted marker:text-faint"
      {...props}
    />
  ),
  li: (props: HTMLAttributes<HTMLLIElement>) => <li className="pl-1 marker:font-mono" {...props} />,
  a: ProseLink,
  strong: (props: HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-ink" {...props} />
  ),
  hr: () => <hr className="my-10 h-px border-0 bg-line-soft" />,
  table: Table,
  th: Th,
  td: Td,
  blockquote: Blockquote,
  figure: Figure,
  pre: Pre,
  code: InlineCode,
  Note,
  Warning,
  Constraint,
};
