import { Global, Module } from '@nestjs/common';

import { OrganizationAutoRouteService } from './auto-route.service';
import { OrganizationDomainsController } from './organization-domains.controller';
import { OrganizationDomainsService } from './organization-domains.service';

/**
 * Email-domain claiming (Settings > Domains) and the routing of org-less
 * staff accounts by verified domain. Global so AuthService (global AuthModule)
 * can inject the router without importing OrganizationsModule.
 */
@Global()
@Module({
  controllers: [OrganizationDomainsController],
  providers: [OrganizationDomainsService, OrganizationAutoRouteService],
  exports: [OrganizationDomainsService, OrganizationAutoRouteService],
})
export class DomainsModule {}
