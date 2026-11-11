export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  apiBasePath: process.env.NEXT_PUBLIC_API_BASE_PATH ?? '/api/v1',
  /**
   * Public origin of the web app. Used by `metadataBase` so Next.js can
   * resolve Open Graph and Twitter image URLs to absolute links. Override
   * in production with the deployed origin (e.g. https://app.example.com).
   */
  webUrl: process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000',
  /**
   * Platform-wide values mirrored from the API env, inlined at build time.
   * Empty when not set: there is no company default in code. They only drive
   * hints in the UI; the API enforces the real rules.
   */
  /** Domain of the platform cPanel mail server (API: CPANEL_DOMAIN). */
  cpanelDomain: (process.env.NEXT_PUBLIC_CPANEL_DOMAIN ?? '').trim().toLowerCase(),
  /** Cloudflare Turnstile site key for the public form bot check. Empty disables it. */
  turnstileSiteKey: (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim(),
  /** The protected platform admin account (API: ADMIN_EMAIL). */
  adminEmail: (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? '').trim().toLowerCase(),
  /** Prefilled IMAP/SMTP host when adding a mailbox (API: MAIL_DEFAULT_IMAP_HOST). */
  mailDefaultHost: (process.env.NEXT_PUBLIC_MAIL_DEFAULT_HOST ?? '').trim(),
};
