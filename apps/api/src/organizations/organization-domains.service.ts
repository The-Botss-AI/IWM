import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@botss/database';
import {
  organizationDomainListResponseSchema,
  organizationDomainOkSchema,
  organizationDomainSchema,
  type AddOrganizationDomainInput,
  type OrganizationDomain,
  type OrganizationDomainListResponse,
} from '@botss/shared-types';

import { AuditLogService } from '../audit-log/audit-log.service';
import { cpanelDomain } from '../common/email-domain';
import { userHasCompanyPermission } from '../common/permissions/effective-permissions';
import { isSupportRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { supportReadOnly } from '../support/support-rules';
import { claimingOrgIdFor } from './domain-claims';
import {
  DNS_TXT_RESOLVER,
  DnsLookupTimeout,
  newVerificationToken,
  systemTxtResolver,
  txtRecordsProve,
  verificationTxtValue,
  type TxtResolver,
} from './domain-verification';

/** Most domains one organization may list. */
const MAX_DOMAINS = 20;

interface DomainRow {
  id: string;
  domain: string;
  verificationToken: string;
  verifiedAt: Date | null;
  createdAt: Date;
}

const domainSelect = {
  id: true,
  domain: true,
  verificationToken: true,
  verifiedAt: true,
  createdAt: true,
} as const;

function toView(row: DomainRow): OrganizationDomain {
  return organizationDomainSchema.parse({
    id: row.id,
    domain: row.domain,
    verified: row.verifiedAt !== null,
    verifiedAt: row.verifiedAt,
    txtRecordName: row.domain,
    txtRecordValue: verificationTxtValue(row.verificationToken),
    createdAt: row.createdAt,
  });
}

function domainTaken(domain: string): ConflictException {
  return new ConflictException({
    title: "Couldn't add the domain",
    status: 409,
    detail: `${domain} is already verified by another organization.`,
    code: 'domain-claimed',
  });
}

/**
 * Email domains an organization claims (company `org.settings`). An admin
 * adds a domain, publishes the TXT value `iwm-verification=<token>` on it and
 * asks us to verify; a DNS lookup proves it. A verified domain means staff
 * accounts on it belong to this organization only: other organizations can
 * no longer create or invite people on it (`claimingOrgIdFor`), and an
 * org-less account on it joins this organization at first sign-in
 * (`OrganizationAutoRouteService`). Only one organization can verify a domain.
 */
@Injectable()
export class OrganizationDomainsService {
  private readonly logger = new Logger(OrganizationDomainsService.name);
  private readonly resolveTxt: TxtResolver;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() @Inject(DNS_TXT_RESOLVER) resolver?: TxtResolver,
  ) {
    this.resolveTxt = resolver ?? systemTxtResolver;
  }

  private async assertManager(actorId: string, write: boolean): Promise<void> {
    if (write && isSupportRequest()) throw supportReadOnly();
    if (!(await userHasCompanyPermission(actorId, 'org.settings'))) {
      throw new ForbiddenException({
        title: 'Not allowed',
        status: 403,
        detail: 'Only people who can manage company settings can manage email domains.',
        code: 'domains-forbidden',
      });
    }
  }

  private async findOwn(
    organizationId: string,
    id: string,
  ): Promise<DomainRow & { domain: string }> {
    const row = await this.prisma.client.organizationDomain.findFirst({
      where: { id, organizationId },
      select: domainSelect,
    });
    if (!row) {
      throw new NotFoundException({
        title: 'Domain not found',
        status: 404,
        detail: 'That domain is not on this organization.',
        code: 'domain-not-found',
      });
    }
    return row;
  }

  async list(actorId: string, organizationId: string): Promise<OrganizationDomainListResponse> {
    await this.assertManager(actorId, false);
    const rows: DomainRow[] = await this.prisma.client.organizationDomain.findMany({
      where: { organizationId },
      select: domainSelect,
      orderBy: { createdAt: 'asc' },
    });
    return organizationDomainListResponseSchema.parse({ items: rows.map(toView) });
  }

  async add(
    actorId: string,
    organizationId: string,
    input: AddOrganizationDomainInput,
  ): Promise<OrganizationDomain> {
    await this.assertManager(actorId, true);
    const domain = input.domain;
    const org = await this.prisma.client.organization.findFirst({
      where: { id: organizationId },
      select: { isRoot: true },
    });
    if (!org) throw new NotFoundException({ title: 'Organization not found', status: 404 });
    const reserved = cpanelDomain();
    if (!org.isRoot && reserved && domain === reserved) {
      throw new ForbiddenException({
        title: "Couldn't add the domain",
        status: 403,
        detail: `${domain} is the platform mail domain and cannot be claimed.`,
        code: 'email-domain-not-allowed',
      });
    }
    const owner = await claimingOrgIdFor(this.prisma, domain);
    if (owner && owner !== organizationId) throw domainTaken(domain);
    const count = await this.prisma.client.organizationDomain.count({ where: { organizationId } });
    if (count >= MAX_DOMAINS) {
      throw new BadRequestException({
        title: "Couldn't add the domain",
        status: 400,
        detail: `An organization can list up to ${MAX_DOMAINS} domains. Remove one first.`,
        code: 'domain-limit',
      });
    }
    let row: DomainRow;
    try {
      row = await this.prisma.client.organizationDomain.create({
        data: { organizationId, domain, verificationToken: newVerificationToken() },
        select: domainSelect,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          title: "Couldn't add the domain",
          status: 409,
          detail: `${domain} is already on this organization.`,
          code: 'domain-exists',
        });
      }
      throw err;
    }
    await this.auditLog?.emit({
      organizationId,
      actorUserId: actorId,
      action: 'org.domain_added',
      target: `organization:${organizationId}`,
      metadata: { domain },
    });
    return toView(row);
  }

  async verify(actorId: string, organizationId: string, id: string): Promise<OrganizationDomain> {
    await this.assertManager(actorId, true);
    const row = await this.findOwn(organizationId, id);
    if (row.verifiedAt) return toView(row);
    const owner = await claimingOrgIdFor(this.prisma, row.domain);
    if (owner && owner !== organizationId) throw domainTaken(row.domain);

    let records: string[][];
    try {
      records = await this.resolveTxt(row.domain);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (err instanceof DnsLookupTimeout) {
        throw verificationFailed(
          `The DNS lookup for ${row.domain} timed out. Try again in a minute.`,
        );
      }
      if (code === 'ENODATA' || code === 'ENOTFOUND') {
        records = [];
      } else {
        this.logger.warn(`TXT lookup failed domain=${row.domain} code=${code ?? 'unknown'}`);
        throw verificationFailed(`The DNS lookup for ${row.domain} failed. Try again in a minute.`);
      }
    }
    if (!txtRecordsProve(records, row.verificationToken)) {
      throw verificationFailed(
        `No TXT record with ${verificationTxtValue(row.verificationToken)} was found on ${row.domain} yet. DNS changes can take up to an hour to show up.`,
      );
    }

    let updated: DomainRow;
    try {
      updated = await this.prisma.client.organizationDomain.update({
        where: { id: row.id },
        data: { verifiedAt: new Date(), verifiedDomain: row.domain },
        select: domainSelect,
      });
    } catch (err) {
      // `verifiedDomain` is unique: another organization verified it first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw domainTaken(row.domain);
      }
      throw err;
    }
    await this.auditLog?.emit({
      organizationId,
      actorUserId: actorId,
      action: 'org.domain_verified',
      target: `organization:${organizationId}`,
      metadata: { domain: row.domain },
    });
    return toView(updated);
  }

  async remove(actorId: string, organizationId: string, id: string): Promise<{ ok: true }> {
    await this.assertManager(actorId, true);
    const row = await this.findOwn(organizationId, id);
    await this.prisma.client.organizationDomain.deleteMany({
      where: { id: row.id, organizationId },
    });
    await this.auditLog?.emit({
      organizationId,
      actorUserId: actorId,
      action: 'org.domain_removed',
      target: `organization:${organizationId}`,
      metadata: { domain: row.domain, wasVerified: row.verifiedAt !== null },
    });
    return organizationDomainOkSchema.parse({ ok: true });
  }
}

function verificationFailed(detail: string): HttpException {
  return new HttpException(
    {
      title: "Couldn't verify the domain",
      status: 422,
      detail,
      code: 'domain-verification-failed',
    },
    422,
  );
}
