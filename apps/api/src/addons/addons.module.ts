import { Global, Module } from '@nestjs/common';

import { AddonGuard } from './addon.guard';
import { AddonsController } from './addons.controller';
import { AddonsService } from './addons.service';

/**
 * Add-ons (optional per-organization features). Global so feature services
 * can inject `AddonsService` (as `@Optional()`) to gate work that does not go
 * through a controller, such as crons and socket handlers. `AddonGuard` is
 * registered as an app guard in AppModule, right after AuthGuard and
 * PermissionsGuard, so it always sees the resolved user.
 */
@Global()
@Module({
  controllers: [AddonsController],
  providers: [AddonsService, AddonGuard],
  exports: [AddonsService, AddonGuard],
})
export class AddonsModule {}
