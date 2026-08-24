import type { Metadata } from 'next';

import { PlaygroundTabs } from '@/components/playground/PlaygroundTabs';
import { isCreateEnabled, isLiveCheckEnabled } from '@/lib/playground-config';
import { getRegisteredCollector } from '@/lib/registered-collector';

export const metadata: Metadata = {
  title: 'Playground',
  description:
    'The Bright Data Scraper Studio pipeline, running live: preflight a real URL, replay drift detection, run a live check, or generate a real collector — no account needed for the first two.',
};

/**
 * The playground.
 *
 * Server component so the live-check flag is resolved at request time (it is an
 * environment variable, and a client component could only learn it via a
 * round-trip or by having it inlined into the bundle at build time — the latter
 * would bake a deployment's configuration into a static asset).
 *
 * Not statically rendered for that reason. The preflight and replay tabs would
 * both be happy as static HTML; the live-check flag is what forces this dynamic
 * on its own. When that flag is on, this page also does one database read — to
 * show which collector the live-check tab would actually touch, resolved the
 * same way `runLiveCheck` resolves it (see `lib/registered-collector.ts`) rather
 * than from a copy of the id kept here. That read is skipped entirely while the
 * flag is off, which is the default and by far the common case.
 */
export const dynamic = 'force-dynamic';

export default async function PlaygroundPage() {
  const liveEnabled = isLiveCheckEnabled();
  const chaosCollector = liveEnabled ? await getRegisteredCollector('chaos') : null;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-12 sm:px-6 sm:py-16">
      <header className="max-w-2xl">
        <p className="flex items-center gap-2.5 font-mono text-eyebrow font-semibold uppercase text-faint">
          <span aria-hidden="true" className="h-px w-6 bg-line-strong" />
          Playground · Bright Data Scraper Studio
        </p>
        <h1 className="mt-6 text-display-sm font-semibold sm:text-display-md">
          <span className="block text-muted">The Bright Data pipeline,</span>
          <span className="block text-ink">running right here.</span>
        </h1>
        <p className="prose-measure mt-5 text-[1rem] leading-relaxed text-muted">
          Every tab runs a real piece of the pipeline Bright Data's Scraper Studio actually drives —
          not a simulation of it. Preflight checks a URL exactly the way the intent analyser would
          before spending a <code className="font-mono text-ink">scraper create</code>; Drift replay
          runs the same detection core a live Bright Data run feeds into. Neither needs an account.
          Live check and Create a collector call the real <code className="font-mono text-ink">bdata</code>{' '}
          CLI against a real Bright Data account and spend real credits — and say so plainly before
          they run.
        </p>
      </header>

      <div className="mt-12">
        <PlaygroundTabs
          liveEnabled={liveEnabled}
          liveCollectorId={chaosCollector?.id ?? null}
          createEnabled={isCreateEnabled()}
        />
      </div>
    </div>
  );
}
