import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';

import { DOMAIN_VERIFICATION_PREFIX } from '@botss/shared-types';

/** Resolves the TXT records of a name: each record is its string chunks. */
export type TxtResolver = (domain: string) => Promise<string[][]>;

/** Nest token for swapping the resolver (the check script mocks DNS). */
export const DNS_TXT_RESOLVER = Symbol('DNS_TXT_RESOLVER');

const LOOKUP_TIMEOUT_MS = 5000;

export class DnsLookupTimeout extends Error {
  constructor() {
    super('DNS lookup timed out');
    this.name = 'DnsLookupTimeout';
  }
}

/** Real DNS, with a per-try timeout and an overall cap. */
export const systemTxtResolver: TxtResolver = (domain) => {
  const resolver = new Resolver({ timeout: 2000, tries: 2 });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      resolver.cancel();
      reject(new DnsLookupTimeout());
    }, LOOKUP_TIMEOUT_MS);
  });
  return Promise.race([resolver.resolveTxt(domain), timeout]).finally(() => clearTimeout(timer));
};

export function newVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

export function verificationTxtValue(token: string): string {
  return `${DOMAIN_VERIFICATION_PREFIX}${token}`;
}

/** Whether any TXT record (chunks joined) is exactly the expected value. */
export function txtRecordsProve(records: string[][], token: string): boolean {
  const expected = verificationTxtValue(token);
  return records.some((chunks) => chunks.join('').trim() === expected);
}
