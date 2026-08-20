# Molt — Build Plan

> Scraper Reliability Engineering for Bright Data Scraper Studio.
> Detect silent breakage, diagnose it, heal it, verify the fix. Same Collector ID throughout.

**Hackathon:** Into the Scrape-Verse (WeMakeDevs × Bright Data), 17–23 Aug 2026
**Tracks targeted:** Web-Slinger (grand), Suit-Up (best UI), Spider-Sense (clean code)
**Plan written:** 20 Aug 2026 · **Ship deadline:** 23 Aug 2026

---

## 1. The problem

Scrapers do not fail loudly. They lie.

A site renames a CSS class. The request still returns **HTTP 200**. Bright Data still reports the job
`status: "done"`. The row count is unchanged. And `price` is `null` on all 1,198 rows.

Every monitoring tool in existence watches the wrong layer. Uptime checks pass. Error rates are zero.
The pipeline keeps running, the dashboard keeps rendering, and the numbers are quietly wrong for three
weeks until someone notices a report looks strange.

**Molt watches the data, not the transport.** It is the difference between "did the request succeed"
and "is the data still true".

## 2. The product

Molt treats scraper breakage the way SRE treats a service outage: detection, diagnosis, remediation,
an approval gate, verification, and a post-incident record.

Bright Data is not a data source in this architecture. It is the substrate. Molt's core value —
repairing a scraper from a plain-language description of what broke, without changing the Collector ID
that downstream systems depend on — **exists only because Scraper Studio has `heal`**. Remove Bright
Data and there is no product left, which is the actual test for "core, not bolted on".

### The insight we are trading on

The brief says _"the terminal is the UI"_ and _"if your project needs three dashboard tabs open,
something has gone wrong"_ — then offers an iPad for Best UI. Most teams will resolve that by building
a dashboard that duplicates the CLI, and lose Web-Slinger for it.

Molt resolves it deliberately:

- **The terminal remains the control plane.** Every mutation is a real `bdata` invocation. Molt is an
  agent that operates the CLI; it never reimplements it against REST.
- **The UI shows only what a terminal cannot.** A terminal cannot render a 12-field × 20-row
  before/after data diff with fill-rate deltas. That is the UI's entire licence to exist.
- **Every command is on screen, verbatim.** A global terminal drawer streams the exact argv and stdout
  of every `bdata` call. The UI is a _window onto_ the terminal, not a replacement for it.

## 3. The loop

| #   | Stage        | What happens                                                                                                                                                                       | Bright Data surface                                                                                        |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | **Detect**   | Scheduled run → snapshot → compare to baseline. Signals: field fill-rate collapse, schema drift, value-distribution drift, empty harvest, error rows.                              | `bdata scraper run --json`, `GET /dca/collectors_list`, `GET /dca/collector/jobs`, `GET /dca/log/{job_id}` |
| 2   | **Diagnose** | Drift evidence → a heal prompt ≤1000 chars naming the dead fields, their before/after fill rates, and the fields that are _unaffected_ (so the healer can localise).               | —                                                                                                          |
| 3   | **Heal**     | Run the real CLI. Capture the `awaiting_approval` envelope and its `preview_result`.                                                                                               | `bdata scraper heal <c_*> "<prompt>" --url <url>`                                                          |
| 4   | **Review**   | Last-good rows vs `preview_result`, field by field, fill rates recomputed on the preview. Green = recovered, red = still broken.                                                   | —                                                                                                          |
| 5   | **Approve**  | Human (or CI policy) commits or rejects the fix.                                                                                                                                   | `bdata scraper approve <c_*>` / `--reject`                                                                 |
| 6   | **Verify**   | Re-run, re-snapshot, re-compare. The incident closes **only** when fill rates actually recover. Not recovered → re-diagnose with the new evidence, bounded retries, then escalate. | `bdata scraper run`                                                                                        |
| 7   | **Record**   | Immutable incident timeline: prompt, diff, commands, credits, timestamps — and the same `c_*` stamped across all seven stages.                                                     | `GET /dca/log/{job_id}`                                                                                    |

Stage 6 is what the brief calls _"bonus points for automating the whole loop"_. Stage 4 is what wins
Best UI.

## 4. Architecture

```
molt/
├─ packages/
│  ├─ health/        @molt/health      PURE. Rows in, HealthReport out. No I/O at all.
│  ├─ brightdata/    @molt/brightdata  The ONLY I/O boundary to Bright Data.
│  ├─ diagnose/      @molt/diagnose    HealthReport → heal prompt (≤1000 chars).
│  ├─ store/         @molt/store       SQLite + Drizzle. Snapshots, incidents, events.
│  └─ core/          @molt/core        The incident state machine. Pure transitions.
├─ apps/
│  ├─ web/           Next.js 15 — the cockpit (5 screens).
│  ├─ sentinel/      The `molt` CLI + cron worker.
│  └─ chaos/         Our own deliberately-breakable target site.
├─ docs/             PLAN.md · ARCHITECTURE.md · DEMO.md · DECISIONS.md
├─ .github/workflows/  ci.yml · molt-watch.yml
├─ CLAUDE.md         Pinned Collector IDs (getting-started step 5).
└─ README.md
```

### Dependency rule

```
health ← diagnose ← core → store
                     ↓
                brightdata
                     ↓
              (CLI · REST)
```

`health` depends on nothing. `diagnose` depends only on `health`. `core` is a pure state machine that
receives its effects as injected ports. **All network and process I/O lives in `brightdata` and
nowhere else.** That is what makes the rest of the system testable from fixtures with no API key.

### `@molt/brightdata` — the I/O boundary

Two transports behind one interface:

- **`CliTransport`** — spawns `npx -p @brightdata/cli bdata … --json`, parses the envelope with Zod.
  Used for **all mutations** (`create`, `run`, `heal`, `approve`). Records a `CommandRecord`
  (`argv`, `exitCode`, `stdout`, timings) for every call, which is what the UI's terminal drawer
  renders.
- **`RestTransport`** — `fetch` against `api.brightdata.com` with `Authorization: Bearer`. Used for
  **read-only telemetry** the CLI does not expose: `collectors_list` (for `output_schema`),
  `collector/jobs`, `log/{job_id}`.

**Verified CLI contract** (from `bdata scraper <cmd> --help`, not from docs):

| Command                        | Constraint that shapes the design                                     |
| ------------------------------ | --------------------------------------------------------------------- |
| `create <url> <description>`   | description **max 500 chars**; returns `{collector_id, name, status}` |
| `run <collector_id> [url]`     | `--urls`, `--input-file`, `--sync`, `--version dev`, `--json`         |
| `heal <collector_id> <prompt>` | prompt **max 1000 chars**; `--auto-approve`, `--auto-save`, `--url`   |
| `approve <collector_id>`       | `--reject`, `--auto-save`                                             |

**Critical constraint discovered:** `create` and `heal` are AI-Flow jobs subject to a **429
concurrent-job cap** (the CLI retries with exponential backoff, default 4 retries). Therefore
**`@molt/brightdata` serialises all AI-Flow operations through a single-slot queue.** Runs may go
concurrent; heals may not. Getting this wrong would produce mystifying 429s mid-demo.

### `@molt/diagnose` — evidence becomes a prompt

Two paths, and the deterministic one is the default so the system never depends on a second vendor:

1. **Template path (always available, pure, unit-tested).** Renders the evidence into a prompt.
2. **LLM path (optional).** Claude sharpens the phrasing; falls back to the template on any error.

Both are hard-capped at 1000 characters with graceful truncation that preserves field names.

Example output for the signature breakage:

```
Fields `points` and `comment_count` return null on every row as of 2026-08-20.
Baseline 2026-08-17: points 98.2% non-null across 1204 rows, comment_count 97.9%.
Current run: both 0.0% across 1198 rows. Fields `title` and `url` are unaffected
and still extract at 100%. The markup carrying these two values appears to have
moved. Re-capture points and comment_count from the current markup.
```

370 characters, and it names what broke, what did _not_ break, and the magnitude — which is what makes
a heal land on the first attempt instead of the third.

### `@molt/store` — schema

SQLite via Drizzle + libSQL, file-backed. **Deliberate choice: a judge clones the repo and runs
`pnpm install && pnpm dev` with no database to provision.** Reproducibility is a judging criterion.

| Table        | Purpose                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `collectors` | `c_*` id, name, target URL, kind (`primary` \| `chaos`), input schema                  |
| `runs`       | job id, timings, row count, status, raw rows (JSON), the `CommandRecord`               |
| `snapshots`  | per-run field stats, declared fields, error rows, `is_baseline`                        |
| `incidents`  | state, the `HealthReport`, heal prompt, heal envelope, `preview_result`, attempt count |
| `events`     | append-only incident timeline — the audit trail                                        |
| `commands`   | every `bdata` invocation, verbatim, linked to its incident                             |

### Incident state machine

```
          ┌──────────────────── verify fails ──────────────────┐
          ↓                                                     │
detected → diagnosing → healing → awaiting_approval → approved → verifying → resolved
                │            │              │                                    │
                │            │              └── rejected ──→ re-diagnose ─┐       │
                │            └── heal_failed ──→ retry (max 2) ───────────┤       │
                └────────────────────────────────────────── escalated ←───┘       │
                                                                                  │
                                                            (healthy) ────────────┘
```

Modelled as a discriminated union with exhaustive `switch` handling and no `default` branch, so adding
a state is a compile error everywhere it must be handled. Retries are bounded at 2 — an unbounded heal
loop is a credit incinerator.

## 5. The UI — five screens

Each screen exists because a terminal cannot do its job.

1. **Fleet** (`/`) — one card per collector: health score ring, status, per-field fill-rate sparklines,
   last run, credits consumed. A persistent Bright Data rail shows live credit balance and every
   active `c_*`.
2. **Collector** (`/c/[id]`) — **the field × run heatmap.** Fields down, runs across, each cell
   coloured by fill rate. You _see_ the exact run where two columns turn red. This single visual is
   the most legible argument for the whole product.
3. **Incident** (`/i/[id]`) — the seven-stage timeline. Every stage expands to the raw command and its
   output. The Collector ID is pinned at the top, unchanged, across the whole incident.
4. **Heal Review** (`/i/[id]/review`) — **the screen that wins Suit-Up.** Split view: last-good rows
   against `preview_result` rows, aligned by field, with fill-rate delta badges. Green where the
   preview recovered the field, red where it did not. The exact `bdata scraper approve` command is
   shown _before_ you click it. Two buttons: Approve, Reject.
5. **Terminal drawer** (global) — a live transcript of every `bdata` command Molt has run.

**Visual direction.** Near-black base (`#0A0A0B`), elevated panels (`#131316`), JetBrains Mono for all
data and Inter for chrome. **A single accent — Bright Data red — so the sponsor is unmissable on every
screen without a logo wall.** Semantic colour reserved strictly for meaning: green recovered, amber
degraded, red broken. Restrained motion. Light theme included, because judges use projectors.

Stack: Next.js 15 App Router, Tailwind, shadcn/ui, visx for the heatmap and sparklines.

## 6. The chaos target

To demo healing you need a site that actually changes. Most teams will fail here, because nothing
breaks on command during hackathon week.

`apps/chaos` serves a changelog-shaped listing with switchable layout versions:

| Version | Markup                                                   | Demonstrates                                      |
| ------- | -------------------------------------------------------- | ------------------------------------------------- |
| `?v=1`  | `.entry`, `.entry-title`, `.entry-points`                | Healthy baseline                                  |
| `?v=2`  | `[data-test="title"]`, `span.metric[data-kind="points"]` | Class rename → **fill-rate collapse**             |
| `?v=3`  | Values present but zeroed / truncated                    | **Distortion** — passes a null check, still wrong |

Deterministic, instant, reproducible on camera.

> **Constraint that must not be missed:** Bright Data's scrapers run in Bright Data's cloud and
> **cannot reach `localhost`.** The chaos site must be deployed to a public URL (Vercel, free tier)
> before its collector is created. Building this against localhost first would waste hours.

Two collectors total: `MOLT_COLLECTOR_PRIMARY` (Tailscale changelog, real long-tail target) and
`MOLT_COLLECTOR_CHAOS` (ours, for the heal demo). Both documented in the README with the reasoning.

## 7. Target selection

**Primary: `https://www.postgresql.org/support/security/` — LIVE as `c_mt0z2fn11aj6lk4bdz`.**

Tailscale's changelog was the original pick and it failed: two `scraper create` attempts died at the
first pipeline step because the page is 1.63 MB and the intent analyser cannot ingest it. The property
that made it attractive — 574 records in one request — is what killed it. Full evidence in
[DECISIONS.md](DECISIONS.md).

The replacement is better on every axis that matters:

- **67 KB**, ~25× smaller than the page that failed. Generation completed all nine stages.
- **70 wrapper rows carrying 327 CVE advisories, for 1 page load.**
- Server-rendered `<table>`, no JavaScript, no Cloudflare, no cookies, no UA gating.
- `robots.txt` disallows `/admin/`, `/account/`, `/docs/devel/`, `/list/`, `/search/` and
  `/message-id/raw|flat|resend|mbox/`. `/support/` is not among them.
- Zero personal data. Unambiguously long tail. Genuinely useful data, which is worth more to the
  "potential impact" criterion than a changelog.

Fields (measured at **100% fill across all 327 records**): `cve_id`, `affected_version`, `fixed_in`,
`component`, `cvss_score`, `vector_string`, `description`, plus the inherited `product_page_url`.

> **The AI produced a nested schema** — one wrapper row per advisory page, each holding an array of
> per-version records. Fill-rate analysis has to run over the records, not the wrappers, so
> `@molt/brightdata` projects them (`recordPath: 'security_advisories'`) at the I/O boundary. This
> keeps `@molt/health` a pure function over flat rows, and real collectors nest often enough that the
> projection layer is the right general answer rather than a workaround.

**Stretch target (only if time allows): Thomann UK electric guitars** — 106 products/page with honest
sparsity (ratings on 55 of 106, strike prices on 4) and real pagination. 642 KB, so it may hit the same
ingestion ceiling; behind Cloudflare that did not challenge on test. Nice-to-have, never critical path.
Avoid `?filter=` URLs, which its robots.txt disallows.

**Rejected with evidence** (documented so we never retry them): Tailscale changelog (1.63 MB, generator
fails), PB Tech, Mighty Ape (DataDome 403), Alza.cz, Scan.co.uk — the last four serve bot challenges on
`robots.txt` itself.

**Rule adopted:** measure `Content-Length` before every `scraper create`. Stay under ~200 KB.

## 8. CI — project idea #5, folded in as a feature

| Workflow         | Trigger            | Does                                                                                                                                                                                                                  |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`         | push / PR          | `typecheck` → `lint` → `test` with coverage gate. **No secrets, no network** — runs entirely on fixtures, so the green checks are honest.                                                                             |
| `molt-watch.yml` | cron (6h) + manual | `molt check` against the live primary collector. On `broken`: diagnose, `bdata scraper heal`, then open a GitHub issue containing the data diff and the exact approve command. `--auto-approve` behind a policy flag. |

The scraper fixes itself while you sleep, and the wall of green checks is the proof.

## 9. Testing strategy

| Package      | Approach                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `health`     | Pure unit tests. **38 tests already passing.** Coverage gate: 95% statements / 100% functions.                             |
| `diagnose`   | Golden-file tests on generated prompts + a hard length assertion at 1000 chars.                                            |
| `brightdata` | Fixture-driven: real recorded envelopes in `fixtures/`, transport stubbed. Proves envelope parsing **without an API key**. |
| `core`       | State-machine transition tests against fake ports. Every edge, including bounded-retry exhaustion.                         |
| `web`        | Renders from seeded fixtures, so the UI is never blocked on live data.                                                     |

**`pnpm test` passes offline on a fresh clone with no credentials.** That is a deliberate submission
feature: a judge can verify the logic in 30 seconds.

## 10. Timeline

Today is **20 Aug**. Ship **23 Aug**. Three days.

### Day 1 — 20 Aug · Foundation and live collectors

- [x] Workspace, strict TS config, `@molt/health` + 38 passing tests, clean strict typecheck
- [ ] **`bdata login`** ← blocked on you; on the critical path
- [ ] Deploy `apps/chaos` to Vercel (public URL required)
- [ ] `bdata scraper create` × 2 — **kick off early, they take 5–25 min each and serialise**
- [ ] `@molt/brightdata`, `@molt/store`, `@molt/diagnose`
- [ ] First real run → baseline snapshot committed as a fixture

### Day 2 — 21 Aug · The loop

- [ ] `@molt/core` state machine
- [ ] `molt` CLI: `check`, `diagnose`, `heal`, `approve`, `verify`, `watch`
- [ ] **Full live rehearsal:** flip chaos to `v=2` → detect → diagnose → heal → awaiting_approval →
      approve → verify → resolved
- [ ] Both CI workflows green

### Day 3 — 22 Aug · The cockpit

- [ ] All five screens
- [ ] Heatmap and the heal-review diff
- [ ] Design polish, light + dark, responsive

### Day 4 — 23 Aug (morning) · Ship

- [ ] README: architecture diagram, both Collector IDs, reproduction steps
- [ ] Demo video (script in `docs/DEMO.md`)
- [ ] LinkedIn post tagging WeMakeDevs — free shot at the Daily Bugle track
- [ ] Submit

## 11. Risk register

| Risk                                                           | Severity | Mitigation                                                                                                                                                                                                            |
| -------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scraper create` takes 25 min; AI-Flow 429 cap serialises them | **High** | Kick off on Day 1 before anything else. Single-slot queue in `brightdata`. All downstream work runs against fixtures, so nothing waits.                                                                               |
| Bright Data cloud cannot reach `localhost` chaos site          | **High** | Deploy to Vercel _before_ creating the chaos collector. Called out explicitly above.                                                                                                                                  |
| A heal does not fix the breakage                               | Medium   | We author the chaos breakage, so it is simple and healable (values stay in the DOM, only the selector moves). Bounded retries + re-diagnose with fresh evidence. Rejection path is a demoable feature, not a failure. |
| Credit burn                                                    | Low      | Both targets are single-page: 1 page load per run. 574 rows for 1 credit. $50 + 5,000/mo free is ample.                                                                                                               |
| UI work blocked on live data                                   | Medium   | Seeded fixtures from real recorded runs. UI is developed and demoable offline.                                                                                                                                        |
| Scope creep eats Day 3                                         | Medium   | Thomann, RAG, Slack delivery are all explicitly _stretch_. The five screens and the loop are the deliverable.                                                                                                         |

## 12. Judging criteria → where it is earned

| Criterion                      | Where                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Potential impact**           | Silent scraper breakage is a real, universal, unsolved problem. Molt is a tool we would keep running after the hackathon.                              |
| **Creativity**                 | Nobody monitors _fill rate_. Everyone monitors status codes. And turning drift evidence into the heal prompt automatically is the novel mechanism.     |
| **Technical excellence**       | Pure core with a coverage gate, single I/O boundary, exhaustive state machine, strict TS, offline-verifiable tests.                                    |
| **Use of Scraper Studio**      | All four `scraper` subcommands plus five REST endpoints including `output_schema` and job telemetry. The product cannot exist without `heal`.          |
| **Reliability & self-healing** | The entire product _is_ this criterion: detection, bounded retries, approval gate, and verification that closes an incident only on measured recovery. |
| **Presentation**               | Five purpose-built screens, a scripted 3-minute demo, and a README a stranger can reproduce.                                                           |

## 13. Explicitly out of scope

Auth/multi-tenancy, alerting integrations (Slack/email), the RAG idea, Thomann pagination, and a
hosted multi-user deployment. All are obvious next steps; none are needed to win, and each would cost
a screen.

---

## Appendix — decisions already locked

| Decision            | Choice                       | Why                                                                                            |
| ------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Name                | **Molt**                     | Shedding an old shell and growing a new one — exactly self-healing. Clean `@molt/*` namespace. |
| Primary target      | Tailscale changelog          | 574 records/request, permissive robots, no anti-bot, long-tail.                                |
| Database            | SQLite + Drizzle             | Clone-and-run with zero provisioning.                                                          |
| Mutation transport  | Real `bdata` CLI, never REST | Honours "the terminal is the UI"; the CLI transcript becomes UI content.                       |
| Telemetry transport | REST                         | `output_schema` and job telemetry are not exposed by the CLI.                                  |
| Heal concurrency    | Single-slot queue            | AI-Flow 429 concurrent-job cap.                                                                |
