'use client';

import { PowerOff } from 'lucide-react';
import Link from 'next/link';

import { usePermissions } from '@/hooks/use-permissions';

/**
 * Shown in place of a page whose add-on the organization switched off. The
 * API refuses the page's requests with `addon-disabled` either way.
 */
export function AddonOffNotice({ name }: { name: string }) {
  const perms = usePermissions();
  return (
    <div className="border-line bg-bg-surface mx-auto max-w-lg rounded-lg border px-6 py-8 text-center">
      <PowerOff className="text-ink-muted mx-auto h-6 w-6" aria-hidden />
      <h2 className="text-ink mt-3 text-base font-semibold">{name} is turned off</h2>
      <p className="text-ink-muted mt-1 text-sm">
        {name} is turned off for your organization.{' '}
        {perms.has('org.settings') ? (
          <>
            You can turn it on in{' '}
            <Link href="/settings/addons" className="text-brand-blue font-medium hover:underline">
              Settings, Add ons
            </Link>
            .
          </>
        ) : (
          'An admin can turn it on in Settings, Add ons.'
        )}
      </p>
    </div>
  );
}
