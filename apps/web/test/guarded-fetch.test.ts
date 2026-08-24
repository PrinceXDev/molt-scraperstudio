import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGuardedFetch, UnsafeUrlError } from '../lib/guarded-fetch.js';

/**
 * The guarded fetch.
 *
 * The behaviour worth testing here is the one an up-front URL check cannot give
 * you: a public hostname that redirects into private space. `redirect: 'follow'`
 * would resolve that hop inside the runtime where no guard can see it, which is
 * why this wrapper follows redirects itself and re-checks every hop.
 *
 * `global.fetch` is stubbed so none of this touches a network.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Stub `fetch` with a scripted map of url → response *factory*.
 *
 * Factories rather than pre-built `Response` objects, and deliberately never
 * `.clone()`. Cloning a `Response` tees its body, and reading only one branch of
 * a tee stalls the reader once the other branch's queue fills — which looks
 * exactly like a hang in the code under test and is entirely an artifact of the
 * harness. Real `fetch` hands back a fresh, un-teed body every call, so the stub
 * does too.
 */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      const route = routes[url];
      if (route === undefined) return Promise.reject(new Error(`unexpected fetch: ${url}`));
      return Promise.resolve(route());
    }),
  );
  return calls;
}

function redirectTo(location: string): () => Response {
  return () => new Response(null, { status: 302, headers: { location } });
}

function body(text: string, status = 200): () => Response {
  return () => new Response(text, { status });
}

describe('createGuardedFetch', () => {
  it('fetches a permitted URL and returns its body', async () => {
    stubFetch({ 'https://example.com/': body('<html>ok</html>') });

    const guarded = createGuardedFetch();
    const response = await guarded('https://example.com/');

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('<html>ok</html>');
  });

  it('refuses a blocked URL before making any request', async () => {
    const calls = stubFetch({});

    const guarded = createGuardedFetch();
    await expect(guarded('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );

    // The important half: nothing went out on the wire.
    expect(calls).toEqual([]);
  });

  it('re-checks each redirect hop and refuses one that lands in private space', async () => {
    // The bypass this wrapper exists to close: the initial URL is a legitimate
    // public host, and the *server* chooses the private destination.
    const calls = stubFetch({
      'https://totally-fine.example.com/': redirectTo('http://169.254.169.254/latest/meta-data/'),
    });

    const guarded = createGuardedFetch();
    const error = await guarded('https://totally-fine.example.com/').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnsafeUrlError);
    expect((error as UnsafeUrlError).rejection).toBe('link-local');
    expect((error as UnsafeUrlError).url).toBe('http://169.254.169.254/latest/meta-data/');

    // The first hop was fetched; the second never was.
    expect(calls).toEqual(['https://totally-fine.example.com/']);
  });

  it('follows a permitted redirect chain to its destination', async () => {
    const calls = stubFetch({
      'https://a.example.com/': redirectTo('https://b.example.com/'),
      'https://b.example.com/': redirectTo('https://c.example.com/'),
      'https://c.example.com/': body('arrived'),
    });

    const guarded = createGuardedFetch();
    const response = await guarded('https://a.example.com/');

    await expect(response.text()).resolves.toBe('arrived');
    expect(calls).toHaveLength(3);
  });

  it('resolves a relative Location header against the current hop', async () => {
    const calls = stubFetch({
      'https://example.com/start': redirectTo('/finish'),
      'https://example.com/finish': body('done'),
    });

    const guarded = createGuardedFetch();
    await expect((await guarded('https://example.com/start')).text()).resolves.toBe('done');
    expect(calls[1]).toBe('https://example.com/finish');
  });

  it('gives up on a redirect loop rather than following it forever', async () => {
    stubFetch({
      'https://loop.example.com/': redirectTo('https://loop.example.com/'),
    });

    const guarded = createGuardedFetch({ maxRedirects: 2 });
    await expect(guarded('https://loop.example.com/')).rejects.toThrow(/too many redirects/);
  });

  it('caps the body at exactly maxBytes, even from a single huge chunk', async () => {
    // A buffered in-memory response arrives as one chunk. That is the case a
    // chunk-granular cap fails to bound at all, and it was the first
    // implementation's actual behaviour: it read all 50,000 bytes.
    const huge = 'x'.repeat(50_000);
    stubFetch({ 'https://big.example.com/': body(huge) });

    const guarded = createGuardedFetch({ maxBytes: 1_000 });
    const text = await (await guarded('https://big.example.com/')).text();

    // Single-byte characters here, so bytes and length coincide exactly.
    expect(text).toHaveLength(1_000);
  });

  it('returns a short body untouched', async () => {
    stubFetch({ 'https://small.example.com/': body('tiny') });

    const guarded = createGuardedFetch({ maxBytes: 1_000 });
    await expect((await guarded('https://small.example.com/')).text()).resolves.toBe('tiny');
  });

  it('passes a non-2xx response through rather than throwing', async () => {
    // Preflight itself decides what a 404 means; the fetch layer should not
    // pre-empt that by turning it into an exception.
    stubFetch({ 'https://example.com/missing': body('nope', 404) });

    const guarded = createGuardedFetch();
    const response = await guarded('https://example.com/missing');
    expect(response.status).toBe(404);
  });

  it('never sends credentials', async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: unknown, init?: RequestInit) => {
        if (init !== undefined) seen.push(init);
        return Promise.resolve(new Response('ok', { status: 200 }));
      }),
    );

    const guarded = createGuardedFetch();
    await guarded('https://example.com/');

    expect(seen[0]?.credentials).toBe('omit');
    expect(seen[0]?.redirect).toBe('manual');
    expect(seen[0]?.signal).toBeDefined();
  });
});
