'use client';

import { Puzzle } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import type { AddonView } from '@botss/shared-types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader } from '@/components/ui/loader';
import { PasswordInput } from '@/components/ui/password-input';
import { QueryError } from '@/components/ui/query-error';
import { useAddonList, useUpdateAddon } from '@/hooks/use-addons';
import {
  addonInputType,
  buildAddonSettingsPatch,
  initialAddonValues,
  type AddonFormValues,
} from '@/lib/addon-form';
import { cn } from '@/lib/utils';

/**
 * Settings, Add-ons (company `org.settings`): switch optional features on or
 * off for the whole organization and fill in their settings. Secrets are
 * write only. The API enforces every rule; this page only edits.
 */
export function AddonsCard() {
  const list = useAddonList();

  return (
    <section className="border-line bg-bg-surface space-y-5 rounded-lg border p-5">
      <header className="flex items-start gap-3">
        <Puzzle className="text-brand-orange mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <h2 className="text-ink text-lg font-semibold">Add ons</h2>
          <p className="text-ink-muted mt-1 text-sm">
            Optional features for your whole organization. A feature that is off disappears for
            everyone and its pages and actions are refused. Turning it back on restores it as it
            was; nothing is deleted.
          </p>
        </div>
      </header>

      {list.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader size="sm" label="Loading" />
        </div>
      ) : list.isError && !list.data ? (
        <QueryError message="Couldn't load features." onRetry={() => void list.refetch()} />
      ) : (
        <ul className="space-y-3">
          {(list.data?.items ?? []).map((addon) => (
            <AddonRow key={addon.key} addon={addon} canManage={list.data?.canManage === true} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AddonRow({ addon, canManage }: { addon: AddonView; canManage: boolean }) {
  const update = useUpdateAddon();
  const [open, setOpen] = useState(false);
  const toggle = (): void => {
    update.mutate({ key: addon.key, input: { enabled: !addon.enabled } });
  };

  return (
    <li className="border-line rounded-md border">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-ink text-sm font-semibold">{addon.name}</h3>
            <Badge tone={addon.enabled ? 'success' : 'neutral'}>
              {addon.enabled ? 'On' : 'Off'}
            </Badge>
            <Badge tone={addon.configured ? 'info' : 'warning'}>
              {addon.configured ? 'Configured' : 'Not configured'}
            </Badge>
          </div>
          <p className="text-ink-muted text-xs">{addon.description}</p>
          {addon.reason ? <p className="text-ink text-xs">{addon.reason}</p> : null}
          {addon.settingsHref ? (
            <Link
              href={addon.settingsHref}
              className="text-brand-blue text-xs font-medium hover:underline"
            >
              Open the settings this add-on uses
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {canManage && addon.fields.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? 'Hide settings' : 'Settings'}
            </Button>
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={addon.enabled}
            aria-label={`${addon.name} ${addon.enabled ? 'on' : 'off'}`}
            disabled={!canManage || update.isPending}
            onClick={toggle}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              'focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              addon.enabled ? 'bg-brand-gradient' : 'bg-line-strong',
            )}
          >
            <span
              className={cn(
                'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
                addon.enabled ? 'translate-x-5' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
      </div>
      {open && canManage ? <AddonSettingsForm addon={addon} /> : null}
    </li>
  );
}

function AddonSettingsForm({ addon }: { addon: AddonView }) {
  const update = useUpdateAddon();
  const initial = useMemo(() => initialAddonValues(addon), [addon]);
  const [values, setValues] = useState<AddonFormValues>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);

  const set = (key: string, value: string | boolean): void => {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const patch = buildAddonSettingsPatch(addon, values, touched, cleared);
    if (!patch) {
      setNote('Nothing changed.');
      return;
    }
    setNote(null);
    update.mutate(
      { key: addon.key, input: { settings: patch } },
      {
        onSuccess: () => {
          setTouched(new Set());
          setCleared(new Set());
          setValues((v) => {
            const next = { ...v };
            for (const f of addon.fields) if (f.type === 'secret') next[f.key] = '';
            return next;
          });
        },
      },
    );
  };

  return (
    <form className="border-line space-y-3 border-t px-4 py-3" onSubmit={submit} noValidate>
      {addon.fields.map((f) => {
        const id = `addon-${addon.key}-${f.key}`;
        if (f.type === 'boolean') {
          return (
            <div key={f.key} className="flex items-start gap-2">
              <Checkbox
                id={id}
                checked={values[f.key] === true}
                onCheckedChange={(v) => set(f.key, v === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor={id}>{f.label}</Label>
                {f.help ? <p className="text-ink-muted text-xs">{f.help}</p> : null}
              </div>
            </div>
          );
        }
        const value = typeof values[f.key] === 'string' ? (values[f.key] as string) : '';
        if (f.type === 'secret') {
          const saved = addon.secretsSet.includes(f.key) && !cleared.has(f.key);
          return (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={id}>{f.label}</Label>
              <div className="flex items-center gap-2">
                <PasswordInput
                  id={id}
                  autoComplete="new-password"
                  value={value}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={saved ? 'Saved. Type a new value to replace it.' : 'Not set'}
                />
                {saved ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCleared((c) => new Set(c).add(f.key))}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              {cleared.has(f.key) ? (
                <p className="text-ink-muted text-xs">Removed when you save.</p>
              ) : f.help ? (
                <p className="text-ink-muted text-xs">{f.help}</p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={id}>{f.label}</Label>
            <Input
              id={id}
              type={addonInputType(f.type)}
              value={value}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder ?? undefined}
            />
            {f.help ? <p className="text-ink-muted text-xs">{f.help}</p> : null}
          </div>
        );
      })}
      {note ? <p className="text-ink-muted text-xs">{note}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}
