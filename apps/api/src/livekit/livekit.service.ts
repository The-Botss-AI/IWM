import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';
import type { LivekitTokenRequest, LivekitTokenResponse } from '@botss/shared-types';

import { AddonsService } from '../addons/addons.service';
import { assertNotBlockedInCrossOrgDm, spansOrganizations } from '../chat/cross-org-block';
import { orgWorkspaceMembership, userOrgId } from '../common/tenant-scope';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LiveKit token minting. Each call goes through the chat-room access check
 * so a user can't request a token for a room they don't belong to. Tokens
 * are scoped to a single LiveKit room and expire after `TOKEN_TTL_SECONDS`.
 *
 * Env required:
 *   - `LIVEKIT_URL`     wss://livekit.example.com
 *   - `LIVEKIT_API_KEY`
 *   - `LIVEKIT_API_SECRET`
 *
 * An organization may set its own LiveKit server in the `livekit` add-on
 * (url, API key and secret, all three). It is used for rooms inside that
 * organization; a room spanning two organizations (a DM from a chat request)
 * always uses the server default so both sides meet on the same server.
 *
 * When no credentials resolve, minting throws BadRequest so the
 * misconfiguration surfaces at the first call instead of silently emitting
 * unusable tokens. The `livekit` add-on switched off answers 403
 * `addon-disabled` (AddonGuard on the controller, re-checked here).
 */
@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private static readonly TOKEN_TTL_SECONDS = 6 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly addons?: AddonsService,
  ) {}

  async mintToken(userId: string, input: LivekitTokenRequest): Promise<LivekitTokenResponse> {
    const orgId = await userOrgId(this.prisma, userId);
    await this.addons?.assertEnabled(orgId, 'livekit');

    const room = await this.prisma.client.chatRoom.findFirst({
      where: { id: input.roomId, deletedAt: null },
      include: {
        participants: { where: { userId }, select: { id: true } },
      },
    });
    if (!room) {
      throw new NotFoundException({ title: 'Chat room not found', status: 404 });
    }

    // Voice-channel kind only makes sense on workspace-scoped channels.
    // Reject calls that try to mint a voice-channel token against a DM
    // (which has no concept of persistent presence - the call lifecycle
    // is the room).
    if (input.kind === 'voice-channel' && room.type !== 'VOICE_CHANNEL') {
      throw new BadRequestException({
        title: 'Not a voice channel',
        status: 400,
        detail: 'This chat room is not a voice channel.',
      });
    }

    // Membership check. For private rooms (DM/GROUP/private channels) the
    // user must be in participants. For public workspace channels the
    // server falls back to a workspace-membership lookup.
    const isParticipant = room.participants.length > 0;
    if (!isParticipant) {
      if (
        (room.type === 'TEXT_CHANNEL' || room.type === 'VOICE_CHANNEL') &&
        !room.isPrivate &&
        room.workspaceId
      ) {
        // Org-scoped: a leftover membership into another org does not count.
        const ws = await orgWorkspaceMembership(this.prisma, userId, room.workspaceId);
        if (!ws) {
          throw new ForbiddenException({
            title: 'Not a member of this room',
            status: 403,
          });
        }
      } else {
        throw new ForbiddenException({
          title: 'Not a member of this room',
          status: 403,
        });
      }
    }

    // A cross-organization DM where either side blocked the other gets no
    // call token (initiateCall refuses too; this closes the direct route).
    await assertNotBlockedInCrossOrgDm(this.prisma, userId, room.id);

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      throw new NotFoundException({ title: 'User not found', status: 404 });
    }

    const { url, apiKey, apiSecret } = await this.credentialsFor(orgId, room.id);
    if (!url || !apiKey || !apiSecret) {
      throw new BadRequestException({
        title: 'Video calls are not set up',
        status: 400,
        detail:
          'No LiveKit server is configured. An admin can add one in Settings, Add ons, or the server needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.',
      });
    }

    // LiveKit room name. Keeping the chat-room id 1:1 with the LiveKit
    // identifier means we don't need a side table mapping the two, and
    // any server-side state stays naturally aligned.
    const roomName =
      input.kind === 'voice-channel' ? `voice:${input.roomId}` : `call:${input.roomId}`;
    const identity = user.id;

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: user.name || user.email,
      ttl: LivekitService.TOKEN_TTL_SECONDS,
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return {
      url,
      token,
      roomName,
      identity,
    };
  }

  /**
   * The organization's own LiveKit server when it set one and the room is
   * entirely inside that organization; otherwise the server default.
   */
  private async credentialsFor(
    orgId: string | null,
    roomId: string,
  ): Promise<{ url?: string; apiKey?: string; apiSecret?: string }> {
    const fallback = {
      url: this.config.get<string>('LIVEKIT_URL'),
      apiKey: this.config.get<string>('LIVEKIT_API_KEY'),
      apiSecret: this.config.get<string>('LIVEKIT_API_SECRET'),
    };
    if (!orgId || !this.addons) return fallback;
    const own = await this.addons.livekitCredentials(orgId);
    if (!own) return fallback;
    const room = await this.prisma.client.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
      select: {
        type: true,
        participants: { select: { user: { select: { organizationId: true } } } },
      },
    });
    if (!room || spansOrganizations(room.type, room.participants)) return fallback;
    return own;
  }
}
