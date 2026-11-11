/**
 * LiveKit-free screen-share quality metadata: ids, menu labels and picker
 * order. UI menus import this file so they never pull `livekit-client` into
 * a bundle; the capture/publish presets live in `screen-share-quality.ts`.
 */
export type ScreenShareQuality = 'detail' | 'motion' | 'performance';

export interface ScreenShareQualityMeta {
  id: ScreenShareQuality;
  /** Menu label. */
  label: string;
  /** One-line explanation shown under the label. */
  description: string;
  /** Compact resolution/fps line (e.g. "1080p · 15fps"). */
  spec: string;
}

export const SCREEN_SHARE_QUALITY_META: Record<ScreenShareQuality, ScreenShareQualityMeta> = {
  detail: {
    id: 'detail',
    label: 'Detail / Document',
    description: 'Sharpest text for docs, code, and slides.',
    spec: '1080p · 15fps',
  },
  motion: {
    id: 'motion',
    label: 'Standard Motion',
    description: 'Balanced quality for everyday screen sharing.',
    spec: '720p · 30fps',
  },
  performance: {
    id: 'performance',
    label: 'High Performance',
    description: 'Smoothest motion for video and animation.',
    spec: '1080p · 60fps',
  },
};

/** Default profile: optimise for legible text, matching most CRM screen shares. */
export const DEFAULT_SCREEN_SHARE_QUALITY: ScreenShareQuality = 'detail';

/** Stable order for rendering the picker. */
export const SCREEN_SHARE_QUALITY_ORDER: ScreenShareQuality[] = ['detail', 'motion', 'performance'];
