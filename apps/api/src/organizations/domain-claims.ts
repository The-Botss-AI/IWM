import { ForbiddenException } from '@nestjs/common';

import { emailDomainOf } from '../common/email-domain';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Who owns an email domain. Two sources, in this order:
 *
 * 1. A verified `OrganizationDomain` (DNS TXT proof, Settings > Domains).
 *    `verifiedDomain` is unique, so at most one organization has it.
 * 2. The legacy `Organization.emailDomain` column, set by a platform operator
 *    (the root organization's own domain lives there). Kept so everything
 *    that worked on it before keeps working unchanged.
 */
export async function claimingOrgIdFor(
  prisma: PrismaService,
  domain: string,
): Promise<string | null> {
  const d = domain.trim().toLowerCase();
  if (!d) return null;
  const verified = await verifiedClaimOrgId(prisma, d);
  if (verified) return verified;
  const legacy = await prisma.client.organization.findFirst({
    where: { emailDomain: d, deletedAt: null },
    select: { id: true },
  });
  return legacy?.id ?? null;
}

/** The organization that verified `domain` through DNS, if any (active orgs only). */
export async function verifiedClaimOrgId(
  prisma: PrismaService,
  domain: string,
): Promise<string | null> {
  const row = await prisma.client.organizationDomain.findFirst({
    where: {
      verifiedDomain: domain.trim().toLowerCase(),
      organization: { deletedAt: null },
    },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
}

/**
 * A new staff account on a domain another organization verified may not be
 * created here (workspace invites). Only verified domains count, so nothing
 * changes for an invite until some organization verifies the domain.
 */
export async function assertNotVerifiedElsewhere(
  prisma: PrismaService,
  organizationId: string,
  email: string,
): Promise<void> {
  const domain = emailDomainOf(email);
  if (!domain) return;
  const owner = await verifiedClaimOrgId(prisma, domain);
  if (owner && owner !== organizationId) {
    throw new ForbiddenException({
      title: 'Email domain not allowed',
      status: 403,
      detail: `Addresses on ${domain} belong to another organization.`,
      code: 'email-domain-not-allowed',
    });
  }
}
