'use client';

import { Copy, Globe } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { addOrganizationDomainSchema, type OrganizationDomain } from '@botss/shared-types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader } from '@/components/ui/loader';
import { QueryError } from '@/components/ui/query-error';
import {
  useAddOrgDomain,
  useOrgDomains,
  useRemoveOrgDomain,
  useVerifyOrgDomain,
} from '@/hooks/use-addons';
import { copyText } from '@/lib/clipboard';
import { absoluteTime } from '@/lib/time';

/**
 * Settings, Domains (company `org.settings`): claim the email domains your
 * staff use. A verified domain means people on it can only belong to this
 * organization, and nobody else can add or invite them. Proof is a DNS TXT
 * record; the API does the lookup.
 */
export function DomainsCard() {
  const domains = useOrgDomains();
  const add = useAddOrgDomain({ onSuccess: () => setDomain('') });
  const verify = useVerifyOrgDomain();
  const remove = useRemoveOrgDomain();
  const [domain, setDomain] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrganizationDomain | null>(null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const parsed = addOrganizationDomainSchema.safeParse({ domain });
    if (!parsed.success) {
      setFormError('Enter a domain such as example.com.');
      return;
    }
    setFormError(null);
    add.mutate(parsed.data);
  };

  const items = domains.data?.items ?? [];

  return (
    <section className="border-line bg-bg-surface space-y-5 rounded-lg border p-5">
      <header className="flex items-start gap-3">
        <Globe className="text-brand-orange mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <h2 className="text-ink text-lg font-semibold">Email domains</h2>
          <p className="text-ink-muted mt-1 text-sm">
            Claim the domain your team&apos;s email addresses use. Once verified, accounts on it
            belong to your organization only: no other organization can add or invite them, and a
            verified account on it that has no organization joins yours when it first signs in.
          </p>
        </div>
      </header>

      <form className="flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label htmlFor="org-domain">Domain</Label>
          <Input
            id="org-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add domain'}
        </Button>
      </form>
      {formError ? (
        <p role="alert" className="text-state-error text-sm">
          {formError}
        </p>
      ) : null}

      {domains.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader size="sm" label="Loading" />
        </div>
      ) : domains.isError && !domains.data ? (
        <QueryError message="Couldn't load email domains." onRetry={() => void domains.refetch()} />
      ) : items.length === 0 ? (
        <p className="border-line bg-bg-subtle text-ink-muted rounded-md border px-3 py-4 text-center text-xs">
          No domains yet.
        </p>
      ) : (
        <ul className="divide-line border-line divide-y rounded-md border">
          {items.map((d) => (
            <li key={d.id} className="space-y-2 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink text-sm font-medium">{d.domain}</span>
                  <Badge tone={d.verified ? 'success' : 'warning'}>
                    {d.verified ? 'Verified' : 'Not verified'}
                  </Badge>
                  {d.verifiedAt ? (
                    <span className="text-ink-muted text-xs">
                      since {absoluteTime(d.verifiedAt)}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {!d.verified ? (
                    <Button
                      size="sm"
                      onClick={() => verify.mutate(d.id)}
                      disabled={verify.isPending}
                    >
                      {verify.isPending && verify.variables === d.id ? 'Checking…' : 'Verify'}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => setRemoveTarget(d)}>
                    Remove
                  </Button>
                </div>
              </div>
              {!d.verified ? (
                <div className="bg-bg-subtle text-ink-muted space-y-1 rounded-md px-3 py-2 text-xs">
                  <p>
                    Add a <span className="text-ink font-medium">TXT</span> record on{' '}
                    <span className="text-ink font-medium">{d.txtRecordName}</span> with this value,
                    then press Verify:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="bg-bg-surface text-ink break-all rounded px-2 py-1">
                      {d.txtRecordValue}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Copy the TXT value"
                      onClick={() => void copyText(d.txtRecordValue, 'TXT value copied')}
                    >
                      <Copy className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove this domain?"
        description="Other organizations can claim it again, and accounts on it are no longer reserved for yours. Nobody is removed from your organization."
        confirmLabel="Remove domain"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={async () => {
          if (!removeTarget) return;
          await remove.mutateAsync(removeTarget.id);
          setRemoveTarget(null);
        }}
      />
    </section>
  );
}
