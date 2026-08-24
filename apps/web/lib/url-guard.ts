/**
 * URL safety for caller-supplied fetch targets.
 *
 * The playground's preflight tab hands a visitor-controlled URL to a server-side
 * `fetch`. That is a textbook SSRF vector: without a guard, anyone could point
 * it at `http://169.254.169.254/latest/meta-data/` and have the server read a
 * cloud metadata endpoint on their behalf, or at `http://localhost:8080` to
 * probe whatever else is listening on the box.
 *
 * Pure, and separate from the fetch that uses it (`lib/guarded-fetch.ts`), for
 * two reasons: every rule below is unit-testable without a network, and the same
 * checks have to run again on **every redirect hop**, not just the URL a person
 * typed. A guard applied only to the initial URL is the most common way this
 * mitigation is got wrong — `redirect: 'follow'` will happily walk from a public
 * hostname to `127.0.0.1` and the guard never sees it.
 *
 * The residual limitation is stated rather than hidden: this validates literal
 * IPs and hostname shapes, not DNS results. A hostname that resolves to a
 * private address (DNS rebinding, or simply an internal name on a public TLD)
 * passes. Closing that needs resolve-then-pin-the-socket, which Node's `fetch`
 * does not expose; it is documented in `/docs/honest-limits` rather than
 * pretended away.
 */

/** Why a URL was refused. `null` means it passed. */
export type UrlRejection =
  | 'malformed'
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'internal-tld';

export const REJECTION_REASON: Record<UrlRejection, string> = {
  malformed: 'That is not a URL this can fetch. Include the scheme, e.g. https://example.com/page.',
  scheme: 'Only http:// and https:// URLs can be fetched.',
  credentials: 'Remove the username and password from the URL.',
  port: 'Only the default ports (80 and 443) are allowed.',
  loopback:
    'Loopback addresses are not reachable targets — and Bright Data cannot reach them either.',
  private: 'Private network addresses are not valid targets.',
  'link-local': 'Link-local addresses are not valid targets.',
  'internal-tld': 'Internal-only hostnames are not valid targets.',
};

/**
 * Ports the guard permits.
 *
 * An allowlist, not a denylist of "dangerous" ports. A real scraper target is
 * served on 80 or 443; anything else is far more likely to be an internal
 * service someone is trying to reach than a page worth preflighting. This also
 * happens to remove port scanning as a use for the endpoint entirely.
 */
const ALLOWED_PORTS = new Set(['', '80', '443']);

/** Hostname suffixes reserved for internal use, plus the loopback name itself. */
const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.intranet', '.home.arpa'];

function isIpv4(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function ipv4Octets(host: string): readonly number[] {
  return host.split('.').map((part) => Number.parseInt(part, 10));
}

/**
 * Classify a literal IPv4 address.
 *
 * Ranges, and why each is here:
 * - `127/8` loopback, `0/8` "this host on this network" (`0.0.0.0` reaches
 *   localhost on Linux, which is the reason a bare zero-prefix check matters).
 * - `10/8`, `172.16/12`, `192.168/16` RFC 1918 private.
 * - `169.254/16` link-local, which is where every major cloud's instance
 *   metadata service lives (`169.254.169.254`) — the single highest-value SSRF
 *   target there is.
 * - `100.64/10` CGNAT, which is also Tailscale's range: a machine on a tailnet
 *   is exactly as internal as one on a LAN.
 */
function classifyIpv4(host: string): UrlRejection | null {
  const octets = ipv4Octets(host);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return 'malformed';
  }

  const [a = 0, b = 0] = octets;

  if (a === 127 || a === 0) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private';

  return null;
}

/**
 * Expand an IPv6 address to exactly eight numeric groups.
 *
 * Necessary rather than fussy: `URL` re-serialises an IPv6 host into its
 * canonical shortest form, so the address a person typed is not the string this
 * guard sees. `::ffff:127.0.0.1` arrives as `::ffff:7f00:1` — a pattern match
 * against dotted-quad notation never fires, and a naive prefix check on the
 * text would wave the loopback address straight through.
 *
 * Handles the `::` elision and a trailing dotted-quad (which is legal input even
 * if `URL` normalises it away), and returns `null` for anything malformed.
 */
function expandIpv6(host: string): readonly number[] | null {
  let text = host;

  // A trailing `a.b.c.d` occupies the last two groups; fold it into hex first so
  // the rest of the parse only has to deal with one notation.
  const dotted = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (dotted?.[1] !== undefined && dotted[2] !== undefined) {
    const octets = ipv4Octets(dotted[2]);
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    const hi = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
    const lo = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
    text = `${dotted[1]}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16));

  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];

  if ([...head, ...tail].some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array.from({ length: fill }, () => 0), ...tail];
}

/**
 * Classify a literal IPv6 address.
 *
 * The three IPv6 forms that embed an IPv4 address all delegate back to
 * `classifyIpv4` on the low 32 bits, because they are the same addresses wearing
 * different syntax and each one is a documented SSRF bypass against guards that
 * only reason about the text:
 *
 * - `::ffff:0:0/96` — IPv4-mapped, the common one.
 * - `64:ff9b::/96` — the NAT64 well-known prefix, which in a NAT64 environment
 *   actually routes to the embedded IPv4.
 * - `::/96` — deprecated IPv4-compatible, still parsed by most stacks.
 */
function classifyIpv6(host: string): UrlRejection | null {
  const groups = expandIpv6(host.toLowerCase());
  if (groups === null) return 'malformed';

  const at = (i: number): number => groups[i] ?? 0;

  /** The low 32 bits, read as dotted-quad. */
  const embeddedIpv4 = (): string => {
    const g6 = at(6);
    const g7 = at(7);
    return `${String((g6 >> 8) & 0xff)}.${String(g6 & 0xff)}.${String((g7 >> 8) & 0xff)}.${String(g7 & 0xff)}`;
  };

  const firstFiveZero = at(0) === 0 && at(1) === 0 && at(2) === 0 && at(3) === 0 && at(4) === 0;

  if (firstFiveZero && at(5) === 0xffff) return classifyIpv4(embeddedIpv4());

  if (
    at(0) === 0x64 &&
    at(1) === 0xff9b &&
    at(2) === 0 &&
    at(3) === 0 &&
    at(4) === 0 &&
    at(5) === 0
  ) {
    return classifyIpv4(embeddedIpv4());
  }

  if (firstFiveZero && at(5) === 0) {
    // `::` (unspecified) and `::1` (loopback) both route to localhost.
    if (at(6) === 0 && (at(7) === 0 || at(7) === 1)) return 'loopback';
    return classifyIpv4(embeddedIpv4());
  }

  if ((at(0) & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 unique-local
  if ((at(0) & 0xffc0) === 0xfe80) return 'link-local'; // fe80::/10 link-local

  return null;
}

/**
 * Check one URL. Returns `null` when it is safe to fetch.
 *
 * Called for the visitor's input *and* for every redirect target.
 */
export function checkUrl(input: string): UrlRejection | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return 'malformed';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme';

  // Credentials in a URL are both a way to smuggle a different host past a
  // careless reader (`https://example.com@127.0.0.1/`) and a way to leak a
  // secret into a server log. `URL` parses the real host correctly, so this is
  // belt-and-braces — but it costs one line.
  if (url.username !== '' || url.password !== '') return 'credentials';

  if (!ALLOWED_PORTS.has(url.port)) return 'port';

  // `URL` strips the brackets from an IPv6 hostname in `.hostname` but keeps
  // them in `.host`; normalise to the bare address either way.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (host === 'localhost') return 'loopback';
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return 'internal-tld';

  if (isIpv4(host)) return classifyIpv4(host);
  if (host.includes(':')) return classifyIpv6(host);

  // A bare single-label hostname (`intranet`, `wiki`) has no public DNS meaning
  // and only resolves against an internal search domain.
  if (!host.includes('.')) return 'internal-tld';

  return null;
}

/** Convenience wrapper for call sites that only need a boolean. */
export function isFetchableUrl(input: string): boolean {
  return checkUrl(input) === null;
}
