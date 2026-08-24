import type { Metadata } from 'next';

import { PlaygroundTabs } from '@/components/playground/PlaygroundTabs';
import { isCreateEnabled, isLiveCheckEnabled } from '@/lib/playground-config';
import { getRegisteredCollector } from '@/lib/registered-collector';

export const metadata: Metadata = {
  title: 'Playground',
  description:
    'Preflight a real URL, replay drift detection, run a live check, or generate a real collector from a URL and a plain-language description — no account needed for the first two.',
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
          Playground
        </p>
        <h1 className="mt-6 text-display-sm font-semibold sm:text-display-md">
          <span className="block text-muted">Run the real thing.</span>
          <span className="block text-ink">No account, no credits.</span>
        </h1>
        <p className="prose-measure mt-5 text-[1rem] leading-relaxed text-muted">
          The first two tabs run genuine Molt code paths in your browser — the same target preflight
          that gates collector generation, and the same drift-detection core that opens incidents.
          Neither needs a Bright Data account. The last two spend real credits against one, and say
          so plainly before they run.
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
