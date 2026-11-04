import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@botss/database';

/**
 * Who a chat room's admins are, kept consistent under concurrency.
 *
 * A room with no ADMIN row falls back to "every member is an admin"
 * (assertRoomAdmin, for rooms older than roles), so every path that can take
 * the last admin away - a demotion, a removal, leaving, deleting the user -
 * serialises on the room row and makes sure an admin remains.
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
 * row. Rooms are locked one at a time, in id order, like the chat paths.
 */
export async function handOverSoleAdminRooms(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const adminOf = await tx.chatRoomParticipant.findMany({
    where: { userId, role: 'ADMIN' },
    select: { roomId: true },
  });
  for (const roomId of adminOf.map((r) => r.roomId).sort()) {
    await lockRoomAdmins(tx, roomId);
    const admins = await tx.chatRoomParticipant.findMany({
      where: { roomId, role: 'ADMIN' },
      select: { userId: true },
    });
    if (admins.some((a) => a.userId !== userId)) continue;
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
