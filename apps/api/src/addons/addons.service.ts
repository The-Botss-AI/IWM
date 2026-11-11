import { z } from 'zod';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  ADDON_SETTINGS_SCHEMAS,
  addonListResponseSchema,
  addonViewSchema,
  platformAddonListResponseSchema,
  type AddonKey,
  type AddonListResponse,
  type AddonSettingsMap,
  type AddonView,
  type LivekitAddonSettings,
  type PlatformAddonListResponse,
  type UpdateAddonInput,
} from '@botss/shared-types';

import { AuditLogService } from '../audit-log/audit-log.service';
import { userHasCompanyPermission } from '../common/permissions/effective-permissions';
import { forgetRequestMemo, isSupportRequest, requestMemo } from '../common/request-context';
import { userOrgId } from '../common/tenant-scope';
import { MailCryptoService } from '../mail/mail-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { supportReadOnly } from '../support/support-rules';
import { addonDisabled, addonsForbidden } from './addon-errors';
import {
  ALL_ADDON_KEYS,
  addonDefinition,
  parseStoredSettings,
  secretFields,
  type AddonContext,
  type AddonDefinition,
} from './addon-registry';
import { resolveHrConfig, type HrConfig } from './hr-config';

interface AddonRow {
  key: string;
  enabled: boolean;
  settingsCiphertext: string | null;
  updatedAt: Date;
}

interface OrgInfo {
  isRoot: boolean;
  hasMailConfig: boolean;
}

export interface AddonState {
  key: AddonKey;
  enabled: boolean;
  /** True when the organization has its own row (an admin changed it). */
  customized: boolean;
}

/**
 * Resolves and changes add-ons for an organization.
 *
 * `state(orgId, key)` is the stored row if there is one, otherwise the
 * registry default (ON for everything but `ai`). Nothing is ever written on a
 * read, and reads never touch the settings tables add-ons borrow from. Rows
 * are cached per request (`requestMemo`), so a guard and a service asking in
 * the same request cost one query.
 *
 * Settings are stored as one AES-256-GCM blob (MAIL_ENCRYPTION_KEY, the same
 * key as mailbox passwords) and only non-secret values are ever returned, to
 * company settings managers of the organization itself. Platform operators
 * get on/off and configured only.
 */
@Injectable()
export class AddonsService {
  private readonly logger = new Logger(AddonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MailCryptoService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  // ---------------------------------------------------------------- reads

  private rows(organizationId: string): Promise<AddonRow[]> {
    return requestMemo(`addons:rows:${organizationId}`, () =>
      this.prisma.client.organizationAddon.findMany({
        where: { organizationId },
        select: { key: true, enabled: true, settingsCiphertext: true, updatedAt: true },
      }),
    );
  }

  private orgInfo(organizationId: string): Promise<OrgInfo | null> {
    return requestMemo(`addons:org:${organizationId}`, async () => {
      const org = await this.prisma.client.organization.findFirst({
        where: { id: organizationId },
        select: { isRoot: true, mailConfig: { select: { id: true } } },
      });
      return org ? { isRoot: org.isRoot, hasMailConfig: org.mailConfig !== null } : null;
    });
  }

  private decode<K extends AddonKey>(key: K, row: AddonRow | undefined): AddonSettingsMap[K] {
    if (!row?.settingsCiphertext) return parseStoredSettings(key, {});
    try {
      const json = this.crypto.decrypt(Buffer.from(row.settingsCiphertext, 'base64'));
      return parseStoredSettings(key, JSON.parse(json) as unknown);
    } catch (err) {
      // A rotated key or a damaged row must not break the feature: act as if
      // the add-on had no own settings, and say so in the log (never the value).
      this.logger.error(
        `Add-on settings unreadable key=${key} error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return parseStoredSettings(key, {});
    }
  }

  async state(organizationId: string, key: AddonKey): Promise<AddonState> {
    const row = (await this.rows(organizationId)).find((r) => r.key === key);
    return {
      key,
      enabled: row ? row.enabled : addonDefinition(key).defaultEnabled,
      customized: row !== undefined,
    };
  }

  async isEnabled(organizationId: string, key: AddonKey): Promise<boolean> {
    return (await this.state(organizationId, key)).enabled;
  }

  /** Throws `addon-disabled` when the organization switched `key` off. No org: allowed. */
  async assertEnabled(organizationId: string | null | undefined, key: AddonKey): Promise<void> {
    if (!organizationId) return;
    if (!(await this.isEnabled(organizationId, key)))
      throw addonDisabled(addonDefinition(key).name);
  }

  async assertEnabledForUser(userId: string, key: AddonKey): Promise<void> {
    await this.assertEnabled(await userOrgId(this.prisma, userId), key);
  }

  /** The organization's own stored settings for `key` (server side only). */
  async settings<K extends AddonKey>(organizationId: string, key: K): Promise<AddonSettingsMap[K]> {
    const row = (await this.rows(organizationId)).find((r) => r.key === key);
    return this.decode(key, row);
  }

  /** HR add-on behaviour: timesheet warnings and payslip signatory. */
  async hrConfig(organizationId: string): Promise<HrConfig> {
    const [info, settings] = await Promise.all([
      this.orgInfo(organizationId),
      this.settings(organizationId, 'hr'),
    ]);
    return resolveHrConfig({ isRoot: info?.isRoot === true, settings, env: process.env });
  }

  /** The organization's own LiveKit server, when all three values are set. */
  async livekitCredentials(
    organizationId: string,
  ): Promise<{ url: string; apiKey: string; apiSecret: string } | null> {
    const s: LivekitAddonSettings = await this.settings(organizationId, 'livekit');
    return s.url && s.apiKey && s.apiSecret
      ? { url: s.url, apiKey: s.apiKey, apiSecret: s.apiSecret }
      : null;
  }

  private context<K extends AddonKey>(
    organizationId: string,
    info: OrgInfo,
    key: K,
    row: AddonRow | undefined,
  ): AddonContext<K> {
    return {
      organizationId,
      isRoot: info.isRoot,
      settings: this.decode(key, row),
      existing: { hasMailConfig: info.hasMailConfig },
      env: process.env,
    };
  }

  private buildView(
    organizationId: string,
    info: OrgInfo,
    key: AddonKey,
    row: AddonRow | undefined,
    canManage: boolean,
  ): AddonView {
    const def: AddonDefinition = addonDefinition(key);
    const ctx = this.context(organizationId, info, key, row);
    const status = def.status(ctx);
    const secrets = secretFields(key);
    const stored = ctx.settings as Record<string, string | boolean | undefined>;
    // Only fields the add-on still offers are shown: a value stored for a
    // field that was withdrawn (Polar, Twilio) stays stored but is not sent.
    const offered = new Set(def.fields.map((f) => f.key));
    const settings: Record<string, string | boolean> = {};
    const secretsSet: string[] = [];
    if (canManage) {
      for (const [k, v] of Object.entries(stored)) {
        if (v === undefined || !offered.has(k)) continue;
        if (secrets.includes(k)) secretsSet.push(k);
        else settings[k] = v;
      }
    }
    return addonViewSchema.parse({
      key,
      name: def.name,
      description: def.description,
      enabled: row ? row.enabled : def.defaultEnabled,
      configured: status.configured,
      // The reason can quote stored settings (the HR sender, the payslip
      // signatory), so only settings managers see it.
      reason: canManage ? status.reason : null,
      defaultEnabled: def.defaultEnabled,
      fields: def.fields,
      settings,
      secretsSet,
      settingsHref: def.settingsHref,
      updatedAt: row?.updatedAt ?? null,
    });
  }

  private async canManage(actorId: string): Promise<boolean> {
    // A support session never sees an organization's settings.
    if (isSupportRequest()) return false;
    return userHasCompanyPermission(actorId, 'org.settings');
  }

  /** GET /addons: the caller's own organization. */
  async list(actorId: string, organizationId: string): Promise<AddonListResponse> {
    const [info, rows, canManage] = await Promise.all([
      this.orgInfo(organizationId),
      this.rows(organizationId),
      this.canManage(actorId),
    ]);
    if (!info) throw new NotFoundException({ title: 'Organization not found', status: 404 });
    const items = ALL_ADDON_KEYS.map((key) =>
      this.buildView(
        organizationId,
        info,
        key,
        rows.find((r) => r.key === key),
        canManage,
      ),
    );
    return addonListResponseSchema.parse({ items, canManage });
  }

  /** Platform operators: on/off and configured only, never settings. */
  async platformList(organizationId: string): Promise<PlatformAddonListResponse> {
    const [info, rows] = await Promise.all([
      this.orgInfo(organizationId),
      this.rows(organizationId),
    ]);
    if (!info) throw new NotFoundException({ title: 'Organization not found', status: 404 });
    const items = ALL_ADDON_KEYS.map((key) => {
      const row = rows.find((r) => r.key === key);
      const def: AddonDefinition = addonDefinition(key);
      return {
        key,
        enabled: row ? row.enabled : def.defaultEnabled,
        configured: def.status(this.context(organizationId, info, key, row)).configured,
      };
    });
    return platformAddonListResponseSchema.parse({ items });
  }

  // --------------------------------------------------------------- writes

  /** PUT /addons/:key. Company `org.settings` of the organization itself. */
  async update(
    actorId: string,
    organizationId: string,
    key: AddonKey,
    input: UpdateAddonInput,
  ): Promise<AddonView> {
    // AuthGuard already refuses non-GET requests in a support session and the
    // write backstop refuses the database write; refuse before either.
    if (isSupportRequest()) throw supportReadOnly();
    if (!(await this.canManage(actorId))) throw addonsForbidden();
    const def: AddonDefinition = addonDefinition(key);
    const rows = await this.rows(organizationId);
    const row = rows.find((r) => r.key === key);
    const current = { ...(this.decode(key, row) as Record<string, unknown>) };

    const changed: string[] = [];
    if (input.settings) {
      const known = new Set(def.fields.map((f) => f.key));
      for (const [field, value] of Object.entries(input.settings)) {
        if (!known.has(field)) {
          throw new BadRequestException({
            title: "Couldn't save the feature",
            status: 400,
            detail: `${def.name} has no setting called ${field}.`,
            code: 'addon-unknown-setting',
          });
        }
        const clear = value === null || (typeof value === 'string' && value.trim() === '');
        if (clear) {
          if (current[field] !== undefined) changed.push(field);
          delete current[field];
        } else if (current[field] !== value) {
          current[field] = value;
          changed.push(field);
        }
      }
    }
    const parsed = ADDON_SETTINGS_SCHEMAS[key].safeParse(current);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const label = def.fields.find((f) => f.key === String(first?.path[0] ?? ''))?.label;
      throw new BadRequestException({
        title: "Couldn't save the feature",
        status: 400,
        detail: label
          ? `${label}: ${first?.message ?? 'invalid value'}.`
          : 'One of the settings is not valid.',
        code: 'addon-invalid-settings',
        errors: z.flattenError(parsed.error as z.ZodError).fieldErrors,
      });
    }
    const settings = parsed.data as Record<string, unknown>;
    const previousEnabled = row ? row.enabled : def.defaultEnabled;
    const enabled = input.enabled ?? previousEnabled;
    const settingsCiphertext =
      Object.keys(settings).length > 0
        ? this.crypto.encrypt(JSON.stringify(settings)).toString('base64')
        : null;

    await this.prisma.client.organizationAddon.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, key, enabled, settingsCiphertext, updatedById: actorId },
      update: {
        enabled,
        ...(input.settings ? { settingsCiphertext } : {}),
        updatedById: actorId,
      },
    });
    forgetRequestMemo(`addons:rows:${organizationId}`);

    // Field names only, never a value (secret or not).
    await this.auditLog?.emit({
      organizationId,
      actorUserId: actorId,
      action: 'addon.updated',
      target: `addon:${key}`,
      metadata: { key, enabled, previousEnabled, changedSettings: changed },
    });

    const [info, fresh] = await Promise.all([
      this.orgInfo(organizationId),
      this.rows(organizationId),
    ]);
    if (!info) throw new NotFoundException({ title: 'Organization not found', status: 404 });
    return this.buildView(
      organizationId,
      info,
      key,
      fresh.find((r) => r.key === key),
      true,
    );
  }
}
