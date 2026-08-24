import { describe, expect, it } from 'vitest';

import { checkUrl, isFetchableUrl, REJECTION_REASON, type UrlRejection } from '../lib/url-guard.js';

/**
 * The SSRF guard.
 *
 * This is the highest-consequence code added for the playground: it is the only
 * thing standing between a text input on a public page and the server's own
 * network position. Tested by enumeration rather than by example, because the
 * failure mode is a single missed range and "we tested a few" is how one gets
 * missed.
 */

describe('checkUrl — allows real public targets', () => {
  it.each([
    'https://www.postgresql.org/support/security/',
    'https://molt-chaos.vercel.app',
    'http://example.com',
    'https://example.com:443/path?query=1#frag',
    'http://example.com:80/',
    'https://sub.domain.example.co.uk/a/b',
    // A public IP is fine — the guard blocks private space, not literal IPs.
    'https://93.184.216.34/',
  ])('%s', (url) => {
    expect(checkUrl(url)).toBeNull();
    expect(isFetchableUrl(url)).toBe(true);
  });
});

describe('checkUrl — schemes', () => {
  it.each([
    ['file:///etc/passwd', 'scheme'],
    ['ftp://example.com/x', 'scheme'],
    ['gopher://example.com/', 'scheme'],
    // The classic SSRF-to-local-file and SSRF-to-internal-protocol pivots.
    ['dict://127.0.0.1:11211/stat', 'scheme'],
    ['data:text/html,hi', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
  ])('%s → %s', (url, expected) => {
    expect(checkUrl(url)).toBe(expected);
  });

  it('rejects anything that is not a URL at all', () => {
    expect(checkUrl('not a url')).toBe('malformed');
    expect(checkUrl('example.com')).toBe('malformed');
    expect(checkUrl('')).toBe('malformed');
  });
});

describe('checkUrl — loopback', () => {
  it.each([
    'http://localhost/',
    'http://localhost:80/',
    'http://127.0.0.1/',
    'http://127.1.2.3/',
    // 0.0.0.0 reaches localhost on Linux; a guard that only checks 127/8 misses it.
    'http://0.0.0.0/',
    'http://0.1.2.3/',
    'http://[::1]/',
    'http://[::]/',
    // IPv4-mapped IPv6 is the same address in different syntax.
    'http://[::ffff:127.0.0.1]/',
  ])('%s', (url) => {
    expect(checkUrl(url)).toBe('loopback');
  });
});

describe('checkUrl — RFC 1918 and CGNAT private space', () => {
  it.each([
    'http://10.0.0.1/',
    'http://10.255.255.255/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.0.1/',
    'http://192.168.1.254/',
    // CGNAT / Tailscale range: a tailnet peer is as internal as a LAN host.
    'http://100.64.0.1/',
    'http://100.127.255.255/',
    // IPv6 unique-local.
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[::ffff:10.0.0.1]/',
  ])('%s', (url) => {
    expect(checkUrl(url)).toBe('private');
  });

  it('does not over-block the edges of 172.16/12', () => {
    // 172.15.x and 172.32.x are public. An off-by-one here silently blocks real
    // targets, which is a quieter bug than letting a private one through.
    expect(checkUrl('http://172.15.0.1/')).toBeNull();
    expect(checkUrl('http://172.32.0.1/')).toBeNull();
  });

  it('does not over-block near the CGNAT edges', () => {
    expect(checkUrl('http://100.63.255.255/')).toBeNull();
    expect(checkUrl('http://100.128.0.1/')).toBeNull();
  });
});

/**
 * The IPv6-embedded-IPv4 forms.
 *
 * These are the cases a text-pattern guard misses, and one of them was a real
 * bypass in the first draft of this file: `URL` re-serialises
 * `::ffff:127.0.0.1` as `::ffff:7f00:1`, so a regex looking for dotted-quad
 * notation never matched and the loopback address passed as clean. Each form
 * below is asserted against the *classification*, not the spelling.
 */
describe('checkUrl — IPv4 embedded in IPv6', () => {
  it.each([
    // IPv4-mapped, dotted and pre-normalised hex forms of the same address.
    ['http://[::ffff:127.0.0.1]/', 'loopback'],
    ['http://[::ffff:7f00:1]/', 'loopback'],
    ['http://[::ffff:10.0.0.1]/', 'private'],
    ['http://[::ffff:a00:1]/', 'private'],
    ['http://[::ffff:169.254.169.254]/', 'link-local'],
    ['http://[::ffff:a9fe:a9fe]/', 'link-local'],
    // NAT64 well-known prefix — routes to the embedded IPv4 where configured.
    ['http://[64:ff9b::127.0.0.1]/', 'loopback'],
    ['http://[64:ff9b::169.254.169.254]/', 'link-local'],
    // Deprecated IPv4-compatible.
    ['http://[::10.0.0.1]/', 'private'],
  ])('%s → %s', (url, expected) => {
    expect(checkUrl(url)).toBe(expected);
  });

  it('leaves a public address embedded in IPv6 alone', () => {
    expect(checkUrl('http://[::ffff:93.184.216.34]/')).toBeNull();
  });
});

describe('checkUrl — link-local and cloud metadata', () => {
  it.each([
    // The single highest-value SSRF target on any cloud provider.
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.0.1/',
    'http://[fe80::1]/',
    'http://[feb0::1]/',
  ])('%s', (url) => {
    expect(checkUrl(url)).toBe('link-local');
  });

  it('does not block 169.253 or 169.255', () => {
    expect(checkUrl('http://169.253.0.1/')).toBeNull();
    expect(checkUrl('http://169.255.0.1/')).toBeNull();
  });
});

describe('checkUrl — internal hostnames', () => {
  it.each([
    'http://printer.local/',
    'http://app.localhost/',
    'http://db.internal/',
    'http://wiki.intranet/',
    'http://router.home.arpa/',
    // A single-label host only resolves via an internal search domain.
    'http://intranet/',
    'http://wiki/',
  ])('%s', (url) => {
    expect(checkUrl(url)).toBe('internal-tld');
  });
});

describe('checkUrl — ports', () => {
  it.each([
    'http://example.com:22/',
    'http://example.com:3000/',
    'http://example.com:6379/',
    'http://example.com:11211/',
    'http://example.com:8080/',
  ])('%s', (url) => {
    expect(checkUrl(url)).toBe('port');
  });
});

describe('checkUrl — credential smuggling', () => {
  it('rejects embedded credentials', () => {
    expect(checkUrl('http://user:pass@example.com/')).toBe('credentials');
    expect(checkUrl('http://user@example.com/')).toBe('credentials');
  });

  it('still resolves the real host when a URL tries to disguise it', () => {
    // `https://example.com@127.0.0.1/` has host 127.0.0.1, not example.com.
    // Whichever rule fires first, it must not come back clean.
    expect(checkUrl('http://example.com@127.0.0.1/')).not.toBeNull();
  });
});

describe('REJECTION_REASON', () => {
  it('has readable copy for every rejection the checker can return', () => {
    const kinds: readonly UrlRejection[] = [
      'malformed',
      'scheme',
      'credentials',
      'port',
      'loopback',
      'private',
      'link-local',
      'internal-tld',
    ];
    for (const kind of kinds) {
      expect(REJECTION_REASON[kind]).toBeTypeOf('string');
      expect(REJECTION_REASON[kind].length).toBeGreaterThan(10);
    }
  });
});
