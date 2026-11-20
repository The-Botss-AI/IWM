import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  addonKeySchema,
  updateAddonSchema,
  type AddonKey,
  type AddonListResponse,
  type AddonView,
  type UpdateAddonInput,
} from '@botss/shared-types';

import { CurrentOrganizationId } from '../common/decorators/current-organization.decorator';
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AddonsService } from './addons.service';

/**
 * The caller's own organization's add-ons. Everyone in the organization may
 * read the list (the apps hide what is switched off); settings values are
 * included only for company `org.settings`, which is also what PUT needs
 * (checked in the service, `@SkipPermissions` because it is a company
 * permission, not a CASL subject). Responses are parsed in the service.
 */
@Controller('addons')
export class AddonsController {
  constructor(private readonly addons: AddonsService) {}

  @Get()
  @SkipPermissions()
  list(
    @CurrentUser() user: AuthedUser,
    @CurrentOrganizationId() organizationId: string,
  ): Promise<AddonListResponse> {
    return this.addons.list(user.id, organizationId);
  }

  @Put(':key')
  @SkipPermissions()
  update(
    @CurrentUser() user: AuthedUser,
    @CurrentOrganizationId() organizationId: string,
    @Param('key', new ZodValidationPipe(addonKeySchema)) key: AddonKey,
    @Body(new ZodValidationPipe(updateAddonSchema)) input: UpdateAddonInput,
  ): Promise<AddonView> {
    return this.addons.update(user.id, organizationId, key, input);
  }
}
