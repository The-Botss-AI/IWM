import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * SSRF guard for user-configured mail hosts (IMAP/SMTP).
 *
 * Zod blocks literal private hostnames at input time, but a domain the
 * attacker controls can rebind to an internal IP on a later lookup. Callers
 * use `resolvePublicHost` and then connect to the RETURNED ADDRESS, with the
 * original name kept only for TLS SNI and certificate checks. Resolving and
 * then connecting by name (what `assertHostnamePublic` alone does) leaves a
 * window where a zero-TTL record answers public for the check and internal
 * for the library's own lookup a moment later.
 *
 * Refuses loopback / private / link-local / CGNAT / IMDS (169.254.169.254) /
 * benchmark / reserved / multicast ranges. IPv6 literals are parsed into
 * their eight 16-bit groups first, so every spelling of an address
 * (`::1`, `0:0:0:0:0:0:0:1`, `0000:...:0001`, `::ffff:7f00:1`,
 * `0:0:0:0:0:ffff:127.0.0.1`, `::127.0.0.1`) is classified the same way.
 * IPv4-mapped, -translated and -compatible IPv6 addresses are judged by the
 * IPv4 address they carry; NAT64, 6to4 and Teredo (which embed an IPv4
 * address) are refused outright, as is anything outside global unicast
 * 2000::/3 (unique-local, link-local, site-local, multicast, reserved).
 */
export function isPrivateIp(ip: string): boolean {
  let v = ip.trim().toLowerCase();
  // Strip IPv6 brackets and any zone id.
  v = (v.replace(/^\[/, '').replace(/\]$/, '').split('%')[0] ?? v).trim();

  const family = isIP(v);
  if (family === 4) return isPrivateIpv4(parseIpv4(v)!);
  if (family === 6) {
    const groups = parseIpv6(v);
    // isIP accepted it, so this cannot fail; refuse rather than guess if it does.
    return groups ? isPrivateIpv6(groups) : true;
  }
  return isPrivateLegacyString(v);
}

/** Dotted-quad IPv4 to four octets, or null. Expects an `isIP() === 4` string. */
function parseIpv4(v: string): [number, number, number, number] | null {
  const parts = v.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.some((o) => !Number.isInteger(o) || o > 255)) return null;
  return octets as [number, number, number, number];
}

function isPrivateIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local, IMDS
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a >= 224) return true; // multicast 224/4 and reserved 240/4
  return false;
}

/**
 * Any valid IPv6 text form to its eight 16-bit groups, or null. Handles `::`
 * compression, leading zeros and a trailing dotted IPv4 part.
 */
function parseIpv6(v: string): number[] | null {
  let text = v;
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const quad = parseIpv4(last);
    if (!quad) return null;
    tail.push((quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]);
    // Keep a trailing ':' when the IPv4 part directly follows '::'.
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]!);
  if (!head) return null;
  if (halves.length === 1) {
    const all = [...head, ...tail];
    return all.length === 8 ? all : null;
  }
  const rest = toGroups(halves[1]!);
  if (!rest) return null;
  const known = head.length + rest.length + tail.length;
  if (known > 7) return null;
  return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
}

function isPrivateIpv6(g: number[]): boolean {
  const [g0, g1, , , g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embedded = (): [number, number, number, number] => [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);

  // ::ffff:a.b.c.d (mapped) and ::ffff:0:a.b.c.d (translated): judge the IPv4.
  if (zeroTo(5) && g5 === 0xffff) return isPrivateIpv4(embedded());
  if (zeroTo(4) && g4 === 0xffff && g5 === 0) return isPrivateIpv4(embedded());
  // :: (unspecified) and ::1 (loopback).
  if (zeroTo(7) && (g7 === 0 || g7 === 1)) return true;
  // ::a.b.c.d (deprecated IPv4-compatible): judge the IPv4.
  if (zeroTo(6)) return isPrivateIpv4(embedded());
  // NAT64 64:ff9b::/96 and local-use 64:ff9b:1::/48 embed an IPv4 address.
  if (g0 === 0x64 && g1 === 0xff9b) return true;
  // 6to4 2002::/16 and Teredo 2001::/32 embed an IPv4 address.
  if (g0 === 0x2002) return true;
  if (g0 === 0x2001 && g1 === 0) return true;
  // Only global unicast 2000::/3 is public. This refuses unique-local
  // fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8
  // and the reserved/unassigned rest.
  if ((g0 & 0xe000) !== 0x2000) return true;
  return false;
}

/**
 * Pattern checks for strings that are not IP literals. Callers only pass
 * literals, but the export has always answered for arbitrary strings, so
 * that answer is kept unchanged.
 */
function isPrivateLegacyString(v: string): boolean {
  if (/^64:ff9b:/.test(v) || /^2002:/.test(v)) return true;
  if (v === '::1' || v === '::' || v === '0.0.0.0') return true;
  if (v.startsWith('127.') || v.startsWith('10.') || v.startsWith('192.168.')) return true;
  if (v.startsWith('169.254.') || v.startsWith('0.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true;
  if (v.startsWith('192.0.0.') || /^198\.1[89]\./.test(v)) return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(v)) return true;
  return false;
}

/**
 * A user- or admin-supplied mail host was refused (private address, numeric
 * host, unresolvable name). It is the caller's input that is wrong, so the
 * HTTP layer answers 400 with this message (ProblemDetailsExceptionFilter)
 * instead of a 500; queue workers see an ordinary Error, as before.
 */
export class MailHostRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailHostRefusedError';
  }
}

/**
 * Resolve `host` once, refuse if ANY answer is non-public, and return the
 * address to connect to plus the name to use for TLS SNI / certificate
 * verification. Connect with `{ host: result.host, servername: result.servername }`.
 */
export async function resolvePublicHost(
  host: string,
): Promise<{ host: string; servername: string | undefined }> {
  const trimmed = host.trim();
  if (!trimmed) throw new MailHostRefusedError('Empty hostname');

  if (isIP(trimmed)) {
    if (isPrivateIp(trimmed)) {
      throw new MailHostRefusedError(`Refusing to connect to private address ${trimmed}`);
    }
    return { host: trimmed, servername: undefined };
  }
  // Numeric-encoded IPv4 (decimal/hex) that isIP() rejects but the OS resolver
  // may still interpret as an address (e.g. 2130706433, 0x7f000001).
  if (/^(0x[0-9a-f]+|\d+)$/i.test(trimmed)) {
    throw new MailHostRefusedError(`Refusing to connect to numeric host ${trimmed}`);
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(trimmed, { all: true });
  } catch (err) {
    throw new MailHostRefusedError(`DNS lookup failed for ${trimmed}: ${(err as Error).message}`);
  }
  if (records.length === 0) {
    throw new MailHostRefusedError(`DNS lookup returned no addresses for ${trimmed}`);
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new MailHostRefusedError(
        `Hostname ${trimmed} resolves to private address ${r.address}; refusing to connect.`,
      );
    }
  }
  // Prefer IPv4: EC2 instances often have no IPv6 egress route.
  const chosen = records.find((r) => isIP(r.address) === 4) ?? records[0]!;
  return { host: chosen.address, servername: trimmed };
}

/**
 * Resolve `host` and throw if it (or any DNS answer) points at a non-public
 * address. Prefer `resolvePublicHost` and connect to the returned address;
 * this form is for verification paths that do not open a connection.
 */
export async function assertHostnamePublic(host: string): Promise<void> {
  await resolvePublicHost(host);
}
