import { SetMetadata } from '@nestjs/common';
import type { AddonKey } from '@botss/shared-types';

export const REQUIRE_ADDON_KEY = 'require_addon';

/**
 * The route belongs to an add-on: when the caller's organization switched it
 * off, `AddonGuard` answers 403 `addon-disabled` before the handler runs.
 * Put it on the controller class to cover every route of a feature.
 */
export const RequireAddon = (key: AddonKey): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ADDON_KEY, key);
