import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@botss/database';

/**
 * Who a chat room's admins are, kept consistent under concurrency.
 *
 * A room with no ADMIN row falls back to "every member is an admin"
 * (assertRoomAdmin, for rooms older than roles). Demoting, removing and
 * leaving (ChatService) and deleting a user (AdminUsersService.remove)
 * serialise on the room row and keep an admin in the room.
 */

/**
 * Lock a room's row for the rest of the transaction, so changes to who its
 * admins are run one at a time per room. Without it two admins demoting or
 * removing each other, or leaving together, both see the other as the
 * remaining admin and the room ends up with none.
 *
 * FOR NO KEY UPDATE, not FOR UPDATE: it does not block the FOR KEY SHARE that
 * foreign-key checks take when a message or participant row is inserted.
 */
export async function lockRoomAdmins(
  tx: { $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> },
  roomId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "ChatRoom" WHERE id = ${roomId} FOR NO KEY UPDATE`;
}

/** The participant rows assertRoomAdmin decides on: every ADMIN, plus the actor. */
export function roomAdminRowsWhere(
  roomId: string,
  userId: string,
): Prisma.ChatRoomParticipantWhereInput {
  return { roomId, OR: [{ role: 'ADMIN' }, { userId }] };
}

/**
 * assertRoomAdmin's rule, applied again to rows read under lockRoomAdmins.
 * The first check ran before the lock, and a concurrent demotion or removal
 * may have taken the actor's admin rights since.
 */
export function assertRoomAdminRows(
  rows: ReadonlyArray<{ userId: string; role: string }>,
  userId: string,
): void {
  const self = rows.find((r) => r.userId === userId);
  if (self && (self.role === 'ADMIN' || !rows.some((r) => r.role === 'ADMIN'))) return;
  throw new ForbiddenException({
    title: 'Admin only',
    status: 403,
    detail: 'Only chat admins can perform this action.',
  });
}

/**
 * Before a user is hard-deleted: in every room where they are the only
 * ADMIN, promote the oldest other participant (leaveRoom's successor rule).
 * The participant cascade would otherwise leave those rooms with no ADMIN
 * row. Runs inside the delete's transaction, before the delete.
 *
 * Locks come first, in this order:
 * 1. The user row. A message send by this user holds KEY SHARE on it and
 *    then updates the room; taking the user first makes such a send finish
 *    or wait instead of deadlocking with the room locks. It also holds off
 *    new participant rows for them (that insert needs KEY SHARE on it too).
 * 2. Every room they are in, in one ordered statement, so a demotion, removal
 *    or leave there waits for this delete. A room where they are only a
 *    MEMBER is locked as well: leaving could otherwise promote them after
 *    the admin rows below were read. DMs are skipped: they have no admin
 *    actions, and the remaining participant passes the participant fallback.
 */
export async function handOverSoleAdminRooms(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const rooms = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT r.id FROM "ChatRoom" r
    WHERE r.type <> 'DM'
      AND r.id IN (SELECT p."roomId" FROM "ChatRoomParticipant" p WHERE p."userId" = ${userId})
    ORDER BY r.id
    FOR NO KEY UPDATE OF r`;
  if (rooms.length === 0) return;
  const roomIds = rooms.map((r) => r.id);
  const admins = await tx.chatRoomParticipant.findMany({
    where: { roomId: { in: roomIds }, role: 'ADMIN' },
    select: { roomId: true, userId: true },
  });
  for (const roomId of roomIds) {
    const here = admins.filter((a) => a.roomId === roomId);
    if (here.length === 0 || here.some((a) => a.userId !== userId)) continue;
    const successor = await tx.chatRoomParticipant.findFirst({
      where: { roomId, userId: { not: userId } },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true },
    });
    if (!successor) continue;
    await tx.chatRoomParticipant.update({
      where: { roomId_userId: { roomId, userId: successor.userId } },
      data: { role: 'ADMIN' },
    });
  }
}
