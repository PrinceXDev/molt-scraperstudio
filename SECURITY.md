# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security concern. Instead, use GitHub's private
reporting: go to the [Security tab](https://github.com/PrinceXDev/molt-scraperstudio/security) of this
repository and select **"Report a vulnerability."** That opens a private advisory only the maintainer
can see until it's resolved.

## What's actually in scope

This is a hackathon project with two genuinely security-relevant surfaces, both in `apps/web`:

- **The playground accepts a caller-supplied URL** (`/playground`'s preflight, drift-replay, and
  create tabs) and fetches it server-side — a textbook SSRF vector on a public page.
  [`lib/url-guard.ts`](apps/web/lib/url-guard.ts) rejects credentials-in-URL, non-default ports, and
  loopback/private/link-local/CGNAT ranges (including the cloud-metadata address, IPv4 and IPv6, and
  embedded-IPv4 forms) before any request is made.
  [`lib/guarded-fetch.ts`](apps/web/lib/guarded-fetch.ts) re-validates on **every redirect hop**, not
  just the initial URL, and caps the response body byte-for-byte. Known residual gap: DNS rebinding
  between validation and the actual connection is not fully closed — documented rather than hidden, in
  the app's own `/docs/honest-limits` page.
- **Every Bright Data API key is redacted before storage.**
  [`packages/brightdata/src/redact.ts`](packages/brightdata/src/redact.ts) scrubs known secret
  environment values out of every command's `argv`/`stdout`/`stderr` before it's written to the
  database — those records get rendered verbatim in the UI's terminal drawer, so this runs before
  persistence, not at render time.

Also relevant: `MOLT_PLAYGROUND_CREATE` and `MOLT_PLAYGROUND_LIVE` are off by default precisely because
they let a public visitor trigger real, credit-spending Bright Data operations; rate limits and
preflight blockers apply with no bypass when they're on. `.env` is gitignored and should never be
committed.

## What's out of scope

- The CLI (`apps/sentinel`) and the scheduled GitHub Action are operator tools, run by whoever controls
  the Bright Data account and its secrets — not a public attack surface in the same sense as the web
  app.
- Findings against dependencies (Next.js, libSQL, `@brightdata/cli` itself) should go to those
  projects directly; open an issue here only if this repo's usage of them introduces the problem.
