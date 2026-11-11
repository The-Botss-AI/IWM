'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { AddonKey, AddOrganizationDomainInput, UpdateAddonInput } from '@botss/shared-types';

import { useSessionContext } from '@/components/auth/session-gate';
import { getApi } from '@/lib/api';

/**
 * Add-ons of the signed-in user's organization. `isOn(key)` drives what the
 * apps show; the API is authoritative and refuses a switched-off add-on with
 * 403 `addon-disabled` either way. While the list is loading, or when it
 * could not be loaded, everything counts as on, which is also every
 * organization's default, so nothing flickers away or disappears on a
 * network error.
 */

const addonsKey = ['addons'] as const;
const domainsKey = ['org', 'domains'] as const;

/** Defaults while the list is not there yet; matches the server registry. */
const DEFAULT_ON: Record<AddonKey, boolean> = {
  mail: true,
  cpanel: true,
  polar: true,
  twilio: true,
  livekit: true,
  hr: true,
  ai: false,
};

export function useAddonList() {
  const session = useSessionContext();
  // Staff only: client-portal accounts have no organization add-ons.
  const signedIn = !!session.data?.user && session.data.user.accountType !== 'CLIENT';
  return useQuery({
    queryKey: addonsKey,
    queryFn: () => getApi().addons.list(),
    enabled: signedIn,
    staleTime: 60_000,
    meta: { silentError: true },
  });
}

export interface AddonsView {
  isOn: (key: AddonKey) => boolean;
  loading: boolean;
}

export function useAddons(): AddonsView {
  const list = useAddonList();
  const items = list.data?.items;
  const isOn = useCallback(
    (key: AddonKey) => items?.find((a) => a.key === key)?.enabled ?? DEFAULT_ON[key],
    [items],
  );
  return { isOn, loading: list.isLoading };
}

export function useUpdateAddon() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't save the feature", successMessage: 'Feature saved' },
    mutationFn: ({ key, input }: { key: AddonKey; input: UpdateAddonInput }) =>
      getApi().addons.update(key, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: addonsKey }),
  });
}

export function useOrgDomains(enabled = true) {
  return useQuery({
    queryKey: domainsKey,
    queryFn: () => getApi().orgDomains.list(),
    enabled,
    staleTime: 15_000,
  });
}

export function useAddOrgDomain(options: { onSuccess?: () => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't add the domain", successMessage: 'Domain added' },
    mutationFn: (input: AddOrganizationDomainInput) => getApi().orgDomains.add(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: domainsKey });
      options.onSuccess?.();
    },
  });
}

export function useVerifyOrgDomain() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't verify the domain", successMessage: 'Domain verified' },
    mutationFn: (id: string) => getApi().orgDomains.verify(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: domainsKey }),
  });
}

export function useRemoveOrgDomain() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't remove the domain", successMessage: 'Domain removed' },
    mutationFn: (id: string) => getApi().orgDomains.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: domainsKey }),
  });
}
