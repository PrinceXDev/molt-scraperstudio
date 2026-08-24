# Molt — agent working notes

Scraper Reliability Engineering for Bright Data Scraper Studio. Detect silent breakage, diagnose it,
heal it, verify the fix — same Collector ID throughout.

Read [docs/PLAN.md](docs/PLAN.md) for the full design and [docs/DECISIONS.md](docs/DECISIONS.md) for
why things are the way they are.

## Collector IDs — pinned

**Do not create new collectors while working on this repo.** Generation takes 5–25 minutes, is
subject to a concurrent-job cap, and a failed attempt leaves an orphan that cannot be deleted
programmatically. Use these — both are live.

This is a rule for you, the agent, during development — not a claim that the product itself never
creates collectors. `molt add` (`apps/sentinel`) already does, for a maintainer at the terminal, and
`apps/web`'s `/playground` "Create a collector" tab (`app/(site)/playground/actions.ts`) exposes the
identical pipeline to a public visitor, deliberately gated behind `MOLT_PLAYGROUND_CREATE=1` (off by
default), a one-per-hour rate limit, and the same preflight blockers with no `--force` equivalent. If
you are asked to touch that feature, testing it for real still spends credits and risks an orphan
exactly as described above — don't flip the flag on and click the button as a way to verify it.

| Role    | Collector ID           | Target                                         |
| ------- | ---------------------- | ----------------------------------------------- |
| Primary | `c_mt0z2fn11aj6lk4bdz` | `https://www.postgresql.org/support/security/` |
| Chaos   | `c_mt101cvbc0o34ghzh`  | `https://molt-chaos.vercel.app`                |

Orphaned half-built collectors awaiting manual deletion in the dashboard (unrelated to the two above —
these are dead ends from the rejected Tailscale target, see `docs/DECISIONS.md`):
`c_mt0yykpt1qye2ry05d`, `c_mt0z0aeu8heabltr2`.

`molt add <url> <description>` now exists for onboarding further collectors at runtime (preflights size
+ robots.txt first) — use it instead of `bdata scraper create` directly, and still expect 5–25 minutes
per call.

## The CLI

`@brightdata/cli` is pinned as a devDependency (v0.3.5), so invoke it through the local install rather
than `npx`:

```bash
node node_modules/@brightdata/cli/dist/index.js scraper run <collector_id> <url> --pretty
```

Molt spawns it the same way — `process.execPath` plus the resolved `dist/index.js`, never through a
shell. Node refuses to spawn `.cmd` shims without `shell: true`, and a shell would reinterpret quotes
inside a heal prompt.

### Verified constraints

- `scraper create <url> <description>` — description **max 500 chars**.
- `scraper heal <collector_id> <prompt>` — prompt **max 1000 chars**.
- `create` and `heal` are AI-Flow jobs behind a **429 concurrent-job cap**. Serialise them.
- **Keep target pages under ~200 KB.** The intent analyser fails outright on large documents; a
  1.63 MB page killed two `create` attempts at the first step. Measure `Content-Length` first.
- Bright Data scrapers run in Bright Data's cloud and **cannot reach `localhost`**.

## Repository rules

- `packages/health` is **pure**. No imports from `node:*`, no network, no clock, no randomness. If a
  function needs the time, it takes a timestamp as an argument.
- **All I/O to Bright Data lives in `packages/brightdata`** and nowhere else.
- Credentials are redacted at the boundary in `packages/brightdata/src/redact.ts`, before any command
  record is stored, because those records are rendered in the UI.
- `.env` is gitignored. Never commit a key, never paste one into a fixture.
- Tests must pass offline with no API key: `pnpm test`.

## The web design system (`apps/web`)

Read the header comment in [apps/web/app/globals.css](apps/web/app/globals.css) before changing
anything visual — it carries the full rationale. The short version:

- **Two authored themes**, light and dark, switched by `data-theme` on `<html>`. Tokens are declared
  on `:root` / `[data-theme="dark"]` and mapped into Tailwind by `@theme inline`, so JSX writes
  `bg-surface text-muted border-line`, **not** `bg-[var(--bg-elevated)]`. The old `--bg` / `--fg-muted`
  spellings survive as aliases only until the cockpit screens are rebuilt.
- **Colour has meaning.** `good / warn / bad / info` are health verdicts and are never decorative.
  `accent` (the ember) marks primary action and live state — at most one per view.
- **Contrast is a test**, not a memory: `apps/web/test/contrast.test.ts` asserts every token pair
  clears WCAG AA in both themes, reading the real CSS. If you change a hex value, run `pnpm test`.
- **Theme flash** is prevented by a blocking inline script whose source is `THEME_INIT_SCRIPT` in
  `apps/web/lib/theme.ts`. `<html>` carries `suppressHydrationWarning` for exactly this reason.
- **Cell classification lives in one place**: `cellSeverity` / `cellBgClass` / `cellClasses` in
  `apps/web/lib/heatmap.ts`. Do not re-derive it in a page. A `distorted` field with
  `magnitude === 0` is `bad`, labelled `ZEROED` — see `docs/DECISIONS.md`.
- **Motion** goes through `apps/web/lib/motion.ts` and must respect `prefers-reduced-motion`.
  Scroll work uses `IntersectionObserver` (`components/ui/Reveal.tsx`), never a scroll handler.
- **Wide content scrolls inside itself.** Every `table.datagrid`, code block and payload sits in a
  `scrollable-x` container; the page body must never scroll sideways.
- `globals.css` is excluded from Biome in `biome.json` — its parser rejects Tailwind v4 at-rules
  (`@theme`, `@utility`, `@custom-variant`).

## Commands

```bash
pnpm install
pnpm test          # offline, no credentials needed
pnpm typecheck
pnpm --filter @molt/chaos build -- --version 2   # flip the chaos layout
```

The `molt` CLI (`apps/sentinel`) has grown beyond the original loop commands
(`init`, `check`, `status`, `watch`, `review`, `approve`, `reject`): `add` (onboard a new collector,
preflighted), `credits` (estimated spend, fleet-wide or per collector — see
`packages/brightdata/src/credits.ts` for why it's an estimate, not a bill), `baseline`
(`show`/`set`/`reset` what "healthy" means for a collector), `doctor` (environment preflight — Node
version, CLI resolvable, DB reachable, every registered target still reachable), `unblock` (clear a
stuck heal), and `log`. Run `pnpm molt help` for the full, current list rather than trusting this file
to stay in sync with it.
