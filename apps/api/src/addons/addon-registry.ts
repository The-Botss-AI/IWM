import {
  ADDON_KEYS,
  ADDON_SETTINGS_SCHEMAS,
  type AddonField,
  type AddonKey,
  type AddonSettingsMap,
} from '@botss/shared-types';

import { resolveHrConfig } from './hr-config';

/**
 * The add-on registry: every optional feature an organization can switch off.
 * One entry per add-on, with its settings schema (ADDON_SETTINGS_SCHEMAS in
 * @botss/shared-types), which settings fields are secret, and when it counts
 * as configured.
 *
 * Defaults: every add-on is ON unless an organization admin switched it off,
 * except `ai`, which is reserved and OFF until an admin turns it on. A missing
 * OrganizationAddon row means "default", so organizations that existed before
 * add-ons keep everything they use today.
 *
 * Single source of truth: an add-on never copies a value that already lives
 * somewhere else. Mail reads the organization's mail server settings
 * (OrganizationMailConfig, Settings > Organization email); cPanel uses the
 * platform server from env. Only values stored nowhere else go into the
 * add-on's own settings.
 */

type Env = Record<string, string | undefined>;

export interface AddonContext<K extends AddonKey = AddonKey> {
  organizationId: string;
  isRoot: boolean;
  /** This add-on's own stored settings, decrypted and validated. */
  settings: AddonSettingsMap[K];
  /** Existing per-organization settings that add-ons read (never copy). */
  existing: { hasMailConfig: boolean };
  env: Env;
}

export interface AddonStatus {
  configured: boolean;
  reason: string | null;
}

export interface AddonDefinition<K extends AddonKey = AddonKey> {
  key: K;
  name: string;
  description: string;
  defaultEnabled: boolean;
  /** Settings fields. `type: 'secret'` marks a secret: write only. */
  fields: AddonField[];
  /** The existing settings page this add-on reads, if any. */
  settingsHref: string | null;
  status(ctx: AddonContext<K>): AddonStatus;
}

function envSet(env: Env, ...names: string[]): boolean {
  return names.every((n) => (env[n] ?? '').trim() !== '');
}

function field(
  key: string,
  label: string,
  type: AddonField['type'],
  extra: { help?: string; placeholder?: string } = {},
): AddonField {
  return { key, label, type, help: extra.help ?? null, placeholder: extra.placeholder ?? null };
}

const mail: AddonDefinition<'mail'> = {
  key: 'mail',
  name: 'Mail',
  description:
    'The Mail tab: people connect IMAP/SMTP mailboxes and read and send mail in the app.',
  defaultEnabled: true,
  fields: [],
  settingsHref: '/settings/organization-mail',
  status: ({ existing }) => ({
    // Works with no settings at all: everyone adds their own mailbox.
    configured: true,
    reason: existing.hasMailConfig
      ? 'Uses your organization mail server from Organization email.'
      : 'People add their own mailboxes. Set an organization mail server under Organization email to send invitations from your own address.',
  }),
};

const cpanel: AddonDefinition<'cpanel'> = {
  key: 'cpanel',
  name: 'cPanel mailboxes',
  description:
    'Creates and re-passwords mailboxes on the platform cPanel mail server when admins add people.',
  defaultEnabled: true,
  fields: [],
  settingsHref: null,
  status: ({ isRoot, env }) => {
    if (!isRoot) {
      return {
        configured: false,
        reason:
          'Mailbox provisioning uses the platform mail server, so it is only available to the platform organization.',
      };
    }
    const ok = envSet(env, 'CPANEL_HOST', 'CPANEL_USER', 'CPANEL_API_TOKEN', 'CPANEL_DOMAIN');
    return {
      configured: ok,
      reason: ok
        ? `Provisions mailboxes on ${env.CPANEL_DOMAIN?.trim()}.`
        : 'The server needs CPANEL_HOST, CPANEL_USER, CPANEL_API_TOKEN and CPANEL_DOMAIN.',
    };
  },
};

// Polar and Twilio are not built yet: no settings fields and never
// configured. Settings an organization already stored stay untouched.
const polar: AddonDefinition<'polar'> = {
  key: 'polar',
  name: 'Polar payments',
  description: 'Take card payments for invoices through Polar.',
  defaultEnabled: true,
  fields: [],
  settingsHref: null,
  status: () => ({ configured: false, reason: 'Not available yet.' }),
};

const twilio: AddonDefinition<'twilio'> = {
  key: 'twilio',
  name: 'Twilio SMS and calls',
  description: 'Send SMS and make phone calls through your Twilio account.',
  defaultEnabled: true,
  fields: [],
  settingsHref: null,
  status: () => ({ configured: false, reason: 'Not available yet.' }),
};

const livekit: AddonDefinition<'livekit'> = {
  key: 'livekit',
  name: 'Video and voice calls',
  description: 'Calls, voice channels and screen sharing in Chat, through LiveKit.',
  defaultEnabled: true,
  fields: [
    field('url', 'Server address', 'url', {
      placeholder: 'wss://livekit.example.com',
      help: 'Leave all three blank to use the server default.',
    }),
    field('apiKey', 'API key', 'text'),
    field('apiSecret', 'API secret', 'secret'),
  ],
  settingsHref: null,
  status: ({ settings, env }) => {
    if (settings.url && settings.apiKey && settings.apiSecret) {
      return { configured: true, reason: 'Uses your own LiveKit server.' };
    }
    if (envSet(env, 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')) {
      return { configured: true, reason: 'Uses the server LiveKit.' };
    }
    return {
      configured: false,
      reason:
        'Add your LiveKit server, or ask the platform to set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.',
    };
  },
};

const hr: AddonDefinition<'hr'> = {
  key: 'hr',
  name: 'HR',
  description: 'Leave, attendance, holidays, payroll and payslips, and timesheet warnings.',
  defaultEnabled: true,
  fields: [
    field('timesheetWarningsEnabled', 'Timesheet warnings', 'boolean', {
      help: 'Message staff and HR when someone misses timesheets for 3 working days in a row.',
    }),
    field('timesheetSenderEmail', 'Warnings sent from', 'email', {
      help: 'A staff account in your organization, for example your HR account.',
    }),
    field('timesheetEmailDomain', 'Staff email domain', 'domain', {
      help: 'Only staff on this domain are checked. Leave blank to check everyone.',
    }),
    field('payslipSignatoryName', 'Payslip signatory', 'text', { placeholder: 'Full name' }),
    field('payslipSignatoryTitle', 'Signatory title', 'text', {
      placeholder: 'Chief Executive Officer',
    }),
  ],
  settingsHref: null,
  status: ({ settings, isRoot, env }) => {
    const cfg = resolveHrConfig({ isRoot, settings, env });
    const warnings = cfg.timesheetWarnings
      ? `Timesheet warnings are sent from ${cfg.timesheetWarnings.senderEmail}${
          cfg.source.timesheetWarnings === 'server' ? ' (server default)' : ''
        }.`
      : 'Timesheet warnings are off.';
    const signatory = cfg.signatory
      ? ` Payslips are signed by ${cfg.signatory.name}${cfg.source.signatory === 'server' ? ' (server default)' : ''}.`
      : ' Payslips have no signatory.';
    // Leave, attendance and payroll need no settings.
    return { configured: true, reason: warnings + signatory };
  },
};

const ai: AddonDefinition<'ai'> = {
  key: 'ai',
  name: 'AI assistants',
  description: 'Reserved for connecting AI assistants through the API and MCP. Not available yet.',
  defaultEnabled: false,
  fields: [],
  settingsHref: null,
  status: () => ({ configured: false, reason: 'Not available yet.' }),
};

export const ADDON_REGISTRY: { [K in AddonKey]: AddonDefinition<K> } = {
  mail,
  cpanel,
  polar,
  twilio,
  livekit,
  hr,
  ai,
};

export function addonDefinition<K extends AddonKey>(key: K): AddonDefinition<K> {
  return ADDON_REGISTRY[key];
}

export function secretFields(key: AddonKey): string[] {
  return ADDON_REGISTRY[key].fields.filter((f) => f.type === 'secret').map((f) => f.key);
}

/** Parse stored settings for `key`; anything invalid or unknown is dropped. */
export function parseStoredSettings<K extends AddonKey>(key: K, raw: unknown): AddonSettingsMap[K] {
  const schema = ADDON_SETTINGS_SCHEMAS[key];
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data as AddonSettingsMap[K];
  // Keep the fields that still validate one by one (a schema tightened later
  // must not wipe the rest).
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const one = schema.safeParse({ [k]: v });
      if (one.success) Object.assign(out, one.data);
    }
  }
  return out as AddonSettingsMap[K];
}

export const ALL_ADDON_KEYS: readonly AddonKey[] = ADDON_KEYS;
