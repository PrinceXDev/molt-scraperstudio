'use client';

import { useEffect, useState } from 'react';

interface CommandRow {
  readonly id: number;
  readonly display: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly failed: boolean;
}

/**
 * A live transcript of every `bdata` command Molt has run, pinned to the
 * bottom of every screen.
 *
 * This exists to make good on the claim that the terminal remains the control
 * plane: nothing this UI does is invisible or reimplemented against a
 * different transport. It is a window onto the same command log `molt log`
 * prints, polled rather than pushed because a hackathon deadline does not
 * leave room to stand up a websocket for something this low-frequency.
 */
export function TerminalDrawer() {
  const [open, setOpen] = useState(false);
  const [commands, setCommands] = useState<CommandRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/commands', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { commands: CommandRow[] };
        if (!cancelled) setCommands(data.commands);
      } catch {
        // Best-effort. A dropped poll should not surface as an error banner.
      }
    }

    void poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    // The background is a token, not a literal: this drawer previously hardcoded
    // the dark canvas as an rgba() value, which read as a black bar sitting on
    // the page once a light theme existed.
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/92 backdrop-blur-[10px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-none bg-none px-6 py-2 text-left text-xs text-[var(--fg-muted)] cursor-pointer"
      >
        <span className="mono">$</span>
        {open ? 'Hide' : 'Show'} terminal — {commands.length} command
        {commands.length === 1 ? '' : 's'} run
        {commands.length > 0 && !open && (
          <span className="mono faint ml-2">{commands[0]?.display.slice(0, 70)}</span>
        )}
      </button>

      {open && (
        <div className="max-h-[220px] overflow-y-auto px-6 pb-3">
          {commands.length === 0 ? (
            <div className="faint text-xs">Nothing has run yet.</div>
          ) : (
            <div className="grid gap-1">
              {commands.map((cmd) => (
                <div key={cmd.id} className="mono flex gap-2 text-[11.5px]">
                  <span className="faint shrink-0">{cmd.startedAt.slice(11, 19)}</span>
                  <span
                    className={`shrink-0 ${cmd.failed ? 'text-[var(--bad)]' : 'text-[var(--good)]'}`}
                  >
                    {cmd.failed ? 'fail' : ' ok '}
                  </span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[#d8d8dd]">
                    {cmd.display}
                  </span>
                  <span className="faint ml-auto shrink-0">{cmd.durationMs}ms</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
