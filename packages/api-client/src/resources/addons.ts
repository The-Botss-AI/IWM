import {
  addonListResponseSchema,
  addonViewSchema,
  addOrganizationDomainSchema,
  organizationDomainListResponseSchema,
  organizationDomainOkSchema,
  organizationDomainSchema,
  platformAddonListResponseSchema,
  type AddonKey,
  type AddonListResponse,
  type AddonView,
  type AddOrganizationDomainInput,
  type OrganizationDomain,
  type OrganizationDomainListResponse,
  type PlatformAddonListResponse,
  type UpdateAddonInput,
} from '@botss/shared-types';

import type { HttpClient } from '../client.js';

/** Add-ons of the caller's organization. */
export class AddonsResource {
  constructor(private readonly http: HttpClient) {}

  /** Every add-on with its state; settings only for company settings managers. */
  list(): Promise<AddonListResponse> {
    return this.http.get('/addons', addonListResponseSchema);
  }

  /** Switch an add-on and/or change its settings (company `org.settings`). */
  update(key: AddonKey, input: UpdateAddonInput): Promise<AddonView> {
    return this.http.put(`/addons/${encodeURIComponent(key)}`, addonViewSchema, input);
  }

  /** SUPER_ADMIN only: which add-ons an organization has on. Never settings. */
  forOrganization(orgId: string): Promise<PlatformAddonListResponse> {
    return this.http.get(
      `/organizations/${encodeURIComponent(orgId)}/addons`,
      platformAddonListResponseSchema,
    );
  }
}

/** Email domains the caller's organization claims (company `org.settings`). */
export class OrgDomainsResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<OrganizationDomainListResponse> {
    return this.http.get('/org/domains', organizationDomainListResponseSchema);
  }

  add(input: AddOrganizationDomainInput): Promise<OrganizationDomain> {
    return this.http.post(
      '/org/domains',
      organizationDomainSchema,
      addOrganizationDomainSchema.parse(input),
    );
  }

  /** Looks up the TXT record now; a miss is a 422 problem saying what to add. */
  verify(id: string): Promise<OrganizationDomain> {
    return this.http.post(
      `/org/domains/${encodeURIComponent(id)}/verify`,
      organizationDomainSchema,
      {},
    );
  }

  remove(id: string): Promise<{ ok: true }> {
    return this.http.delete(`/org/domains/${encodeURIComponent(id)}`, organizationDomainOkSchema);
  }
}
