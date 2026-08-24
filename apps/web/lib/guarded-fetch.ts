import { checkUrl, REJECTION_REASON, type UrlRejection } from '@/lib/url-guard';

/**
 * A `fetch` that is safe to point at a caller-supplied URL.
 *
 * `preflightTarget` in `@molt/brightdata` accepts an injectable `fetchImpl`
 * precisely so its network edge can be controlled from outside — that seam is
 * what lets the playground reuse the real preflight logic without weakening it,
 * and without adding any web-app-specific I/O to that package (`CLAUDE.md`
 * keeps all Bright Data I/O there; this is input validation, which belongs
 * here).
 *
 * Four things this adds over bare `fetch`:
 *
 * 1. **Redirects are followed manually, and re-checked at every hop.** This is
 *    the whole reason the wrapper exists rather than a single up-front
 *    validation. `redirect: 'follow'` hands control of the final destination to
 *    the remote server: a public hostname that 302s to `169.254.169.254` defeats
 *    any guard that only looked at what the visitor typed.
 * 2. **A timeout.** An endpoint that accepts a connection and then never
 *    responds would otherwise hold a server request open indefinitely.
 * 3. **A body cap, enforced while streaming.** `response.text()` on an
 *    unbounded response is an out-of-memory waiting to happen; reading chunks
 *    and aborting past the cap bounds it. The cap is generous relative to the
 *    ~200 KB target ceiling preflight is measuring against, so a page that is
 *    merely too big still gets measured and reported as too big rather than
 *    failing outright.
 * 4. **No credentials, ever.** `credentials: 'omit'` and an explicit empty
 *    cookie posture, so nothing about the server's own session can leak into a
 *    request a stranger composed.
 */

export class UnsafeUrlError extends Error {
  readonly rejection: UrlRejection;

  constructor(rejection: UrlRejection, url: string) {
    super(REJECTION_REASON[rejection]);
    this.name = 'UnsafeUrlError';
    this.rejection = rejection;
    this.url = url;
  }

  readonly url: string;
}

export interface GuardedFetchLimits {
  /** Per-request wall clock, milliseconds. */
  readonly timeoutMs?: number;
  /** Maximum bytes read from any single response body. */
  readonly maxBytes?: number;
  /** Redirect hops permitted before giving up. */
  readonly maxRedirects?: number;
}

const DEFAULTS = {
  timeoutMs: 8_000,
  // ~5x the 200 KB target ceiling: comfortably enough to measure an
  // over-the-limit page and say so, nowhere near enough to exhaust memory.
  maxBytes: 1_000_000,
  maxRedirects: 4,
} as const;

/**
 * Read at most `maxBytes` of a response body as UTF-8 text.
 *
 * Streams rather than calling `.text()`, and cancels the body as soon as the cap
 * is crossed so the remote server stops sending. The truncated result is still
 * useful to the caller: preflight measures size and parses links, and a page
 * already past the cap is going to be reported as over the ceiling regardless
 * of what its last byte was.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const chunks: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // Truncate *within* the chunk rather than after it. Checking the running
      // total only after appending a whole chunk makes the cap chunk-granular,
      // which is no cap at all against a server that sends one enormous chunk —
      // and a buffered in-memory response arrives as exactly that.
      const remaining = maxBytes - total;
      if (value.byteLength >= remaining) {
        // A slice can land mid-codepoint; `stream: true` holds the partial
        // sequence and the final flush below resolves it. Size measurement and
        // link parsing are both unaffected by a truncated trailing character.
        chunks.push(decoder.decode(value.subarray(0, remaining), { stream: true }));
        total = maxBytes;
        break;
      }

      total += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    // `cancel` rather than leaving it to GC: it releases the socket promptly
    // instead of letting an aborted large download keep draining.
    await reader.cancel().catch(() => undefined);
  }

  chunks.push(decoder.decode());
  return chunks.join('');
}

/**
 * Build a `fetch`-compatible function with the guarantees described above.
 *
 * The returned function's signature matches `typeof fetch` so it can be handed
 * straight to `preflightTarget({ fetchImpl })`.
 */
export function createGuardedFetch(limits: GuardedFetchLimits = {}): typeof fetch {
  const timeoutMs = limits.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = limits.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = limits.maxRedirects ?? DEFAULTS.maxRedirects;

  return async function guardedFetch(input, init) {
    let currentUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const rejection = checkUrl(currentUrl);
      if (rejection !== null) throw new UnsafeUrlError(rejection, currentUrl);

      const response = await fetch(currentUrl, {
        ...init,
        // Manual, so each hop comes back here to be re-checked rather than being
        // resolved inside the runtime where the guard cannot see it.
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(timeoutMs),
      });

      const location = response.headers.get('location');
      const isRedirect = response.status >= 300 && response.status < 400 && location !== null;

      if (!isRedirect) {
        // Re-wrap with a capped, already-read body. The caller sees an ordinary
        // `Response` whose `.text()` resolves instantly and cannot be unbounded.
        const text = await readCapped(response, maxBytes);
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      // Relative `Location` headers are legal and common.
      currentUrl = new URL(location, currentUrl).href;
    }

    throw new Error(`too many redirects (more than ${String(maxRedirects)})`);
  };
}
