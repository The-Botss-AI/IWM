'use client';

import { AddonsCard } from '@/components/organization/addons-card';
import { Loader } from '@/components/ui/loader';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Settings, Add-ons: company `org.settings` only (the API enforces it; the
 * nav link is hidden for everyone else).
 */
export default function AddonsSettingsPage() {
  const perms = usePermissions();
  if (perms.checking) {
    return (
      <div className="flex justify-center py-10">
        <Loader size="sm" label="Loading" />
      </div>
    );
  }
  if (!perms.has('org.settings')) {
    return (
      <p className="border-line bg-bg-subtle text-ink-muted rounded-md border px-4 py-6 text-center text-sm">
        Only people who can manage company settings can change add-ons.
      </p>
    );
  }
  return <AddonsCard />;
}
