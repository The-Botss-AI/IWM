import { Injectable, Logger } from '@nestjs/common';

import { emailDomainOf } from '../common/email-domain';
import { PrismaService } from '../prisma/prisma.service';
import { verifiedClaimOrgId } from './domain-claims';

/**
 * Places a staff account that has no organization into the organization that
 * verified its email domain through DNS (Settings > Domains). Called from
 * `AuthService.ensureBootstrapWorkspace` when an org-less staff user signs in.
 * The legacy `Organization.emailDomain` column is deliberately NOT used here:
 * before domain verification an org-less account was refused, never placed
 * into an organization by its address, and that stays true for every
 * organization that has not verified a domain.
 *
 * IMPORTANT: this routing controls ORG MEMBERSHIP ONLY. It never touches
 * `systemRole`: a routed account is a regular member until an admin of that
 * organization promotes it. It never moves an account that already has an
 * organization (admin-driven placement wins), never routes a client-portal
 * account, and only routes an address the person has verified.
 */
@Injectable()
export class OrganizationAutoRouteService {
  private readonly logger = new Logger(OrganizationAutoRouteService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The active organization that owns this email's domain, or null. */
  async resolveOrgIdForEmail(email: string): Promise<string | null> {
    const domain = emailDomainOf(email);
    if (!domain) return null;
    const orgId = await verifiedClaimOrgId(this.prisma, domain);
    if (!orgId) return null;
    const org = await this.prisma.client.organization.findFirst({
      where: { id: orgId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return org?.id ?? null;
  }

  /**
   * Attach an org-less, verified staff account to the organization its email
   * implies. Idempotent; returns the organization id it ends up in (null when
   * nothing matched or the account is not eligible).
   */
  async attachOnBootstrap(userId: string, email: string): Promise<string | null> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { organizationId: true, accountType: true, emailVerified: true },
    });
    if (!user) return null;
    if (user.organizationId) return user.organizationId;
    // Client-portal accounts have no org on purpose; a matching email domain
    // must never turn one into a member of that org.
    if (user.accountType === 'CLIENT') return null;
    // Owning the domain says nothing about an address nobody has proven.
    if (!user.emailVerified) return null;
    const orgId = await this.resolveOrgIdForEmail(email);
    if (!orgId) return null;
    const res = await this.prisma.client.user.updateMany({
      where: { id: userId, organizationId: null },
      data: { organizationId: orgId },
    });
    if (res.count === 0) return null;
    this.logger.log(`Auto-routed user ${userId} to organization ${orgId}.`);
    return orgId;
  }
}
