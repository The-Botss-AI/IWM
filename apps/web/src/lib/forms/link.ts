/** Link targets the server accepts in rich text (matches the editor's allowed URIs). */
export const SAFE_URI = /^(https?:\/\/|mailto:)/i;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export type LinkCheck = { ok: true; href: string } | { ok: false; error: string };

/** Trim what the person typed, add https:// when no scheme was given, and check it is allowed. */
export function normalizeLinkHref(raw: string): LinkCheck {
  const typed = raw.trim();
  if (typed === '') return { ok: false, error: 'Enter a web address.' };
  const href = HAS_SCHEME.test(typed) ? typed : `https://${typed}`;
  if (!SAFE_URI.test(href) || /\s/.test(href)) {
    return { ok: false, error: 'Use a web address (https://) or an email link (mailto:).' };
  }
  return { ok: true, href };
}
