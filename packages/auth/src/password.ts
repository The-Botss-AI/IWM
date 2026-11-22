/**
 * Password hashing used by Better Auth's credential provider AND by the
 * workspace-invitation accept flow. Keeping a single format here means both
 * paths produce hashes that Better Auth's sign-in path will verify.
 *
 * Format: `scrypt$<saltHex>$<hashHex>` where the hash is N=16384, r=8, p=1,
 * keylen=64 - Node's `crypto.scryptSync` defaults except for `N` which we set
 * explicitly so future Node default changes don't shift the encoding.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;
const PREFIX = 'scrypt$';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return `${PREFIX}${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(hash: string, password: string): boolean {
  if (!hash.startsWith(PREFIX)) return false;
  const rest = hash.slice(PREFIX.length);
  const [saltHex, hashHex, extra] = rest.split('$');
  // Exactly the shape hashPassword writes: a salt of 16+ bytes and a 64-byte
  // key, as hex. Buffer.from(_, 'hex') silently drops invalid characters, so
  // a malformed stored hash such as `scrypt$00$zz` used to decode to an EMPTY
  // expected key - and two empty keys compare equal, so ANY password signed
  // in to that account.
  if (extra !== undefined || !saltHex || !hashHex) return false;
  if (!/^(?:[0-9a-f]{2}){16,}$/i.test(saltHex)) return false;
  if (!/^[0-9a-f]{128}$/i.test(hashHex)) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
