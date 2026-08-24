'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { AlertIcon } from '@/components/icons';
import { Button, buttonClasses } from '@/components/ui/Button';

/**
 * The cockpit's error boundary.
 *
 * The realistic failure here is not a React bug — it is the database. The cockpit
 * opens the same libSQL file the CLI writes to, so a missing `data/molt.db`, an
 * unset `MOLT_DATABASE_URL`, or a locked file all surface as a thrown error on
 * first render. Previously that produced Next's stock overlay in development and
 * a blank page in production.
 *
 * The message is shown, not swallowed. Someone running this locally needs to see
 * "unable to open database file" to know what to do about it, and these pages are
 * an operator's tool, not a public surface.
 */
export default function FleetError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-thrown errors reach the client with their message replaced by a
    // digest in production. Logging keeps the real one recoverable from the
    // server output, matched by digest.
    // biome-ignore lint/suspicious/noConsole: an error boundary is exactly where a console record is warranted.
    console.error('[cockpit]', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-20">
      <div className="card grid gap-4">
        <div className="flex items-center gap-2.5 text-bad">
          <AlertIcon />
          <h1 className="text-[0.9375rem] font-semibold">The cockpit could not load its data</h1>
        </div>

        <p className="text-[0.8125rem] leading-relaxed text-muted">
          The most likely cause is the database. The cockpit reads the same libSQL file the CLI
          writes to — <code className="pill">data/molt.db</code> by default, or whatever{' '}
          <code className="pill">MOLT_DATABASE_URL</code> points at. If you have not run the CLI
          yet, there is nothing to open.
        </p>

        <div className="command-line whitespace-pre-wrap">
          <span className="prompt">$</span> pnpm molt init
        </div>

        <p className="font-mono text-[0.71875rem] leading-relaxed text-faint">
          {error.message}
          {error.digest !== undefined && <> · digest {error.digest}</>}
        </p>

        <div className="mt-1 flex flex-wrap gap-3">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Link href="/" className={buttonClasses({ variant: 'secondary' })}>
            Back to the site
          </Link>
        </div>
      </div>
    </div>
  );
}
