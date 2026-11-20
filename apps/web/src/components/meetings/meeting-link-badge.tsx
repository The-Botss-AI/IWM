import { Video } from 'lucide-react';

import { detectLinkProvider, LINK_PROVIDER_LABEL } from '@/lib/meetings/meeting-links';
import { cn } from '@/lib/utils';

const PROVIDER_COLOR = {
  'google-meet': '#00897b',
  zoom: '#2d8cff',
  teams: '#5059c9',
  webex: '#07c160',
} as const;

/** Round provider mark (Meet, Zoom, Teams, Webex) or a generic video icon for any other link. */
export function MeetingProviderIcon({
  url,
  className,
}: {
  url: string | null | undefined;
  className?: string;
}) {
  const provider = detectLinkProvider(url);
  const color = provider ? PROVIDER_COLOR[provider] : '#64748b';
  const letter = provider ? LINK_PROVIDER_LABEL[provider].charAt(0) : null;
  return (
    <span
      className={cn(
        'inline-grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white',
        className,
      )}
      style={{ backgroundColor: color }}
      title={provider ? LINK_PROVIDER_LABEL[provider] : 'Video link'}
      aria-hidden
    >
      {letter ?? <Video className="h-3.5 w-3.5" />}
    </span>
  );
}

/** "Google Meet" and friends, or null for a link we do not recognize. */
export function providerName(url: string | null | undefined): string | null {
  const provider = detectLinkProvider(url);
  return provider ? LINK_PROVIDER_LABEL[provider] : null;
}
