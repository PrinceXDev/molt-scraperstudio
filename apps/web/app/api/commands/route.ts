import { NextResponse } from 'next/server';

import { getContext } from '@/lib/context';

/**
 * Feed for the terminal drawer.
 *
 * The one thing that keeps the UI honest: every `bdata` invocation the engine
 * has made, verbatim, polled from the same store the CLI writes to. If a
 * button in this UI ever ran something other than the real CLI, this feed
 * would show it — there is nowhere else for a command to come from.
 */
export async function GET() {
  const { repo } = await getContext();
  const commands = await repo.listRecentCommands(30);
  return NextResponse.json({ commands });
}
