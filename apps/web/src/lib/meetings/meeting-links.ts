import type { MeetingLinkProvider } from '@botss/shared-types';

/** Which video provider a meeting link belongs to, by host. */
export function detectLinkProvider(url: string | null | undefined): MeetingLinkProvider | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on('meet.google.com')) return 'google-meet';
  if (on('zoom.us') || on('zoom.com')) return 'zoom';
  if (on('teams.microsoft.com') || on('teams.live.com')) return 'teams';
  if (on('webex.com')) return 'webex';
  return null;
}

export const LINK_PROVIDER_LABEL: Record<MeetingLinkProvider, string> = {
  'google-meet': 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  webex: 'Webex',
};

/** Open a link the safe way (never hands the opener to the new page). */
export function openMeetingLink(url: string): void {
  if (typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
