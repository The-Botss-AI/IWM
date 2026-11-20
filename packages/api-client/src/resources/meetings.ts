import {
  attendeeCandidatesResponseSchema,
  icsImportPreviewSchema,
  icsImportResultSchema,
  meetingFeedLinkSchema,
  meetingFeedStatusSchema,
  meetingListResponseSchema,
  meetingMutationResponseSchema,
  meetingOkSchema,
  meetingRemindersResponseSchema,
  meetingSchema,
  meetingSnoozeResponseSchema,
  publicMeetingRsvpSchema,
  type AttendeeCandidatesResponse,
  type CancelMeetingRequest,
  type CreateMeetingRequest,
  type IcsImportPreview,
  type IcsImportResult,
  type IcsImportSelection,
  type Meeting,
  type MeetingFeedLink,
  type MeetingFeedStatus,
  type MeetingListResponse,
  type MeetingMutationResponse,
  type MeetingRemindersResponse,
  type MeetingRsvpAnswer,
  type MeetingSnoozeResponse,
  type PublicMeetingRsvp,
  type UpdateMeetingRequest,
} from '@botss/shared-types';

import type { HttpClient } from '../client.js';

export interface ListMeetingsArgs {
  from: Date;
  to: Date;
  includeCancelled?: boolean;
}

export interface AttendeeCandidatesArgs {
  /** Members of this workspace (of my organization); omitted = all active staff. */
  workspaceId?: string;
  search?: string;
}

function icsForm(file: Blob, filename: string, selection?: IcsImportSelection): FormData {
  const form = new FormData();
  form.append('file', file, filename);
  if (selection) form.append('selection', JSON.stringify(selection));
  return form;
}

/** Meetings (the caller's own: organized or attending). */
export class MeetingsResource {
  constructor(private readonly http: HttpClient) {}

  /** Occurrences overlapping [from, to) (at most 400 days), series expanded. */
  list(args: ListMeetingsArgs): Promise<MeetingListResponse> {
    const query: Record<string, unknown> = { from: args.from, to: args.to };
    if (args.includeCancelled !== undefined) query.includeCancelled = String(args.includeCancelled);
    return this.http.get('/meetings', meetingListResponseSchema, query);
  }

  get(id: string): Promise<Meeting> {
    return this.http.get(`/meetings/${id}`, meetingSchema);
  }

  create(input: CreateMeetingRequest): Promise<Meeting> {
    return this.http.post('/meetings', meetingSchema, input);
  }

  /** Organizer only. `scope` + `occurrenceStart` pick the occurrences of a series. */
  update(id: string, input: UpdateMeetingRequest): Promise<MeetingMutationResponse> {
    return this.http.patch(`/meetings/${id}`, meetingMutationResponseSchema, input);
  }

  /** Organizer only: the meeting, one occurrence, or an occurrence and the rest. */
  cancel(id: string, input: CancelMeetingRequest = {}): Promise<MeetingMutationResponse> {
    return this.http.post(`/meetings/${id}/cancel`, meetingMutationResponseSchema, input);
  }

  /** Organizer only. A live meeting is cancelled for everyone first unless `notifyAttendees` is false. */
  remove(id: string, opts: { notifyAttendees?: boolean } = {}): Promise<{ ok: true }> {
    const qs = opts.notifyAttendees === false ? '?notifyAttendees=false' : '';
    return this.http.delete(`/meetings/${id}${qs}`, meetingOkSchema);
  }

  /** The caller's own answer (internal attendees), for the whole series. */
  rsvp(id: string, response: MeetingRsvpAnswer): Promise<Meeting> {
    return this.http.post(`/meetings/${id}/rsvp`, meetingSchema, { response });
  }

  /** Replace the caller's reminders on this meeting (minutes before; at most 5). */
  setReminders(id: string, minutesBefore: number[]): Promise<MeetingRemindersResponse> {
    return this.http.put(`/meetings/${id}/reminders`, meetingRemindersResponseSchema, {
      minutesBefore,
    });
  }

  /** "Snooze" on a fired reminder: rings again in 5 minutes (`data.snooze.deliveryId`). */
  snooze(deliveryId: string): Promise<MeetingSnoozeResponse> {
    return this.http.post(
      `/meetings/reminder-deliveries/${deliveryId}/snooze`,
      meetingSnoozeResponseSchema,
    );
  }

  /** People the caller can add: all active staff of their organization, or of one workspace. */
  attendeeCandidates(args: AttendeeCandidatesArgs = {}): Promise<AttendeeCandidatesResponse> {
    const query: Record<string, unknown> = {};
    if (args.workspaceId) query.workspaceId = args.workspaceId;
    if (args.search) query.search = args.search;
    return this.http.get('/meetings/attendee-candidates', attendeeCandidatesResponseSchema, query);
  }

  /** Step 1 of an .ics import: what is in the file (max 2 MB, 2,000 events). */
  previewImport(file: Blob, filename = 'calendar.ics'): Promise<IcsImportPreview> {
    return this.http.postForm(
      '/meetings/import/preview',
      icsImportPreviewSchema,
      icsForm(file, filename),
    );
  }

  /** Step 2: import the chosen events (`{ all: true }` or `{ uids }`); the same file again. */
  importIcs(
    file: Blob,
    selection: IcsImportSelection,
    filename = 'calendar.ics',
  ): Promise<IcsImportResult> {
    return this.http.postForm(
      '/meetings/import',
      icsImportResultSchema,
      icsForm(file, filename, selection),
    );
  }

  feedStatus(): Promise<MeetingFeedStatus> {
    return this.http.get('/meetings/feed-token', meetingFeedStatusSchema);
  }

  /** A new private subscription link (the old one stops working). Shown once. */
  createFeedLink(): Promise<MeetingFeedLink> {
    return this.http.post('/meetings/feed-token', meetingFeedLinkSchema);
  }

  revokeFeedLink(): Promise<{ ok: true }> {
    return this.http.delete('/meetings/feed-token', meetingOkSchema);
  }
}

/** The login-free RSVP page for external guests (token from the email link). */
export class PublicMeetingsResource {
  constructor(private readonly http: HttpClient) {}

  rsvp(token: string): Promise<PublicMeetingRsvp> {
    return this.http.get(
      `/public/meetings/rsvp/${encodeURIComponent(token)}`,
      publicMeetingRsvpSchema,
    );
  }

  answer(token: string, response: MeetingRsvpAnswer): Promise<PublicMeetingRsvp> {
    return this.http.post(
      `/public/meetings/rsvp/${encodeURIComponent(token)}`,
      publicMeetingRsvpSchema,
      { response },
    );
  }
}
