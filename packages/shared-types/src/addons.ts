import { z } from 'zod';

/**
 * Add-ons: optional features an organization can switch off, each with its
 * own settings. The registry (names, descriptions, which fields are secret,
 * when an add-on counts as configured) lives in apps/api/src/addons; this file
 * holds the wire schemas and the per add-on settings schemas both sides share.
 *
 * Rule that must not erode: an organization with no stored row for an add-on
 * gets that add-on's default, which is ON for every add-on except `ai`. That
 * is how organizations created before add-ons keep everything working with no
 * admin action and no data migration.
 */
export const ADDON_KEYS = ['mail', 'cpanel', 'polar', 'twilio', 'livekit', 'hr', 'ai'] as const;
export const addonKeySchema = z.enum(ADDON_KEYS);
export type AddonKey = z.infer<typeof addonKeySchema>;

/** A DNS name: lowercased, trailing dot dropped, at least one dot. */
export const domainNameSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\.$/, '') : v),
  z
    .string()
    .min(3)
    .max(253)
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/,
      'Enter a domain such as example.com',
    ),
);

const emailValue = z.string().trim().toLowerCase().email().max(255);

/**
 * Settings each add-on stores in `OrganizationAddon.settingsCiphertext`. Only
 * values that live nowhere else belong here: mail reads the organization's
 * existing mail server settings (Organization email), and cPanel uses the
 * platform server configured in env.
 */
export const mailAddonSettingsSchema = z.object({}).strict();
export const cpanelAddonSettingsSchema = z.object({}).strict();
export const aiAddonSettingsSchema = z.object({}).strict();

export const polarAddonSettingsSchema = z
  .object({
    /** Secret. */
    accessToken: z.string().trim().min(1).max(500).optional(),
    /** Secret. */
    webhookSecret: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const twilioAddonSettingsSchema = z
  .object({
    accountSid: z
      .string()
      .trim()
      .regex(/^AC[0-9a-fA-F]{32}$/, 'An Account SID starts with AC followed by 32 characters')
      .optional(),
    /** Secret. */
    authToken: z.string().trim().min(1).max(200).optional(),
    fromNumber: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{6,14}$/, 'Use the international format, for example +14155550100')
      .optional(),
  })
  .strict();

export const livekitAddonSettingsSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(500)
      .regex(/^wss:\/\/[^\s]+$/, 'Use the wss:// address of your LiveKit server')
      .optional(),
    apiKey: z.string().trim().min(1).max(200).optional(),
    /** Secret. */
    apiSecret: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const hrAddonSettingsSchema = z
  .object({
    /** Daily timesheet warnings (missed timesheets for 3, 6, 9... working days). */
    timesheetWarningsEnabled: z.boolean().optional(),
    /** The staff account the warnings are sent from, in this organization. */
    timesheetSenderEmail: emailValue.optional(),
    /** Only staff whose email is on this domain are checked. Blank: everyone. */
    timesheetEmailDomain: domainNameSchema.optional(),
    /** Who signs this organization's payslips. */
    payslipSignatoryName: z.string().trim().min(1).max(120).optional(),
    payslipSignatoryTitle: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type PolarAddonSettings = z.infer<typeof polarAddonSettingsSchema>;
export type TwilioAddonSettings = z.infer<typeof twilioAddonSettingsSchema>;
export type LivekitAddonSettings = z.infer<typeof livekitAddonSettingsSchema>;
export type HrAddonSettings = z.infer<typeof hrAddonSettingsSchema>;

export const ADDON_SETTINGS_SCHEMAS = {
  mail: mailAddonSettingsSchema,
  cpanel: cpanelAddonSettingsSchema,
  polar: polarAddonSettingsSchema,
  twilio: twilioAddonSettingsSchema,
  livekit: livekitAddonSettingsSchema,
  hr: hrAddonSettingsSchema,
  ai: aiAddonSettingsSchema,
} as const satisfies Record<AddonKey, z.ZodType>;

export type AddonSettingsMap = {
  [K in AddonKey]: z.infer<(typeof ADDON_SETTINGS_SCHEMAS)[K]>;
};

export const addonFieldTypeSchema = z.enum(['text', 'secret', 'boolean', 'email', 'url', 'domain']);
export type AddonFieldType = z.infer<typeof addonFieldTypeSchema>;

/** One settings field, as the Add-ons page renders it. */
export const addonFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: addonFieldTypeSchema,
  help: z.string().nullable(),
  placeholder: z.string().nullable(),
});
export type AddonField = z.infer<typeof addonFieldSchema>;

const settingValue = z.union([z.string(), z.boolean()]);

/**
 * An add-on as the organization's own members see it. `settings` holds the
 * non-secret values and is empty unless the caller can manage company
 * settings; secret values are never sent, only which ones are set.
 */
export const addonViewSchema = z.object({
  key: addonKeySchema,
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  /** True when what the add-on needs is in place (own settings, the existing
   *  settings it reads, or the server's defaults). */
  configured: z.boolean(),
  /** Why it is or is not configured, in a sentence. */
  reason: z.string().nullable(),
  defaultEnabled: z.boolean(),
  fields: z.array(addonFieldSchema),
  settings: z.record(z.string(), settingValue),
  secretsSet: z.array(z.string()),
  /** Existing settings page this add-on reads from, if any. */
  settingsHref: z.string().nullable(),
  updatedAt: z.coerce.date().nullable(),
});
export type AddonView = z.infer<typeof addonViewSchema>;

export const addonListResponseSchema = z.object({
  items: z.array(addonViewSchema),
  /** Whether the caller may change add-ons (company `org.settings`). */
  canManage: z.boolean(),
});
export type AddonListResponse = z.infer<typeof addonListResponseSchema>;

/**
 * PUT /addons/:key. `settings` is a partial update: a field left out keeps
 * its value, `null` or an empty string clears it. Each add-on's own schema
 * (ADDON_SETTINGS_SCHEMAS) validates the result on the server.
 */
export const updateAddonSchema = z
  .object({
    enabled: z.boolean().optional(),
    settings: z
      .record(z.string(), z.union([z.string().max(2000), z.boolean(), z.null()]))
      .optional(),
  })
  .refine((v) => v.enabled !== undefined || v.settings !== undefined, {
    message: 'Change the switch or at least one setting.',
  });
export type UpdateAddonInput = z.infer<typeof updateAddonSchema>;

/** The platform operator's view of an organization: on/off and configured only. */
export const platformAddonStateSchema = z
  .object({
    key: addonKeySchema,
    enabled: z.boolean(),
    configured: z.boolean(),
  })
  .strict();
export type PlatformAddonState = z.infer<typeof platformAddonStateSchema>;

export const platformAddonListResponseSchema = z
  .object({ items: z.array(platformAddonStateSchema) })
  .strict();
export type PlatformAddonListResponse = z.infer<typeof platformAddonListResponseSchema>;

/** Prefix of the DNS TXT value that proves a domain. */
export const DOMAIN_VERIFICATION_PREFIX = 'iwm-verification=';

export const organizationDomainSchema = z.object({
  id: z.string(),
  domain: z.string(),
  verified: z.boolean(),
  verifiedAt: z.coerce.date().nullable(),
  /** Add a TXT record on this name... */
  txtRecordName: z.string(),
  /** ...with this value. */
  txtRecordValue: z.string(),
  createdAt: z.coerce.date(),
});
export type OrganizationDomain = z.infer<typeof organizationDomainSchema>;

export const organizationDomainListResponseSchema = z.object({
  items: z.array(organizationDomainSchema),
});
export type OrganizationDomainListResponse = z.infer<typeof organizationDomainListResponseSchema>;

export const addOrganizationDomainSchema = z.object({ domain: domainNameSchema });
export type AddOrganizationDomainInput = z.infer<typeof addOrganizationDomainSchema>;

export const organizationDomainOkSchema = z.object({ ok: z.literal(true) });
