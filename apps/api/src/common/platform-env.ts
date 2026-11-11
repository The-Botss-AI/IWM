/**
 * Platform-wide settings that come from server env, one value per
 * deployment. There is deliberately no company fallback in code: a value
 * that is not set is "not configured", and the feature that needs it says so.
 * .env.example documents each one.
 */

function envValue(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/** The protected platform admin account (`ADMIN_EMAIL`), lowercased. */
export function protectedAdminEmail(): string | null {
  return envValue('ADMIN_EMAIL')?.toLowerCase() ?? null;
}

/**
 * IMAP/SMTP host of the platform's own mail server, used when a mailbox on
 * the cPanel domain is set up automatically (`MAIL_DEFAULT_IMAP_HOST`,
 * `MAIL_DEFAULT_SMTP_HOST`). Null when either is missing.
 */
export function platformMailHosts(): { imapHost: string; smtpHost: string } | null {
  const imapHost = envValue('MAIL_DEFAULT_IMAP_HOST');
  const smtpHost = envValue('MAIL_DEFAULT_SMTP_HOST');
  return imapHost && smtpHost ? { imapHost, smtpHost } : null;
}

/**
 * Startup warnings for platform env that features need but nothing else
 * reports: logged once at boot (API and worker) so a missing value is seen
 * before someone hits the feature.
 */
export function platformEnvWarnings(): string[] {
  const warnings: string[] = [];
  if (!protectedAdminEmail()) {
    warnings.push('ADMIN_EMAIL is not set, so no platform admin account is protected.');
  }
  if (envValue('CPANEL_HOST') && !platformMailHosts()) {
    warnings.push(
      'CPANEL_HOST is set but MAIL_DEFAULT_IMAP_HOST or MAIL_DEFAULT_SMTP_HOST is not, so mailboxes set up on the cPanel domain get no mail server.',
    );
  }
  return warnings;
}
