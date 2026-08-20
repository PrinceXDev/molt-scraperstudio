'use server';

import { revalidatePath } from 'next/cache';

import { getContext } from '@/lib/context';

/**
 * Server Actions that decide a proposed fix.
 *
 * These call the exact same `Engine.decide` / `Engine.advanceUntilBlocked` the
 * CLI's `molt approve` / `molt reject` call — which in turn spawn the real
 * `bdata` CLI (see `@molt/core`'s `CliScraper`). Clicking Approve in this UI
 * runs the identical command `molt approve` would; the button is a window onto
 * the terminal, not a second implementation of it.
 */

export interface DecideResult {
  readonly state: string;
  readonly resolved: boolean;
}

export async function approveIncident(incidentId: string): Promise<DecideResult> {
  const { engine } = await getContext();

  await engine.decide(incidentId, 'approve');
  const verified = await engine.advanceUntilBlocked(incidentId);

  revalidatePath(`/i/${incidentId}`);
  revalidatePath(`/i/${incidentId}/review`);
  revalidatePath(`/c/${verified.collectorId}`);
  revalidatePath('/');

  return { state: verified.state, resolved: verified.state === 'resolved' };
}

export async function rejectIncident(incidentId: string): Promise<DecideResult> {
  const { engine } = await getContext();

  const rejected = await engine.decide(incidentId, 'reject');

  revalidatePath(`/i/${incidentId}`);
  revalidatePath(`/i/${incidentId}/review`);
  revalidatePath('/');

  return { state: rejected.state, resolved: false };
}
