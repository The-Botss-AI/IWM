import {
  ScreenSharePresets,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
} from 'livekit-client';

import {
  SCREEN_SHARE_QUALITY_META,
  type ScreenShareQuality,
  type ScreenShareQualityMeta,
} from './screen-share-quality-meta';

export {
  DEFAULT_SCREEN_SHARE_QUALITY,
  SCREEN_SHARE_QUALITY_ORDER,
  type ScreenShareQuality,
} from './screen-share-quality-meta';

/**
 * Screen-share quality profiles. Picking one trades sharpness against
 * smoothness; the three presets cover the common cases:
 *
 *   - `detail`      sharp text (docs / code / slides)        1080p @ 15fps
 *   - `motion`      balanced general sharing                  720p @ 30fps
 *   - `performance` smooth high-frame-rate media             1080p @ 60fps
 *
 * Each profile carries both the `getDisplayMedia` capture constraints
 * (resolution / frame rate / content hint) and the LiveKit publish options
 * (encoding bitrate + degradation strategy). They live here - not inlined in
 * the call UI - so the hook and both share surfaces stay in sync (no business
 * logic in components).
 */
export interface ScreenShareQualityProfile extends ScreenShareQualityMeta {
  /** Constraints handed to `getDisplayMedia`. */
  capture: ScreenShareCaptureOptions;
  /** Encoding + degradation options handed to LiveKit on publish. */
  publish: TrackPublishOptions;
}

export const SCREEN_SHARE_QUALITY_PROFILES: Record<ScreenShareQuality, ScreenShareQualityProfile> =
  {
    detail: {
      ...SCREEN_SHARE_QUALITY_META.detail,
      capture: {
        resolution: { width: 1920, height: 1080, frameRate: 15 },
        // 'detail' tells the encoder to preserve spatial quality over motion.
        contentHint: 'detail',
      },
      publish: {
        screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
        // Never trade resolution for frame rate - text must stay crisp.
        degradationPreference: 'maintain-resolution',
      },
    },
    motion: {
      ...SCREEN_SHARE_QUALITY_META.motion,
      capture: {
        resolution: { width: 1280, height: 720, frameRate: 30 },
        contentHint: 'motion',
      },
      publish: {
        screenShareEncoding: ScreenSharePresets.h720fps30.encoding,
        degradationPreference: 'balanced',
      },
    },
    performance: {
      ...SCREEN_SHARE_QUALITY_META.performance,
      capture: {
        resolution: { width: 1920, height: 1080, frameRate: 60 },
        contentHint: 'motion',
      },
      publish: {
        // LiveKit ships no 1080p60 preset - define a high-bitrate encoding so
        // the high frame rate isn't starved at 1080p.
        screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
        // Keep the frame rate; let resolution drop first when bandwidth is tight.
        degradationPreference: 'maintain-framerate',
      },
    },
  };
