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

Two `scraper create` attempts failed, both at the _first_ pipeline step:

| Attempt | Collector              | Description                              | Failed at                 |
| ------- | ---------------------- | ---------------------------------------- | ------------------------- |
| 1       | `c_mt0yykpt1qye2ry05d` | 458 chars, prescriptive, named CSS hooks | `prepare_intent_analyzer` |
| 2       | `c_mt0z0aeu8heabltr2`  | 157 chars, plain language, docs style    | `prepare_intent_analyzer` |

Envelope in both cases:

```json
{
  "status": "failed",
  "completed_steps": ["prepare_intent_analyzer"],
  "error": "AI generation finished with status \"failed\"."
}
```

**Diagnosis.** The first attempt suggested an over-prescriptive prompt, so attempt 2 rewrote it in the
style of Bright Data's own examples. Identical failure at the identical step ruled the description out
and pointed at the input instead. Measured:

| Candidate                            | Page size                     |
| ------------------------------------ | ----------------------------- |
| tailscale.com/changelog              | **1,665,590 bytes (1.63 MB)** |
| thomann.co.uk/electric_guitars.html  | 642 KB                        |
| plausible.io/changelog               | 116 KB                        |
| **postgresql.org/support/security/** | **67 KB**                     |

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
markup from _the same_ URL after a deploy is both the honest simulation and precisely how a real
redesign reaches production.

**Corollary:** the site must be publicly reachable. Bright Data's scrapers run in Bright Data's cloud
and cannot reach `localhost`, so `apps/chaos/src/server.ts` is a local preview only.

---

## 2026-08-20 · The chaos site must have no outbound navigation

**What happened.** The chaos build emitted `index.html` plus `v1.html`, `v2.html` and `v3.html`, with a
small switcher nav linking them, so a human could compare layouts. The chaos collector was created
against `https://molt-chaos.vercel.app` and its first run returned this:

```json
{ "changelog_entries": [ { "title": "Fas…", "download_count": 0, … } ],
  "product_page_url": "https://molt-chaos.vercel.app/v3.html",
  "input": { "url": "https://molt-chaos.vercel.app" } }
```

Scraper Studio's AI treated the switcher links as a **discovery surface**. It generated a crawler that
followed them and scraped `v3.html` — the deliberately distorted layout — which is why every `title`
came back truncated to `"Fas…"` and every `download_count` was `0`.

Two consequences, the second much worse than the first:

1. The captured baseline described the wrong page.
2. Flipping `index.html` to v2 would **never have been detected**, because the collector was not
   reading `index.html` at all. The demo would have shown Molt correctly reporting "no change" and
   looked like proof that healing was unnecessary.

**Decision.** A static chaos build emits exactly one file, `index.html`, with zero internal links.
`rm -rf` the output directory first so a previously-deployed sibling cannot linger. Layout comparison
happens on the local dev server (`?v=2`), which is never the collector's target.

**Guarded by test:** `render.test.ts` asserts a static build contains no `<nav>`, no `v2.html`, and
that `[...html.matchAll(/href="(?!https?:)([^"]*)"/g)]` is empty.

**General lesson:** the AI decides _what kind of scraper to build_ from the page it is pointed at. A
page with links becomes a crawler; a page without becomes a single-page extractor. The target's link
graph is part of the scraper's specification.

---

## 2026-08-20 · Deploy scripts must verify the alias actually moved

**What happened.** `vercel deploy apps/chaos/dist --prod --yes` reported success, and
`molt-chaos.vercel.app` went on serving the previous deployment. Vercel infers the project name from
the **deployed directory's name**, so it created a brand-new project called `dist`
(`dist-five-flame-91.vercel.app`) and left the real project untouched. The first deploy had only worked
because `--name molt-chaos` happened to be passed by hand.

This is the most dangerous class of failure in this project: a green deploy, a stale site, and a
monitoring tool that then truthfully reports nothing changed.

**Decisions.**

1. `scripts/chaos-deploy.mjs` always passes `--name molt-chaos`.
2. The script **verifies after deploying**: it fetches the live URL, requires the `x-chaos-layout`
   response header to equal the requested version, retries for ~24s while the alias repoints, and
   fails loudly if it never matches or if any internal link is present.

The `x-chaos-layout` header exists for exactly this reason — it makes "which layout is live" a fact
that can be asserted rather than eyeballed.

**Outstanding cleanup:** the stray Vercel project `dist` still exists; `vercel project rm` needs an
interactive confirmation. Harmless, but delete it by hand.

---

## 2026-08-20 · Per-entry `id` anchors are also a discovery surface

With the switcher links gone, the chaos collector was recreated and returned **60 wrapper rows carrying
3,600 records** — every one of the 60 entries duplicated sixty times. The tell was in the output:

```
"product_page_url": "https://molt-chaos.vercel.app/#2026-07-12-client"
```

Each `<article>` carried `id="{date}-{category}"`. Nothing linked to those anchors, but the generator
still treated them as addressable pages, built one `#fragment` URL per entry, and re-scraped the whole
document for each. **60 page loads per run instead of 1**, for 60× duplicated data.

**Decision.** Chaos entries carry no `id`. Asserted by test:
`expect(html).not.toMatch(/<article[^>]*\sid=/)`.

**Lesson, extending the previous entry:** it is not only `href` that reads as navigation. Any
addressable anchor does. "No outbound navigation" has to mean no anchors either.

**Consequence, and it turned out to be the useful kind:** removing the anchors broke the existing
collector outright — its generated code discovered entries _through_ those anchors, so it returned `[]`.
Which became the first real test of healing (below).

---

## 2026-08-20 · Self-healing verified end to end on real infrastructure

Removing the anchors left collector `c_mt101cvbc0o34ghzh` returning zero rows. Rather than recreate it,
this was used to prove the centrepiece before the demo depended on it.

```
bdata scraper heal c_mt101cvbc0o34ghzh "The scraper returns 0 rows; it previously
  returned 60 changelog entries. The page markup changed: each entry is an article
  element with class 'entry' and these no longer carry an id attribute … Locate the
  entries directly as the article.entry elements on this single page …"
  --url https://molt-chaos.vercel.app
```

Result — deliberately run **without** `--auto-approve`, to capture the gate:

```json
{ "status": "awaiting_approval",
  "completed_steps": ["planner", "control_preview_runner", "code_fixer",
    "step_preview_runner", "request_fulfillment_validator", "step_advance"],
  "diff_summary": "proposed template has 1 step(s) — review at view_url",
  "next_step": "bdata scraper approve c_mt101cvbc0o34ghzh --url https://molt-chaos.vercel.app",
  "preview_result": [ { "changelog_entries": [ …60 correct entries… ] } ] }
```

Then `scraper approve … --auto-save` returned `status: done` with `user_approval` and
`save_new_template` appended to the pipeline, and a fresh run returned **60 records from 1 page load**,
full titles, 60 distinct download counts.

**Findings folded back into the code:**

- The heal envelope carries two fields the docs do not mention: `diff_summary` and `completed_steps`.
  Both are now in `healEnvelopeSchema` and the real envelope is committed as
  `test/fixtures/heal-awaiting-approval.json`.
- Same Collector ID throughout, which is the entire premise.
- The heal fixed a _structural_ problem — discovery strategy, not just a selector — which is a stronger
  result than expected.

---

## 2026-08-20 · A field zeroed out is broken, not degraded

The v2 flip produced this, and it is the most important observation of the day:

```
rows  60
score ███████████████░░░░░  75
status  BROKEN  2 of 8 fields returned only zeros: comment_count, download_count
  ≠ comment_count   60.5 → 0
  ≠ download_count  20251.5 → 0
```

The relocated metrics did not come back `null`. They came back **`0`**. Row count unchanged, job
`done`, HTTP 200, and `download_count: 0` is an entirely plausible number — **every null check in the
world passes this**. Only comparing the distribution catches it: a median of 20,251 going to 0.

Originally this scored as `degraded`, because distortion was weighted at half a field. That was wrong.
A field whose every value has become zero, from a meaningfully non-zero baseline, is entirely lost.

**Decision.** `isZeroed` — a distortion with `currentMagnitude === 0` and a non-zero baseline — is a
hard failure: status `broken`, full loss weight, and its own summary wording ("returned only zeros")
so it is never conflated with a field that merely stopped filling. A field that is merely _rescaled_
tenfold stays `degraded`, because the values are still values.

---

## 2026-08-20 · One refactor job per collector — a 409 that must not be retried

Undocumented, and the most operationally significant constraint found so far.

After the `--auto-save` bug left a heal sitting at the approval gate, the next unattended run did this:

```
→ diagnose.start   diagnosing
→ heal.start       heal_failed
→ diagnose.start   diagnosing
→ heal.start       escalated
⏸ nothing to do in escalated
```

Two heals, both failing in under two seconds, retry budget gone, escalated. The transcript said why:

```
Triggering self-healing...
Failed to start self-healing for collector c_mt101cvbc0o34ghzh:
  Error: Another refactor job is still in progress
  Status: 409
Note: the heal did not complete, but scraper c_… is unchanged and still works as it did before.
```

Envelope status: `heal_trigger_failed`.

**Scraper Studio permits one refactor job per collector**, enforced server-side. A heal left awaiting
approval blocks every later heal on that collector until it is approved or rejected.

Note this is a _different_ limit from the AI-Flow concurrency cap, which is a 429 across the account and
which the CLI retries through by itself. This one is a 409, per collector, and retrying is futile.

**Why the naive handling was actively harmful.** Treated as an ordinary failure, a 409 consumed a retry
attempt each time. Two attempts vanished in 3.4 seconds and the incident escalated citing "attempts
exhausted" — a diagnosis that is both wrong and misleading, since nothing had been attempted at all and
no credits were spent.

**Decisions.**

1. `isHealBlocked` distinguishes it, by envelope status _or_ by the stderr message.
2. A new `heal.blocked` trigger escalates immediately **and refunds the attempt** (`attemptsDelta: -1`),
   because nothing ran. The reason given names the real problem: _another heal is already pending on this
   collector; approve or reject it first._
3. `molt unblock [collector]` rejects the pending heal to release the lock. Deliberately a separate,
   explicit command rather than something the engine does automatically — rejecting a pending heal
   discards a fix a person may be part-way through reviewing, so it should be a decision, not a side
   effect.

**Also fixed here:** `molt log` now prints stderr and stdout for failed commands unconditionally. The
409 was invisible until it did — the transcript showed `fail` and nothing else, which is the least
useful thing a transcript can do.

---

## 2026-08-20 · Verification caught a bug in Molt's own approve call

The best evidence this project has produced, and it came from the design catching its own author.

The first full unattended run reached the gate, was approved, and then **refused to close**:

```
04:33:56  approve.accepted       fix approved by reviewer
04:33:56  verify.start           checking whether fill rates actually recovered
04:33:59  observed.still-broken  2 of 8 fields returned only zeros: comment_count, download_count
04:33:59  verify.failed          2 of 8 fields returned only zeros: comment_count, download_count
04:33:59  diagnose.start         composing a heal prompt from the drift evidence
04:34:xx  heal.start             running bdata scraper heal
04:35:07  heal.gate              1 preview rows awaiting review
```

`bdata scraper approve` had exited 0. The envelope said `done`. The preview had shown every broken field
recovering. And the collector was still returning zeros.

**Cause.** `CliScraper.approve` did not pass `--auto-save`. Without it, approving accepts the fix into a
**draft** and leaves the production template untouched — so the live collector goes on serving the
broken extraction. The manual test earlier in the day had passed `--auto-save` by hand and worked, which
is precisely why the omission in code went unnoticed.

Confirmed by comparing envelopes: with `--auto-save` the pipeline gains both `user_approval` **and**
`save_new_template`. Without it, only the former.

**Fix.** `--auto-save` on every approve that is not a rejection, with a comment saying why it is not
optional.

**Why this matters more than the fix.** Every stage upstream of verification reported success. Exit code
0, `status: done`, a preview full of recovered fields. A system that closed the incident on approval —
which is what almost any implementation would do — would have reported a green, resolved incident over a
scraper that was still silently wrong. That is the exact failure this project exists to prevent, and it
happened _inside_ the project.

Then the machine did the right thing without being asked: reopened, re-diagnosed from the fresh evidence,
re-healed, and stopped at the gate again for a human.

**The rule stands, now with evidence: approval is not success. Only measured recovery closes an
incident.**

---

## 2026-08-20 · Recovery must be the negation of the fault, at the same threshold

The review screen is where a proposed fix is judged, and the first version of it judged wrongly twice.

**First, it compared the wrong pair.** It showed two columns — "was" and "now" — where "was" was the
_broken_ fill rate. For the zeroed-field case that produced a table reading `100% → 100%` on every row,
because a zeroed field fills perfectly. The table was literally incapable of showing the fault it
existed to review.

Fixed by showing **three** columns — baseline, broken, preview — and by choosing the measure per field:
fill rate for a field that stopped filling, typical value for a field that was zeroed. Two columns
cannot express recovery, because "before" is ambiguous.

**Then it judged recovery on a stricter threshold than detection.** With three columns the real numbers
appeared:

```
field              baseline       broken      preview
comment_count          60.5            0         18.5   ✗
download_count     20,251.5            0      1,688.5   ✗
```

Both fields had obviously recovered — from zero to real values — and both were marked as still broken,
because 1,688 is not within 2× of 20,251. But it never needed to be: **the preview carries 2 rows and
the baseline was computed over 60.** Medians across samples of such different sizes are not comparable;
the first two entries of the page simply sit below the page's midpoint.

**Decision.** Recovery is the negation of the fault condition, evaluated at the _same_ threshold that
detected it. A field that was zeroed has recovered when it is no longer zero. A field that was rescaled
has recovered when it is back inside `DEFAULT_THRESHOLDS.distortionFactor`. Where the preview sample is
less than a quarter of the baseline, the output says so explicitly rather than presenting the two as
equivalent.

**Lesson.** Rendering the comparison is what exposed both bugs. A verdict of "broken" printed alone is
unfalsifiable; the same verdict beside the three numbers it was derived from is not. That is the
argument for the review screen existing at all, and it earned its place by catching its own author.

---

## 2026-08-20 · The chaos v2 layout must not rename the entry container

The first v2 renamed `.entry` to `.release-item` **and** moved the metrics. The scraper then found no
entries at all and reported an empty harvest:

```
rows  0
status  BROKEN  Empty harvest: 0 rows returned, baseline was 60
```

A real failure, but the _easy_ one — zero rows is obvious to any monitor, and detecting it proves
nothing about this project's thesis.

**Decision.** v2 changes only the two metric fields. The container and the title are stable across every
layout, so the scraper still returns all 60 rows and the failure is genuinely silent. Asserted by test:
v2 must still contain `class="entry"` and `class="entry-title"`, and still render 60 entries.

---

## 2026-08-20 · The web UI's Fleet page showed a false-green fill rate for a zeroed field

Built the Next.js web UI (`apps/web`) — Fleet, Collector heatmap, Incident timeline, and the Heal
Review screen with real Server Actions calling `Engine.decide`. Wiring the pages against the live
database (rather than fixtures) immediately surfaced two real bugs, both only visible with real data.

**First.** The Fleet page's per-field sparkline used raw `field.rate` from the latest snapshot. For
`comment_count` and `download_count` — zeroed by the chaos v2 layout — that rate is **100%**, because a
zeroed field fills on every row. The card rendered a wall of green while an incident banner two lines
above it said `2 of 8 fields returned only zeros`. This is the exact false-green signal the whole project
exists to catch, reproduced inside the project's own UI.

**Decision.** Extracted the heatmap's baseline-comparison classification (`lib/heatmap.ts`) into a
`cellLabel` helper and used it on the Fleet page too: a zeroed field now reads `ZEROED` in bold red,
never a percentage. Every place a fill rate is shown next to a classified verdict must use this, not
the raw rate.

---

## 2026-08-20 · `resolveCliEntry` broke under webpack; the web UI's Approve button did nothing

The most important bug this project has found, because it reproduces the project's own thesis inside
itself: an action that reported success while doing nothing.

**What happened.** Deployed a fresh chaos v3 break, drove it through `molt watch` to a genuine
`awaiting_approval` incident, then clicked **Approve** in the browser for real. The Server Action
returned 200 in 192ms — far too fast for a real `bdata scraper approve` call, which takes seconds. The
incident stayed `awaiting_approval`. Checking the stored command directly found the truth:

```
exitCode: 1
stderr: Error: Cannot find module
  'D:\...\Scrape-Verse\apps\node_modules\.pnpm\@brightdata+cli@0.3.5...\dist\index.js'
```

Note `apps\node_modules` — not `apps\web\node_modules`, not the workspace root. That path has never
existed.

**Cause.** `resolveCliEntry()` (`packages/brightdata/src/command.ts`) resolves the CLI via
`createRequire(import.meta.url)`. That works when the module runs as plain ESM — the `molt` CLI via
`tsx`, or a Vitest run — because `import.meta.url` is a real file URL. Once webpack bundles
`@molt/brightdata` into the Next.js server build (it sits behind `transpilePackages`, needed so its
TypeScript source gets parsed at all), `import.meta.url` stops pointing at anything on disk. It still
produces a syntactically valid-looking path, which is exactly why `createRequire(...).resolve(...)`
did not throw — it happily resolved to a phantom location and returned successfully, and the real
failure only surfaced one step later, when Node tried to load that path as a subprocess and it did not
exist.

**Consequence.** `Engine.decide()` recorded the failed command, and then compounded the problem: it
responded with the `heal.failed` trigger, which is only legal from the `healing` state. From
`awaiting_approval` the transition machine correctly refused it —
`refused.heal.failed no heal is in flight in awaiting_approval` — and returned the incident **unchanged**,
with no exception raised. The Server Action resolved normally. The click produced no visible effect at
all, and there was nothing on screen to say why.

**Decisions.**

1. `resolveCliEntry()` now verifies every candidate path with `existsSync` before returning it — a
   resolved string is no longer trusted just because resolution did not throw — and falls back to
   `findCliEntryFrom(process.cwd())`, a pure filesystem walk up from the working directory looking for
   `node_modules/@brightdata/cli/dist/index.js`. `process.cwd()` is stable under every runtime this
   package runs in; no bundler can rewrite it the way it rewrites `import.meta.url`.
2. `Engine.decide()` no longer applies a state transition when the approve/reject **call itself** fails.
   It throws instead, with an explicit message, and leaves the incident at the gate — retryable, not
   corrupted. This is deliberate: a transport failure is not a decision about the fix, and forcing every
   caller to handle a thrown error is what makes a silent "nothing happened" impossible.
3. `DecisionButtons` (the web UI) gained a `try`/`catch` around both calls, since a Server Action that
   throws needs somewhere for the message to land — it did not have one when this fired for real.

**Verified fixed on real infrastructure, not just by test.** Redeployed the same v3 break, drove it to
`awaiting_approval` again, clicked Approve in the browser again. This time: `POST … 200 in 6400ms` — a
realistic duration — and the incident closed `resolved`. The Fleet page went back to all-green,
correctly, because the collector was genuinely healthy again. The full sequence, including the original
failure, is permanently on the incident's own timeline: a `heal.failed` at 73ms/exit 1, immediately
followed by a working approve at 2,841ms/exit 0 — the incident's audit trail recording the bug that
happened while building the tool that watches for bugs.

**Test debt this closed.** The engine test fixture had an `approveFails` config flag that had never
actually been exercised by a test — the exact gap that let a real bug reach a live click before a unit
test caught it. Added three tests: the throw itself, that the incident state is left untouched, and that
the failed command is still recorded for the transcript. Also added `findCliEntryFrom` as an exported,
directly-testable pure function, with tests that build a fake `node_modules` tree under `os.tmpdir()`
rather than depending on this repository's own installed dependencies.

---

## 2026-08-20 · SQLite over Postgres

**Decision:** libSQL + Drizzle, file-backed, committed schema, no external service.

**Why:** "submit a repository with clear setup instructions, so a judge can clone it and reproduce what
you built" is an explicit submission requirement. `pnpm install && pnpm dev` with no database to
provision is worth more than any feature Postgres would unlock at this scale.
