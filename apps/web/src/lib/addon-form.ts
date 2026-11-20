import type { AddonView } from '@botss/shared-types';

/**
 * Form state for one add-on's settings (Settings, Add-ons). Secret fields
 * are write only: the form starts them empty, a typed value replaces the
 * stored one, and "Clear" removes it. Nothing else about a secret ever
 * reaches the browser.
 */
export type AddonFormValues = Record<string, string | boolean>;

export function initialAddonValues(addon: AddonView): AddonFormValues {
  const values: AddonFormValues = {};
  for (const f of addon.fields) {
    const current = addon.settings[f.key];
    if (f.type === 'boolean') values[f.key] = current === true;
    else if (f.type === 'secret') values[f.key] = '';
    else values[f.key] = typeof current === 'string' ? current : '';
  }
  return values;
}

/**
 * The partial update for PUT /addons/:key: only fields the admin touched and
 * changed. `null` clears a value. Returns null when nothing changed. Leaving
 * a field untouched matters: a stored value (even `false`) can switch off a
 * server default, so a field is only ever written when someone changed it.
 */
export function buildAddonSettingsPatch(
  addon: AddonView,
  values: AddonFormValues,
  touched: ReadonlySet<string>,
  clearedSecrets: ReadonlySet<string>,
): Record<string, string | boolean | null> | null {
  const patch: Record<string, string | boolean | null> = {};
  for (const f of addon.fields) {
    const value = values[f.key];
    if (!touched.has(f.key) && !clearedSecrets.has(f.key)) continue;
    if (f.type === 'secret') {
      const typed = typeof value === 'string' ? value.trim() : '';
      if (typed) patch[f.key] = typed;
      else if (clearedSecrets.has(f.key) && addon.secretsSet.includes(f.key)) patch[f.key] = null;
      continue;
    }
    if (f.type === 'boolean') {
      const next = value === true;
      const current = addon.settings[f.key] === true;
      const stored = addon.settings[f.key] !== undefined;
      if (next !== current || !stored) patch[f.key] = next;
      continue;
    }
    const next = typeof value === 'string' ? value.trim() : '';
    const current =
      typeof addon.settings[f.key] === 'string' ? (addon.settings[f.key] as string) : '';
    if (next !== current) patch[f.key] = next === '' ? null : next;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Input type for a non-secret, non-boolean field. */
export function addonInputType(
  type: AddonView['fields'][number]['type'],
): 'text' | 'email' | 'url' {
  if (type === 'email') return 'email';
  if (type === 'url') return 'url';
  return 'text';
}
