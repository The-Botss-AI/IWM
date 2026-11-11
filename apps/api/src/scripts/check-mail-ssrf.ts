/**
 * Mail SSRF guard self-checks (no network for literals, no database).
 *
 * `isPrivateIp` must classify every text spelling of an IPv6 address the
 * same way: compressed or not, leading zeros, an embedded dotted IPv4 tail,
 * brackets and zone ids. Covered:
 *  - the known bypasses (`::ffff:7f00:1`, `0:0:0:0:0:0:0:1`, ...) are refused,
 *    directly and through `resolvePublicHost`;
 *  - public IPv4 / IPv6 addresses are still accepted;
 *  - a few thousand generated private addresses, each written in several
 *    spellings, are all refused, and generated public ones all accepted;
 *  - every input the previous pattern-based guard refused is still refused.
 *
 * Run: pnpm --filter @botss/api test
 */
import assert from 'node:assert/strict';
import { isIP } from 'node:net';

import { MailHostRefusedError, isPrivateIp, resolvePublicHost } from '../mail/mail-ssrf';

let checks = 0;
const bare = (ip: string) => ip.replace(/^\[|\]$/g, '').split('%')[0]!;
function expectPrivate(ip: string, why: string): void {
  checks++;
  // Every fixture is a real literal, so it is the IP parser that refuses it.
  if (why !== 'legacy string') assert.ok(isIP(bare(ip)) !== 0, `fixture ${ip} is a valid literal`);
  assert.equal(isPrivateIp(ip), true, `${why}: ${ip} must be refused`);
}
function expectPublic(ip: string, why: string): void {
  checks++;
  assert.equal(isPrivateIp(ip), false, `${why}: ${ip} must be accepted`);
}

// 1. Reported bypasses.
const BYPASSES = [
  '::ffff:7f00:1',
  '0:0:0:0:0:0:0:1',
  '0000:0000:0000:0000:0000:0000:0000:0001',
  '0:0:0:0:0:ffff:7f00:1',
  '0:0:0:0:0:ffff:127.0.0.1',
  '::127.0.0.1',
  '::ffff:a9fe:a9fe', // 169.254.169.254 (IMDS)
  '::ffff:0a00:0001',
  '::ffff:0:127.0.0.1', // IPv4-translated
  '0:0:0:0:0:0:0:0',
  '[::1]',
  'fe80::1%eth0',
  'FEC0::1', // site-local
  'fc00::1',
  'fd12:3456::1',
  'febf:ffff::1',
  'ff02::1', // multicast
  '64:ff9b::7f00:1',
  '2002:7f00:1::1',
  '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
];
for (const ip of BYPASSES) {
  expectPrivate(ip, 'bypass');
}

// 2. Public addresses stay accepted.
const PUBLIC = [
  '8.8.8.8',
  '1.1.1.1',
  '172.15.255.255',
  '172.32.0.1',
  '100.63.255.255',
  '100.128.0.1',
  '198.17.0.1',
  '198.20.0.1',
  '223.255.255.255',
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
  '2a00:1450:4001:82a::200e',
  '2606:4700:4700:0:0:0:0:1111',
  '[2606:4700:4700::1111]',
  '::ffff:8.8.8.8',
  '::ffff:808:808',
  '0:0:0:0:0:ffff:0808:0808',
];
for (const ip of PUBLIC) expectPublic(ip, 'public');

// 3. Everything the old pattern guard refused is still refused.
const OLD_REFUSED = [
  '127.0.0.1',
  '10.1.2.3',
  '192.168.1.1',
  '169.254.169.254',
  '0.0.0.0',
  '0.1.2.3',
  '172.16.0.1',
  '172.31.255.255',
  '100.64.0.1',
  '100.127.255.255',
  '192.0.0.8',
  '198.18.0.1',
  '198.19.255.255',
  '224.0.0.1',
  '240.0.0.1',
  '255.255.255.255',
  '::1',
  '::',
  '::ffff:127.0.0.1',
  '::ffff:10.0.0.1',
  '64:ff9b::1',
  '2002::1',
  'fc::1',
  'fd::1',
  'fe80::1',
  'fe8::1',
  'fea0::1',
  'feb0::1',
  'fcff::1',
];
for (const ip of OLD_REFUSED) expectPrivate(ip, 'previously refused');
// Non-IP strings keep the old answers.
expectPrivate('127.foo', 'legacy string');
expectPublic('mail.example.com', 'legacy string');

// 4. Fuzz: private IPv4 ranges written as IPv6 in many spellings.
let seed = 0x5eed;
function rnd(n: number): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
}
const PRIVATE_V4: Array<() => number[]> = [
  () => [127, rnd(256), rnd(256), rnd(256)],
  () => [10, rnd(256), rnd(256), rnd(256)],
  () => [0, rnd(256), rnd(256), rnd(256)],
  () => [169, 254, rnd(256), rnd(256)],
  () => [172, 16 + rnd(16), rnd(256), rnd(256)],
  () => [192, 168, rnd(256), rnd(256)],
  () => [100, 64 + rnd(64), rnd(256), rnd(256)],
  () => [192, 0, 0, rnd(256)],
  () => [198, 18 + rnd(2), rnd(256), rnd(256)],
  () => [224 + rnd(32), rnd(256), rnd(256), rnd(256)],
];
const hex = (n: number, pad: boolean) => (pad ? n.toString(16).padStart(4, '0') : n.toString(16));
const upperMaybe = (s: string) => (rnd(2) ? s.toUpperCase() : s);

/** Groups as text with the longest zero run (if any) written as '::'. */
function compress(groups: number[]): string {
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === 0) j++;
    if (j - i > bestLen) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  const part = (gs: number[]) => gs.map((g) => hex(g, rnd(2) === 0)).join(':');
  if (best < 0) return part(groups);
  return `${part(groups.slice(0, best))}::${part(groups.slice(best + bestLen))}`;
}

/** Several text forms of eight groups: full, padded, compressed, dotted tail. */
function spellings(groups: number[], v4?: number[]): string[] {
  const out = [
    groups.map((g) => hex(g, false)).join(':'),
    groups.map((g) => hex(g, true)).join(':'),
    compress(groups),
  ];
  if (v4) {
    const quad = v4.join('.');
    const six = groups.slice(0, 6);
    out.push(`${six.map((g) => hex(g, false)).join(':')}:${quad}`);
    out.push(`${six.map((g) => hex(g, true)).join(':')}:${quad}`);
    const head = compress(six);
    out.push(head.endsWith('::') ? `${head}${quad}` : `${head}:${quad}`);
  }
  return out.map((s) => (rnd(3) === 0 ? `[${upperMaybe(s)}]` : upperMaybe(s)));
}

let fuzzed = 0;
for (let i = 0; i < 2000; i++) {
  const v4 = PRIVATE_V4[rnd(PRIVATE_V4.length)]!();
  const g6 = (v4[0]! << 8) | v4[1]!;
  const g7 = (v4[2]! << 8) | v4[3]!;
  expectPrivate(v4.join('.'), 'fuzz v4');
  for (const form of [
    [0, 0, 0, 0, 0, 0xffff, g6, g7], // mapped
    [0, 0, 0, 0, 0xffff, 0, g6, g7], // translated
    [0, 0, 0, 0, 0, 0, g6, g7], // compatible
  ]) {
    for (const s of spellings(form, v4)) {
      expectPrivate(s, 'fuzz embedded');
      fuzzed++;
    }
  }
}
// Native IPv6 private ranges.
const PRIVATE_V6: Array<() => number[]> = [
  () => [0xfc00 | rnd(0x200), rnd(0x10000), rnd(0x10000), 0, 0, rnd(0x10000), 0, rnd(0x10000)],
  () => [0xfe80 | rnd(0x40), 0, 0, 0, rnd(0x10000), rnd(0x10000), 0, rnd(0x10000)],
  () => [0xfec0 | rnd(0x40), 0, rnd(0x10000), 0, 0, 0, 0, 1 + rnd(0xffff)],
  () => [0xff00 | rnd(0x100), 0, 0, 0, 0, 0, 0, 1 + rnd(0xffff)],
  () => [0, 0, 0, 0, 0, 0, 0, rnd(2)],
  () => [0x64, 0xff9b, 0, 0, 0, 0, rnd(0x10000), rnd(0x10000)],
  () => [0x2002, rnd(0x10000), rnd(0x10000), 0, 0, 0, 0, 1],
];
for (let i = 0; i < 1500; i++) {
  const g = PRIVATE_V6[rnd(PRIVATE_V6.length)]!();
  for (const s of spellings(g)) {
    expectPrivate(s, 'fuzz v6');
    fuzzed++;
  }
}
// Generated public addresses stay public in every spelling.
for (let i = 0; i < 500; i++) {
  const g = [
    0x2400 + rnd(0x1c00),
    rnd(0x10000),
    rnd(0x10000),
    0,
    0,
    0,
    rnd(0x10000),
    1 + rnd(0xffff),
  ];
  for (const s of spellings(g)) {
    assert.ok(isIP(bare(s)) === 6, `fixture ${s} is valid`);
    expectPublic(s, 'fuzz public v6');
  }
  const v4 = [1 + rnd(9), rnd(256), rnd(256), 1 + rnd(254)]; // 1.x-9.x: public
  expectPublic(v4.join('.'), 'fuzz public v4');
  expectPublic(`::ffff:${v4.join('.')}`, 'fuzz public mapped');
}
assert.ok(fuzzed > 5000, `fuzzed ${fuzzed} spellings`);

// 5. resolvePublicHost refuses the bypasses before any DNS lookup.
async function asyncChecks(): Promise<void> {
  for (const ip of BYPASSES.filter((b) => !b.startsWith('[') && !b.includes('%'))) {
    const err = await resolvePublicHost(ip).then(
      () => null,
      (e: unknown) => e,
    );
    checks++;
    assert.ok(err instanceof MailHostRefusedError, `resolvePublicHost refuses ${ip}`);
  }
  for (const ip of ['8.8.8.8', '2606:4700:4700::1111']) {
    checks++;
    assert.deepEqual(await resolvePublicHost(ip), { host: ip, servername: undefined });
  }
}

asyncChecks().then(
  () => console.log(`Mail SSRF checks: all ${checks} passed.`),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
