# Contributing to Molt

Molt is a hackathon submission (WeMakeDevs × Bright Data), but the codebase is built to survive past
the deadline. If you're picking it up — as a judge running it, or later as a contributor — this is how
it's meant to be worked on.

## Before you start

**Do not create new Bright Data collectors while developing.** Generation (`bdata scraper create`) is
an AI-Flow job that takes 5–25 minutes, is subject to a concurrent-job cap, and a failed attempt leaves
an orphan that cannot be deleted programmatically. The two pinned collectors in [CLAUDE.md](CLAUDE.md)
are live and sufficient for every check, heal, and review flow — use them.

## Setup

```bash
pnpm install
pnpm test        # offline, no API key or database needed
```

To drive real Bright Data infrastructure:

```bash
npx -p @brightdata/cli bdata login
cp .env.example .env   # paste the two collector IDs from CLAUDE.md
pnpm molt init
pnpm molt check primary
```

## Ground rules this repo enforces

- **`packages/health` stays pure.** No imports from `node:*`, no network, no clock, no randomness. If
  a function needs the time, it takes a timestamp as an argument. This is what lets every drift rule
  be pinned by a fixture instead of a live website.
- **All Bright Data I/O lives in `packages/brightdata`, nowhere else.** Every other package receives
  its effects through injected ports (see `packages/core/src/ports.ts`), so the incident lifecycle is
  testable with no API key and no credits spent.
- **Mutations go through the real CLI, never the REST endpoints it wraps.** `packages/brightdata/src/command.ts`
  spawns `node_modules/@brightdata/cli/dist/index.js` directly — never `npx`, never a shell — so a heal
  prompt's quoting can't be reinterpreted and every invocation is reproducible from the lockfile.
- **Credentials are redacted at the boundary**, in `packages/brightdata/src/redact.ts`, before any
  command record is stored — those records get rendered in the UI's terminal drawer.
- **`.env` is gitignored.** Never commit a key, never paste one into a fixture or a test.

## Before opening a PR

```bash
pnpm typecheck
pnpm check        # Biome lint + format
pnpm test
```

All three run in CI (`.github/workflows/ci.yml`) with no secrets and no network — a PR that needs
either to pass its own tests has a bug in it. If you're touching `apps/web`, also run
`pnpm --filter @molt/web build`; CI does not build it separately from typecheck today, so a broken
build there is otherwise invisible until deploy.

## Adding a test

Match the existing shape: `packages/health` and `packages/diagnose` are pure unit tests against
fixtures; `packages/core` drives the incident state machine against a fake `ScraperPort`
(`packages/core/test/engine.test.ts`); `apps/web` tests render from seeded data, never a live database.
If you're fixing a bug that was only visible against real data, say so in the test's own comment —
that history is worth more than the assertion alone.

## Reporting an issue

Open a GitHub issue. If it's a security concern rather than a bug, see [SECURITY.md](SECURITY.md)
instead.
