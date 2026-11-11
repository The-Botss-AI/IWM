import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  addOrganizationDomainSchema,
  cuid,
  type AddOrganizationDomainInput,
  type OrganizationDomain,
  type OrganizationDomainListResponse,
} from '@botss/shared-types';

import { CurrentOrganizationId } from '../common/decorators/current-organization.decorator';
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OrganizationDomainsService } from './organization-domains.service';

/**
 * The caller's own organization's email domains. Company `org.settings` is
 * checked in the service (`@SkipPermissions`: a company permission, not a
 * CASL subject). Responses are parsed in the service.
 */
@Controller('org/domains')
export class OrganizationDomainsController {
  constructor(private readonly domains: OrganizationDomainsService) {}

  @Get()
  @SkipPermissions()
  list(
    @CurrentUser() user: AuthedUser,
    @CurrentOrganizationId() organizationId: string,
  ): Promise<OrganizationDomainListResponse> {
    return this.domains.list(user.id, organizationId);
  }

  @Post()
  @SkipPermissions()
  add(
    @CurrentUser() user: AuthedUser,
    @CurrentOrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(addOrganizationDomainSchema)) input: AddOrganizationDomainInput,
  ): Promise<OrganizationDomain> {
    return this.domains.add(user.id, organizationId, input);
  }

  @Post(':id/verify')
  @SkipPermissions()
  verify(
    @CurrentUser() user: AuthedUser,
    @CurrentOrganizationId() organizationId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ): Promise<OrganizationDomain> {
    return this.domains.verify(user.id, organizationId, id);
  }

  @Delete(':id')
  @SkipPermissions()
  remove(
    @CurrentUser() user: AuthedUser,
    @CurrentOrganizationId() organizationId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ): Promise<{ ok: true }> {
    return this.domains.remove(user.id, organizationId, id);
  }
}
