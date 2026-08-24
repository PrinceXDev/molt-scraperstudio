'use client';

import { useState } from 'react';

import { CreatePanel } from '@/components/playground/CreatePanel';
import { LiveCheckPanel } from '@/components/playground/LiveCheckPanel';
import { PreflightPanel } from '@/components/playground/PreflightPanel';
import { ReplayPanel } from '@/components/playground/ReplayPanel';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs';

type Mode = 'preflight' | 'replay' | 'live' | 'create';

/**
 * The mode switcher.
 *
 * Client-side state rather than a URL segment or query parameter, deliberately:
 * each panel holds unsaved input (a pasted payload, a typed URL) and routing
 * between them would discard it on every switch. The trade-off is that a
 * specific tab is not linkable — acceptable here, where the tabs are four
 * variations on one tool rather than four destinations.
 *
 * Reuses the `Tabs` primitive from Phase 1, which already owns the WAI-ARIA
 * wiring and arrow-key behaviour.
 */
export function PlaygroundTabs({
  liveEnabled,
  liveCollectorId,
  createEnabled,
}: {
  readonly liveEnabled: boolean;
  /** Null when live check is off, or on but no chaos collector is registered yet. */
  readonly liveCollectorId: string | null;
  readonly createEnabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>('preflight');

  const items: readonly TabItem<Mode>[] = [
    { id: 'preflight', label: 'Preflight a URL' },
    { id: 'replay', label: 'Drift replay' },
    { id: 'live', label: 'Live check' },
    { id: 'create', label: 'Create a collector' },
  ];

  return (
    <div className="grid gap-8">
      <div className="scrollable-x -mx-1 px-1">
        <Tabs items={items} value={mode} onChange={setMode} label="Playground mode" />
      </div>

      <TabPanel id="preflight" active={mode === 'preflight'}>
        <PreflightPanel />
      </TabPanel>
      <TabPanel id="replay" active={mode === 'replay'}>
        <ReplayPanel />
      </TabPanel>
      <TabPanel id="live" active={mode === 'live'}>
        <LiveCheckPanel enabled={liveEnabled} collectorId={liveCollectorId} />
      </TabPanel>
      <TabPanel id="create" active={mode === 'create'}>
        <CreatePanel enabled={createEnabled} />
      </TabPanel>
    </div>
  );
}
