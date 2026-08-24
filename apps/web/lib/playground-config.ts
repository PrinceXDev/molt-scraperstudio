import { ensureEnvLoaded } from '@/lib/env';

/**
 * Playground configuration, read on the server.
 *
 * A separate module from `app/(site)/playground/actions.ts` for a hard reason,
 * not a stylistic one: **every export from a `'use server'` file must be an
 * async function.** A synchronous flag check living alongside the actions fails
 * the build outright ("Server Actions must be async functions"), because Next
 * treats each export as a callable client→server endpoint.
 *
 * Neither of the flags below belongs behind an `async` wrapper — both are
 * environment reads — so they live here, where an ordinary server module can
 * export them and both the page and the actions can import them.
 *
 * Both flag functions call `ensureEnvLoaded()` before reading `process.env`.
 * Without it, whether `MOLT_PLAYGROUND_LIVE`/`MOLT_PLAYGROUND_CREATE` actually
 * take effect would depend on whether some *other* code path (`getContext()`,
 * called from the cockpit's rail) had already loaded the root `.env` earlier in
 * that server process's lifetime — a real bug this file shipped with once, found
 * by actually visiting `/playground` as the very first request against a fresh
 * dev server.
 */

/**
 * Whether this deployment permits real, credit-spending collector runs.
 *
 * Compared against the exact string `'1'`, so a stray `MOLT_PLAYGROUND_LIVE=0`
 * or `=false` reads as off rather than as "set, therefore truthy" — the failure
 * mode where a variable meant to disable something enables it.
 */
export function isLiveCheckEnabled(): boolean {
  ensureEnvLoaded();
  return process.env['MOLT_PLAYGROUND_LIVE'] === '1';
}

/**
 * Whether this deployment permits the playground to generate a brand-new
 * collector.
 *
 * A separate flag from `MOLT_PLAYGROUND_LIVE`, and off by default under a
 * separate name on purpose — the two do not share a risk profile. A live check
 * spends about one credit and finishes in under two minutes against a
 * collector that already exists. A create is an AI-Flow job that spends far
 * more, takes five to twenty-five minutes, and — the property that actually
 * matters here — **a failed one leaves an orphaned collector that cannot be
 * deleted programmatically** (`CLAUDE.md`'s verified constraint, paid for once
 * already in this project's own history). Turning this on hands that
 * possibility to anyone who finds the URL, so treat it as a genuine decision
 * about the connected Bright Data account's exposure, not a toggle to flip
 * without thinking.
 *
 * `runCreateCollector` in `actions.ts` layers a hard rate limit and the same
 * preflight `molt add` runs (with no `--force` equivalent — a public page must
 * not be able to bypass a blocker a maintainer would have to explicitly
 * override) on top of this flag; the flag is the outermost gate, not the only
 * one.
 */
export function isCreateEnabled(): boolean {
  ensureEnvLoaded();
  return process.env['MOLT_PLAYGROUND_CREATE'] === '1';
}
