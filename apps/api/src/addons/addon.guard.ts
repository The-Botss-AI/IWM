import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AddonKey } from '@botss/shared-types';

import type { RequestExtensions } from '../common/guards/auth.guard';
import { AddonsService } from './addons.service';
import { REQUIRE_ADDON_KEY } from './require-addon.decorator';

/**
 * Global guard (after AuthGuard and PermissionsGuard). A route marked
 * `@RequireAddon(key)` is refused with 403 `addon-disabled` when the caller's
 * organization switched that add-on off. Unmarked routes, public routes and
 * callers without an organization pass untouched. In a support session the
 * organization is the granted one (AuthGuard sets it), so a disabled add-on
 * is closed there too.
 */
@Injectable()
export class AddonGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly addons: AddonsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const key = this.reflector.getAllAndOverride<AddonKey | undefined>(REQUIRE_ADDON_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!key) return true;
    const req = ctx.switchToHttp().getRequest<RequestExtensions>();
    await this.addons.assertEnabled(req.user?.organizationId ?? null, key);
    return true;
  }
}
