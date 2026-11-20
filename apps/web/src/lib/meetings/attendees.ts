import {
  MAX_MEETING_ATTENDEES,
  MAX_MEETING_EXTERNAL_ATTENDEES,
  type MeetingPerson,
} from '@botss/shared-types';
import { z } from 'zod';

import type { ExternalGuest } from './meeting-form';

/** Add people to the invited list, skipping duplicates and the organizer, up to the limit. */
export function mergePeople(
  current: readonly MeetingPerson[],
  incoming: readonly MeetingPerson[],
  organizerId: string | null,
): { list: MeetingPerson[]; added: number; hitLimit: boolean } {
  const seen = new Set(current.map((p) => p.id));
  const list = [...current];
  let added = 0;
  let hitLimit = false;
  for (const p of incoming) {
    if (p.id === organizerId || seen.has(p.id)) continue;
    if (list.length >= MAX_MEETING_ATTENDEES) {
      hitLimit = true;
      break;
    }
    seen.add(p.id);
    list.push(p);
    added += 1;
  }
  return { list, added, hitLimit };
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export type GuestResult = { ok: true; guests: ExternalGuest[] } | { ok: false; message: string };

/**
 * Add the addresses in `raw` (comma, space or newline separated) to the
 * guests. Every address must be valid; nothing is added otherwise.
 */
export function addGuests(current: readonly ExternalGuest[], raw: string): GuestResult {
  const parts = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: true, guests: [...current] };
  const guests = [...current];
  const seen = new Set(guests.map((g) => g.email));
  for (const part of parts) {
    const parsed = emailSchema.safeParse(part);
    if (!parsed.success) return { ok: false, message: `${part} is not a valid email address` };
    if (seen.has(parsed.data)) continue;
    if (guests.length >= MAX_MEETING_EXTERNAL_ATTENDEES) {
      return { ok: false, message: `At most ${MAX_MEETING_EXTERNAL_ATTENDEES} outside guests` };
    }
    seen.add(parsed.data);
    guests.push({ email: parsed.data });
  }
  return { ok: true, guests };
}
