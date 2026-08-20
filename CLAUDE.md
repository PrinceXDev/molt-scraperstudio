# Molt — agent working notes

Scraper Reliability Engineering for Bright Data Scraper Studio. Detect silent breakage, diagnose it,
heal it, verify the fix — same Collector ID throughout.

Read [docs/PLAN.md](docs/PLAN.md) for the full design and [docs/DECISIONS.md](docs/DECISIONS.md) for
why things are the way they are.

## Collector IDs — pinned

**Do not create new collectors.** Generation takes 5–25 minutes, is subject to a concurrent-job cap,
and a failed attempt leaves an orphan that cannot be deleted programmatically. Use these.

| Role    | Collector ID           | Target                                         |
| ------- | ---------------------- | ---------------------------------------------- |
| Primary | `c_mt0z2fn11aj6lk4bdz` | `https://www.postgresql.org/support/security/` |
| Chaos   | _pending deploy_       | `apps/chaos` static build, public URL          |

Orphaned half-built collectors awaiting manual deletion in the dashboard:
`c_mt0yykpt1qye2ry05d`, `c_mt0z0aeu8heabltr2`.

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

## Commands

```bash
pnpm install
pnpm test          # offline, no credentials needed
pnpm typecheck
pnpm --filter @molt/chaos build -- --version 2   # flip the chaos layout
```
