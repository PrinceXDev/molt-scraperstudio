# Decision log

Real decisions, with the evidence that forced them. Dated, append-only.

---

## 2026-08-20 · Mutations go through the CLI, telemetry through REST

`bdata scraper create|run|heal|approve` map onto REST endpoints (`/dca/collector`,
`/dca/trigger`, `/dca/collectors/{c}/refactor_template`, `.../resume_automation_job`), so Molt could
call either.

**Decision:** every mutation goes through the real CLI; REST is used only for read-only telemetry the
CLI does not expose (`collectors_list` for `output_schema`, `collector/jobs`, `log/{job_id}`).

**Why:** the brief's first best practice is "the terminal is the UI". Driving the same CLI a judge
would type keeps that literally true, and the captured `argv` + stdout become the content of the UI's
terminal drawer. Reimplementing the CLI against REST would have been faster and would have quietly
thrown away the most defensible part of the story.

---

## 2026-08-20 · AI-Flow operations are serialised through a single slot

`bdata scraper create --help` documents `--max-retries` as retries "on the AI-Flow concurrent-job cap
429", defaulting to 4 with exponential backoff up to ~4 minutes.

**Decision:** `@molt/brightdata` queues `create` and `heal` through one slot. `run` stays concurrent.

**Why:** two heals in flight will 429. Discovering that during a recorded demo would be fatal, and the
backoff can silently add four minutes to a run.

---

## 2026-08-20 · Primary target moved from Tailscale changelog to PostgreSQL security advisories

**What happened.** `https://tailscale.com/changelog` was selected after validation: 574 records from a
single request, `robots.txt` of `Disallow:` (empty — everything permitted), no anti-bot, no personal
data, not in Bright Data's pre-built library. On paper the best candidate by a wide margin.

Two `scraper create` attempts failed, both at the *first* pipeline step:

| Attempt | Collector | Description | Failed at |
|---|---|---|---|
| 1 | `c_mt0yykpt1qye2ry05d` | 458 chars, prescriptive, named CSS hooks | `prepare_intent_analyzer` |
| 2 | `c_mt0z0aeu8heabltr2` | 157 chars, plain language, docs style | `prepare_intent_analyzer` |

Envelope in both cases:

```json
{ "status": "failed", "completed_steps": ["prepare_intent_analyzer"],
  "error": "AI generation finished with status \"failed\"." }
```

**Diagnosis.** The first attempt suggested an over-prescriptive prompt, so attempt 2 rewrote it in the
style of Bright Data's own examples. Identical failure at the identical step ruled the description out
and pointed at the input instead. Measured:

| Candidate | Page size |
|---|---|
| tailscale.com/changelog | **1,665,590 bytes (1.63 MB)** |
| thomann.co.uk/electric_guitars.html | 642 KB |
| plausible.io/changelog | 116 KB |
| **postgresql.org/support/security/** | **67 KB** |

The intent analyser never got past ingesting a 1.63 MB document. **The property that made Tailscale
attractive — 574 records in one request — is exactly what broke it.**

**Decision.** Primary target is now `https://www.postgresql.org/support/security/`.

**Why it is a better primary anyway:**

- 67 KB, ~25× smaller than the page that failed.
- 70 CVE advisories in one clean `<table>`, server-rendered, no JavaScript.
- Eight fields with genuine variation — `cvss_v3_score` and `cvss_vector` are absent on older
  advisories, so fill-rate analysis has a real distribution instead of a wall of 100%.
- `robots.txt` disallows `/admin/`, `/account/`, `/docs/devel/`, `/list/`, `/search/` and
  `/message-id/raw|flat|resend|mbox/`. `/support/` is not among them.
- No anti-bot (nginx behind Varnish), no cookies, no UA gating, zero personal data.
- Unambiguously long tail, and the data is genuinely useful — which is worth more to the "potential
  impact" criterion than a changelog.

**Cost of the lesson:** two half-built collectors that Bright Data cannot delete programmatically.
`c_mt0yykpt1qye2ry05d` and `c_mt0z0aeu8heabltr2` must be removed by hand in the dashboard.

**Rule adopted:** measure `Content-Length` before every `scraper create`. Keep targets under ~200 KB.
The chaos site builds to 54 KB, comfortably inside that.

---

## 2026-08-20 · The chaos site changes by redeploy, not by query parameter

The first design exposed layouts at `?v=1`, `?v=2`, `?v=3`.

**Decision:** the chaos site is pre-rendered to static HTML. `index.html` is whichever layout is live,
and changing layout means rebuilding and redeploying. `v1.html`/`v2.html`/`v3.html` are also emitted,
but only for side-by-side review.

**Why:** a collector is pinned to a fixed URL. A collector created against `?v=1` would keep fetching
`?v=1` forever and never observe a change — the simulation would prove nothing. Serving different
markup from *the same* URL after a deploy is both the honest simulation and precisely how a real
redesign reaches production.

**Corollary:** the site must be publicly reachable. Bright Data's scrapers run in Bright Data's cloud
and cannot reach `localhost`, so `apps/chaos/src/server.ts` is a local preview only.

---

## 2026-08-20 · SQLite over Postgres

**Decision:** libSQL + Drizzle, file-backed, committed schema, no external service.

**Why:** "submit a repository with clear setup instructions, so a judge can clone it and reproduce what
you built" is an explicit submission requirement. `pnpm install && pnpm dev` with no database to
provision is worth more than any feature Postgres would unlock at this scale.
