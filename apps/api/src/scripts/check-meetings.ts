/**
 * Meetings self-checks (no database, no network, no Redis):
 *  - visibility: only the organizer and the people added see a meeting;
 *    a non-attendee of the same organization, an org admin, a super admin
 *    of the root organization, another organization and an account without
 *    one all get 404 on get, list, calendar, reminders and snooze;
 *  - internal attendees must be STAFF of the organizer's organization (other
 *    org, client account, deleted account refused); a staff email becomes
 *    that person, any other email a guest;
 *  - recurrence: DST (Europe/Berlin, America/New_York), all-day across DST,
 *    COUNT / UNTIL, exdates, moved occurrences, rule text round trips, and
 *    the editor's this / following / all edits and cancels;
 *  - reminder cron: fires once per (reminder, occurrence), is idempotent
 *    across runs, snooze rings again once, and nothing fires for a cancelled
 *    meeting or occurrence, a declined or removed attendee, another
 *    organization's person or an organization with the add-on off;
 *  - .ics import with Google, Outlook (Windows TZIDs) and Apple style files:
 *    zones, links, alarms, exceptions; preview flags; select all and a UID
 *    subset; re-import dedupe and SEQUENCE updates; size, count and type
 *    limits as RFC 7807 problems;
 *  - RSVP links (hashed token, rotation, public view shape, add-on off,
 *    cancelled and deleted meetings) and the calendar feed token flow;
 *  - controller wiring (add-on gate, public routes) and the add-on default;
 *  - hardening: rules ical.js cannot expand are refused fast, COUNT cap,
 *    old imported series rebased, iteration budgets, nextFireAt selection
 *    without a flood after downtime, attendees who left dropped on edit, CR
 *    injection in .ics output, VTIMEZONE range, RSVP links rotated only
 *    once the email is queued, import caps, revive and SEQUENCE rules,
 *    workspace candidates, snooze after the end, guest attendee lists.
 *
 * Run: pnpm --filter @botss/api test
 */
import 'reflect-metadata';

import assert from 'node:assert/strict';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createMeetingSchema,
  icsImportSelectionFieldSchema,
  updateMeetingSchema,
  type CreateMeetingRequest,
} from '@botss/shared-types';
import ICAL from 'ical.js';

import { ADDON_REGISTRY } from '../addons/addon-registry';
import { REQUIRE_ADDON_KEY } from '../addons/require-addon.decorator';
import type { AddonsService } from '../addons/addons.service';
import { CalendarService } from '../calendar/calendar.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import type { UserScope } from '../common/decorators/user-scope.decorator';
import type { EmailService } from '../email/email.service';
import {
  buildCancelIcs,
  buildFeedIcs,
  buildRequestIcs,
  buildVtimezone,
  icsText,
  type IcsMeeting,
} from '../meetings/ics-export';
import { parseIcsFile } from '../meetings/ics-parse';
import { MeetingEditorService } from '../meetings/meeting-editor.service';
import { MeetingFeedService } from '../meetings/meeting-feed.service';
import { MeetingImportService } from '../meetings/meeting-import.service';
import { MeetingNotifier } from '../meetings/meeting-notifier.service';
import { meetingClock } from '../meetings/meeting-reminder-schedule';
import { MeetingRemindersService, REMINDER_BATCH } from '../meetings/meeting-reminders.service';
import type { MeetingActor, MeetingViewer } from '../meetings/meeting-rules';
import { MeetingRsvpService } from '../meetings/meeting-rsvp.service';
import { MeetingsController } from '../meetings/meetings.controller';
import { MeetingsService } from '../meetings/meetings.service';
import {
  MeetingsFeedController,
  PublicMeetingsController,
} from '../meetings/public-meetings.controller';
import {
  buildRrule,
  computeLastEndsAt,
  expandOccurrences,
  MAX_ITERATIONS,
  newExpansionBudget,
  ruleProblem,
  ruleToRecurrence,
  truncateRule,
  type SeriesShape,
} from '../meetings/recurrence';
import { ianaZoneForTzid, wallToUtc, WINDOWS_ZONE_TARGETS } from '../meetings/time-zones';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FakeDb, fakePrismaService, type Row } from './meetings-fake-prisma';

// ------------------------------------------------------------------ fixtures

const ORG_A = 'cmorga0000000000000000001';
const ORG_B = 'cmorgb0000000000000000001';
const ROOT = 'cmroot0000000000000000001';
const WS_A = 'cmwsa00000000000000000001';

const ORGANIZER = 'cmuorganizer0000000000001';
const ATTENDEE = 'cmuattendee00000000000001';
const STAFF2 = 'cmustaff200000000000000001';
const OUTSIDER = 'cmuoutsider00000000000001';
const ADMIN_A = 'cmuadmina000000000000001';
const SUPER_ROOT = 'cmusuperroot0000000000001';
const USER_B = 'cmuuserb0000000000000000001';
const CLIENT_ACC = 'cmuclient000000000000000001';
const DELETED_A = 'cmudeleted00000000000000001';

const T0 = new Date('2026-12-01T10:00:00.000Z');
/**
 * "Now" for every write in these checks (nextFireAt, imports): fixed, so the
 * dated fixtures below stay in the future whenever the checks run.
 */
const CLOCK = new Date('2026-11-20T00:00:00.000Z');
meetingClock.now = () => new Date(CLOCK);

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${(err as Error)?.stack ?? err}`);
  }
}

async function rejects(
  p: Promise<unknown>,
  type: new (...args: never[]) => HttpException,
  code?: string,
): Promise<HttpException> {
  try {
    await p;
  } catch (err) {
    assert.ok(
      err instanceof type,
      `expected ${type.name}, got ${(err as Error)?.constructor?.name}: ${(err as Error)?.message}`,
    );
    if (code) {
      const body = (err as HttpException).getResponse() as { code?: string };
      assert.equal(body.code, code, 'problem code');
    }
    return err as HttpException;
  }
  assert.fail(`expected ${type.name}`);
}

interface Emitted {
  userIds: string[];
  type: string;
  title: string;
  body: string;
  url?: string | null;
  entityId?: string | null;
  pushData?: Record<string, unknown>;
  requireInteraction?: boolean;
}

interface MailJob {
  variant: string;
  method: string;
  to: string;
  rsvp: { accept: string; maybe: string; decline: string } | null;
  ics: string;
  title: string;
}

function setup() {
  const db = new FakeDb();
  const orgs = [ORG_A, ORG_B, ROOT];
  for (const id of orgs)
    db.insert('organization', { id, isActive: true, isRoot: id === ROOT, deletedAt: null });
  db.insert('workspace', { id: WS_A, organizationId: ORG_A, deletedAt: null });
  const user = (id: string, organizationId: string | null, extra: Row = {}) =>
    db.insert('user', {
      id,
      email: `${id.slice(3, 12)}@example.com`,
      name: id.slice(3, 12),
      image: null,
      organizationId,
      accountType: 'STAFF',
      systemRole: 'EMPLOYEE',
      timezone: 'Asia/Karachi',
      deletedAt: null,
      ...extra,
    });
  user(ORGANIZER, ORG_A);
  user(ATTENDEE, ORG_A);
  user(STAFF2, ORG_A);
  user(OUTSIDER, ORG_A);
  user(ADMIN_A, ORG_A, { systemRole: 'ADMIN' });
  user(SUPER_ROOT, ROOT, { systemRole: 'SUPER_ADMIN' });
  user(USER_B, ORG_B);
  user(CLIENT_ACC, null, { accountType: 'CLIENT' });
  user(DELETED_A, ORG_A, { deletedAt: new Date('2026-01-01') });
  db.insert('workspaceMembership', { id: 'cmwm0', workspaceId: WS_A, userId: ORGANIZER });
  db.insert('workspaceMembership', { id: 'cmwm1', workspaceId: WS_A, userId: ATTENDEE });
  db.insert('workspaceMembership', { id: 'cmwm2', workspaceId: WS_A, userId: STAFF2 });
  db.insert('userPreferences', {
    id: 'cmpref1',
    userId: ATTENDEE,
    data: { meetings: { defaultReminders: [60, 5] } },
  });

  const emitted: Emitted[] = [];
  const notifications = {
    emit: async (args: Omit<Emitted, 'userIds'> & { userId: string }) => {
      emitted.push({ ...args, userIds: [args.userId] });
      return { id: `n${emitted.length}` };
    },
    emitMany: async (ids: string[], args: Omit<Emitted, 'userIds'>) => {
      emitted.push({ ...args, userIds: [...ids] });
    },
  } as unknown as NotificationsService;
  const mails: MailJob[] = [];
  // Addresses whose email fails to queue, and a switch for "no transport".
  const mailFails = new Set<string>();
  const mailStub = { on: false };
  const email = {
    isStub: async () => mailStub.on,
    sendMeetingEmails: async (_org: string, jobs: MailJob[]) => {
      if (mailStub.on) return jobs.map(() => false);
      const queued = jobs.map((j) => !mailFails.has(j.to));
      mails.push(...jobs.filter((_j, i) => queued[i]));
      return queued;
    },
  } as unknown as EmailService;
  const disabled = new Set<string>();
  const addons = {
    isEnabled: async (orgId: string, key: string) => !(key === 'meetings' && disabled.has(orgId)),
  } as unknown as AddonsService;
  const prisma = fakePrismaService(db) as unknown as PrismaService;
  const notifier = new MeetingNotifier(prisma, notifications, email);
  const meetings = new MeetingsService(prisma, notifier);
  const editor = new MeetingEditorService(prisma, meetings, notifier);
  const rsvp = new MeetingRsvpService(prisma, notifier, addons);
  const feed = new MeetingFeedService(prisma, addons);
  const imports = new MeetingImportService(prisma, meetings);
  const reminders = new MeetingRemindersService(prisma, notifications, addons);
  const calendar = new CalendarService(prisma, meetings, addons);
  return {
    db,
    emitted,
    mails,
    mailFails,
    mailStub,
    disabled,
    meetings,
    editor,
    rsvp,
    feed,
    imports,
    reminders,
    calendar,
  };
}

function actor(userId: string, organizationId: string | null): MeetingActor {
  return {
    userId,
    organizationId,
    name: `Name ${userId.slice(3, 9)}`,
    email: `${userId.slice(3, 12)}@example.com`,
    workspaceId: null,
  };
}
const viewer = (userId: string, organizationId: string | null): MeetingViewer => ({
  userId,
  organizationId,
});

const ORG_ACTOR = actor(ORGANIZER, ORG_A);

function createInput(over: Partial<CreateMeetingRequest> = {}) {
  return createMeetingSchema.parse({
    title: 'Planning',
    startsAt: T0.toISOString(),
    endsAt: new Date(T0.getTime() + 3_600_000).toISOString(),
    timeZone: 'Asia/Karachi',
    ...over,
  });
}

const scopeFor = (userId: string): UserScope => ({
  userId,
  workspaceIds: [],
  projectIds: [],
  currentWorkspaceId: null,
  workspaceRole: null,
  seesEveryProject: false,
});

// .ics files are written line by line: `\\n` inside a value is the escaped
// newline of RFC 5545, never a real line break.
const ics = (lines: string[]) => Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
const upload = (bytes: Buffer, name = 'calendar.ics', mimetype = 'text/calendar') => ({
  originalname: name,
  mimetype,
  size: bytes.length,
  buffer: bytes,
});

const GOOGLE = ics([
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:Work',
  'X-WR-TIMEZONE:Asia/Karachi',
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Karachi',
  'X-LIC-LOCATION:Asia/Karachi',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0500',
  'TZOFFSETTO:+0500',
  'TZNAME:PKT',
  'DTSTART:19700101T000000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Karachi:20261123T100000',
  'DTEND;TZID=Asia/Karachi:20261123T103000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'EXDATE;TZID=Asia/Karachi:20261125T100000',
  'DTSTAMP:20261120T090000Z',
  'ORGANIZER;CN=Ayesha:mailto:ayesha@example.org',
  'UID:7kukuqrfedlm2f5l9tmjf9ugkr@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Ayesha:mailto:ayesha@example.org',
  'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
  'DESCRIPTION:Standup\\n\\nJoin with Google Meet: https://meet.google.com/abc-defg-hij\\n\\nLearn more about Meet at: https://support.google.com/a/users/answer/9282720',
  'LOCATION:',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:Standup',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H10M0S',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Karachi:20261127T110000',
  'DTEND;TZID=Asia/Karachi:20261127T113000',
  'DTSTAMP:20261120T090000Z',
  'UID:7kukuqrfedlm2f5l9tmjf9ugkr@google.com',
  'RECURRENCE-ID;TZID=Asia/Karachi:20261127T100000',
  'SEQUENCE:1',
  'SUMMARY:Standup (moved)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Karachi:20261130T100000',
  'DTEND;TZID=Asia/Karachi:20261130T103000',
  'DTSTAMP:20261120T090000Z',
  'UID:7kukuqrfedlm2f5l9tmjf9ugkr@google.com',
  'RECURRENCE-ID;TZID=Asia/Karachi:20261130T100000',
  'STATUS:CANCELLED',
  'SUMMARY:Standup',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261225',
  'DTEND;VALUE=DATE:20261226',
  'DTSTAMP:20261120T090000Z',
  'UID:holiday-1@google.com',
  'SUMMARY:Holiday',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261202T120000Z',
  'DTEND:20261202T130000Z',
  'DTSTAMP:20261120T090000Z',
  'UID:utc-1@google.com',
  'SUMMARY:Vendor call',
  'LOCATION:https://us02web.zoom.us/j/81234567890?pwd=abc',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261203T120000Z',
  'DTEND:20261203T130000Z',
  'DTSTAMP:20261120T090000Z',
  'UID:cancelled-1@google.com',
  'STATUS:CANCELLED',
  'SUMMARY:Called off',
  'END:VEVENT',
  'END:VCALENDAR',
]);

const OUTLOOK = ics([
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VTIMEZONE',
  'TZID:Pakistan Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T000000',
  'TZOFFSETFROM:+0500',
  'TZOFFSETTO:+0500',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'ORGANIZER;CN=Max:mailto:max@contoso.example',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=me:mailto:me@example.com',
  'DESCRIPTION;LANGUAGE=en-US:Quarterly review\\n________________\\nMicrosoft Teams meeting\\nClick here to join the meeting<https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d>\\n',
  'UID:040000008200E00074C5B7101A82E0080000000010D5F8A35B5FDB01',
  'SUMMARY;LANGUAGE=en-US:Quarterly review',
  'DTSTART;TZID=W. Europe Standard Time:20270325T150000',
  'DTEND;TZID=W. Europe Standard Time:20270325T160000',
  'RRULE:FREQ=WEEKLY;COUNT=3;INTERVAL=1;BYDAY=TH;WKST=MO',
  'CLASS:PUBLIC',
  'PRIORITY:5',
  'DTSTAMP:20261120T101500Z',
  'TRANSP:OPAQUE',
  'STATUS:CONFIRMED',
  'SEQUENCE:2',
  'LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting',
  'X-MICROSOFT-CDO-APPT-SEQUENCE:2',
  'BEGIN:VALARM',
  'DESCRIPTION:REMINDER',
  'TRIGGER;RELATED=START:-PT15M',
  'ACTION:DISPLAY',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:outlook-pk-1',
  'SUMMARY:Client call',
  'DTSTART;TZID=Pakistan Standard Time:20261201T140000',
  'DTEND;TZID=Pakistan Standard Time:20261201T150000',
  'LOCATION:https://zoom.us/j/123456789?pwd=abc',
  'DTSTAMP:20261120T101500Z',
  'END:VEVENT',
  'END:VCALENDAR',
]);

const APPLE = ics([
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//macOS 14.0//EN',
  'CALSCALE:GREGORIAN',
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'DTSTART:20070311T020000',
  'TZNAME:EDT',
  'TZOFFSETTO:-0400',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'DTSTART:20071104T020000',
  'TZNAME:EST',
  'TZOFFSETTO:-0500',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'CREATED:20261020T120000Z',
  'UID:5B2D9A3E-1C2B-4F7A-9E1D-ABCDEF123456',
  'DTEND;TZID=America/New_York:20261029T100000',
  'TRANSP:OPAQUE',
  'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
  'SUMMARY:Design sync',
  'LAST-MODIFIED:20261020T120000Z',
  'DTSTAMP:20261020T120000Z',
  'DTSTART;TZID=America/New_York:20261029T090000',
  'SEQUENCE:0',
  'RRULE:FREQ=DAILY;UNTIL=20261103T045959Z',
  'URL;VALUE=URI:https://acme.webex.com/meet/jdoe',
  'BEGIN:VALARM',
  'X-WR-ALARMUID:1C1E0A2B-0000-0000-0000-000000000001',
  'UID:1C1E0A2B-0000-0000-0000-000000000001',
  'TRIGGER:-PT1H',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'BEGIN:VALARM',
  'TRIGGER;VALUE=DATE-TIME:19760401T005545Z',
  'ACTION:NONE',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:floating-1',
  'SUMMARY:Lunch',
  'DTSTART:20261204T130000',
  'DTEND:20261204T140000',
  'DTSTAMP:20261020T120000Z',
  'END:VEVENT',
  'END:VCALENDAR',
]);

// ------------------------------------------------------------------ checks

async function main(): Promise<void> {
  await check('add-on registry and controller wiring', () => {
    assert.equal(ADDON_REGISTRY.meetings.defaultEnabled, true, 'meetings is on unless disabled');
    assert.equal(
      Reflect.getMetadata(REQUIRE_ADDON_KEY, MeetingsController),
      'meetings',
      'controller gated by the add-on',
    );
    assert.equal(
      Reflect.getMetadata(SKIP_PERMISSIONS_KEY, MeetingsController),
      true,
      'per-meeting authorization',
    );
    for (const c of [PublicMeetingsController, MeetingsFeedController]) {
      assert.equal(Reflect.getMetadata(IS_PUBLIC_KEY, c), true, `${c.name} is public`);
      assert.equal(
        Reflect.getMetadata(REQUIRE_ADDON_KEY, c),
        undefined,
        `${c.name} checks the add-on itself`,
      );
    }
    const order = Object.getOwnPropertyNames(MeetingsController.prototype);
    assert.ok(
      order.indexOf('attendeeCandidates') < order.indexOf('get'),
      'static routes come before :id',
    );
    assert.ok(order.indexOf('feedStatus') < order.indexOf('get'), 'feed-token comes before :id');
  });

  // ---------------------------------------------------------------- recurrence
  await check('recurrence keeps local time across DST', () => {
    const tz = 'Europe/Berlin';
    const start = new Date(
      wallToUtc({ year: 2026, month: 10, day: 19, hour: 9, minute: 0, second: 0 }, tz),
    );
    const series: SeriesShape = {
      startsAt: start,
      endsAt: new Date(start.getTime() + 3_600_000),
      allDay: false,
      timeZone: tz,
      rrule: buildRrule({ freq: 'WEEKLY', interval: 1, byDay: ['MO'] }, false, tz),
      exdates: [],
      overrides: [],
    };
    const got = expandOccurrences(series, new Date('2026-10-01'), new Date('2026-11-10')).items.map(
      (o) => o.startsAt.toISOString(),
    );
    assert.deepEqual(got, [
      '2026-10-19T07:00:00.000Z',
      '2026-10-26T08:00:00.000Z',
      '2026-11-02T08:00:00.000Z',
      '2026-11-09T08:00:00.000Z',
    ]);
    assert.equal(computeLastEndsAt(series), null, 'a never-ending series has no last end');

    const ny = 'America/New_York';
    const nyStart = new Date(
      wallToUtc({ year: 2027, month: 3, day: 12, hour: 9, minute: 0, second: 0 }, ny),
    );
    const daily = {
      ...series,
      timeZone: ny,
      startsAt: nyStart,
      endsAt: new Date(nyStart.getTime() + 1_800_000),
      rrule: 'FREQ=DAILY;COUNT=4',
    };
    assert.deepEqual(
      expandOccurrences(daily, new Date('2027-03-01'), new Date('2027-04-01')).items.map((o) =>
        o.startsAt.toISOString(),
      ),
      [
        '2027-03-12T14:00:00.000Z',
        '2027-03-13T14:00:00.000Z',
        '2027-03-14T13:00:00.000Z',
        '2027-03-15T13:00:00.000Z',
      ],
      '09:00 New York before and after the March change',
    );
    assert.equal(
      computeLastEndsAt(daily)?.toISOString(),
      '2027-03-15T13:30:00.000Z',
      'COUNT ends the series',
    );

    const allDay: SeriesShape = {
      startsAt: new Date(
        wallToUtc({ year: 2026, month: 3, day: 28, hour: 0, minute: 0, second: 0 }, tz),
      ),
      endsAt: new Date(
        wallToUtc({ year: 2026, month: 3, day: 29, hour: 0, minute: 0, second: 0 }, tz),
      ),
      allDay: true,
      timeZone: tz,
      rrule: 'FREQ=DAILY;COUNT=3',
      exdates: [],
      overrides: [],
    };
    const days = expandOccurrences(allDay, new Date('2026-03-01'), new Date('2026-04-30')).items;
    assert.deepEqual(
      days.map((o) => [o.startsAt.toISOString(), o.endsAt.toISOString()]),
      [
        ['2026-03-27T23:00:00.000Z', '2026-03-28T23:00:00.000Z'],
        ['2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
        ['2026-03-29T22:00:00.000Z', '2026-03-30T22:00:00.000Z'],
      ],
      'all-day occurrences are whole local days (23 h on the change day)',
    );
  });

  await check('recurrence: exdates, moved occurrences, UNTIL, rule text', () => {
    const tz = 'Asia/Karachi';
    const start = new Date('2026-12-07T05:00:00.000Z'); // Mon 10:00 PKT
    const rrule = buildRrule(
      {
        freq: 'WEEKLY',
        interval: 1,
        byDay: ['MO', 'WE'],
        until: new Date('2026-12-16T00:00:00.000Z'),
      },
      false,
      tz,
    );
    assert.equal(
      rrule,
      'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261216T185959Z',
      'until is the end of that local day',
    );
    const moved = new Date('2026-12-09T09:00:00.000Z');
    const series: SeriesShape = {
      startsAt: start,
      endsAt: new Date(start.getTime() + 1_800_000),
      allDay: false,
      timeZone: tz,
      rrule,
      exdates: [new Date('2026-12-14T05:00:00.000Z')],
      overrides: [
        {
          originalStart: new Date('2026-12-09T05:00:00.000Z'),
          startsAt: moved,
          endsAt: new Date(moved.getTime() + 1_800_000),
          title: 'Moved',
          description: null,
          location: null,
          meetingUrl: null,
        },
      ],
    };
    const items = expandOccurrences(series, new Date('2026-12-01'), new Date('2027-01-01')).items;
    assert.deepEqual(
      items.map((o) => [o.startsAt.toISOString(), o.override?.title ?? null]),
      [
        ['2026-12-07T05:00:00.000Z', null],
        ['2026-12-09T09:00:00.000Z', 'Moved'],
        ['2026-12-16T05:00:00.000Z', null],
      ],
      'exdate removed, override moved, UNTIL day kept',
    );
    assert.deepEqual(ruleToRecurrence(rrule, tz)?.byDay, ['MO', 'WE'], 'app rule round trips');
    assert.equal(ruleToRecurrence('FREQ=MONTHLY;BYDAY=2TU', tz), null, 'richer rules are raw only');
    assert.equal(
      truncateRule('FREQ=DAILY;COUNT=10', new Date('2026-12-10T05:00:00.000Z'), false, tz),
      'FREQ=DAILY;UNTIL=20261210T045959Z',
      'truncation turns COUNT into UNTIL',
    );
    for (const zone of WINDOWS_ZONE_TARGETS) {
      assert.ok(ianaZoneForTzid(zone), `${zone} is known to this runtime`);
    }
    assert.equal(ianaZoneForTzid('Pakistan Standard Time'), 'Asia/Karachi');
    assert.equal(ianaZoneForTzid('Turkey Standard Time'), 'Europe/Istanbul');
    assert.equal(ianaZoneForTzid('Arabian Standard Time'), 'Asia/Dubai');
    assert.equal(ianaZoneForTzid('/mozilla.org/20070129_1/Europe/Paris'), 'Europe/Paris');
    assert.equal(ianaZoneForTzid('Nowhere Standard Time'), null);
  });

  // ---------------------------------------------------------------- create + visibility
  const env = setup();
  const created = await env.editor.create(
    ORG_ACTOR,
    createInput({
      attendees: {
        userIds: [ATTENDEE],
        emails: [
          { email: 'Guest@External.example', name: 'Gita Guest' },
          { email: `${STAFF2.slice(3, 12)}@example.com` },
        ],
      },
    }),
    null,
  );

  await check('create: attendees resolved, invitations sent, default reminders', () => {
    const byEmail = Object.fromEntries(created.attendees.map((a) => [a.email, a]));
    assert.equal(created.attendees.length, 3);
    assert.equal(byEmail['guest@external.example']?.external, true, 'unknown address is a guest');
    assert.equal(
      byEmail[`${STAFF2.slice(3, 12)}@example.com`]?.userId,
      STAFF2,
      'a staff address becomes that person',
    );
    assert.equal(created.isOrganizer, true);
    assert.deepEqual(created.myReminders, [10], 'organizer without preferences gets the default');
    const invite = env.emitted.find((e) => e.type === 'MEETING_INVITE');
    assert.deepEqual(
      [...(invite?.userIds ?? [])].sort(),
      [ATTENDEE, STAFF2].sort(),
      'internal attendees invited, not the organizer',
    );
    assert.equal(invite?.url, `/meetings/${created.id}`);
    assert.equal(env.mails.length, 1, 'one email, to the guest');
    const mail = env.mails[0]!;
    assert.equal(mail.to, 'guest@external.example');
    assert.equal(mail.method, 'REQUEST');
    assert.match(mail.ics, /METHOD:REQUEST/);
    assert.match(mail.ics.replace(/\r\n /g, ''), /RSVP=TRUE[^\r]*:mailto:guest@external\.example/);
    assert.match(
      mail.rsvp?.accept ?? '',
      /\/meetings\/rsvp\/[A-Za-z0-9_-]{43}\?response=accepted$/,
    );
    const rem = env.db.table('meetingReminder').filter((r) => r['meetingId'] === created.id);
    const mine = (u: string) =>
      rem
        .filter((r) => r['userId'] === u)
        .map((r) => r['minutesBefore'])
        .sort((a, b) => (a as number) - (b as number));
    assert.deepEqual(mine(ATTENDEE), [5, 60], "the attendee's own defaults");
    assert.deepEqual(mine(STAFF2), [10], 'product default for someone without preferences');
    const guestRow = env.db
      .table('meetingAttendee')
      .find((a) => a['email'] === 'guest@external.example');
    assert.match(
      String(guestRow?.['rsvpTokenHash']),
      /^[0-9a-f]{64}$/,
      'only the token hash is stored',
    );
    assert.ok(
      !mail.rsvp?.accept.includes(String(guestRow?.['rsvpTokenHash'])),
      'the email carries the raw token, not the hash',
    );
  });

  await check('visibility: organizer and attendees only, 404 for everyone else', async () => {
    assert.equal(
      (await env.meetings.get(viewer(ORGANIZER, ORG_A), created.id, null)).id,
      created.id,
    );
    const asAttendee = await env.meetings.get(viewer(ATTENDEE, ORG_A), created.id, null);
    assert.equal(asAttendee.isOrganizer, false);
    assert.equal(asAttendee.myResponse, 'NEEDS_ACTION');
    for (const [who, org] of [
      [OUTSIDER, ORG_A],
      [ADMIN_A, ORG_A],
      [SUPER_ROOT, ROOT],
      [USER_B, ORG_B],
      [CLIENT_ACC, null],
      [ATTENDEE, ORG_B],
    ] as const) {
      await rejects(
        env.meetings.get(viewer(who, org), created.id, null),
        NotFoundException,
        'meeting_not_found',
      );
      const list = await env.meetings.list(viewer(who, org), {
        from: new Date('2026-11-01'),
        to: new Date('2027-01-01'),
      });
      assert.equal(list.items.length, 0, `${who} lists nothing`);
      const cal = await env.calendar.listEvents(
        scopeFor(who),
        new Date('2026-11-01'),
        new Date('2027-01-01'),
        ['meeting'],
        org,
      );
      assert.equal(cal.items.length, 0, `${who} sees nothing on the calendar`);
      await rejects(
        env.meetings.setReminders(viewer(who, org), created.id, [5]),
        NotFoundException,
      );
      await rejects(
        env.editor.update(
          actor(who, org),
          created.id,
          updateMeetingSchema.parse({ title: 'x' }),
          null,
        ),
        who === CLIENT_ACC ? ForbiddenException : NotFoundException,
      );
      await rejects(
        env.meetings.rsvp(actor(who, org), created.id, { response: 'ACCEPTED' }, null),
        NotFoundException,
      );
    }
    const list = await env.meetings.list(viewer(ATTENDEE, ORG_A), {
      from: new Date('2026-11-01'),
      to: new Date('2027-01-01'),
    });
    assert.deepEqual(
      list.items.map((i) => i.meetingId),
      [created.id],
    );
    const cal = await env.calendar.listEvents(
      scopeFor(ATTENDEE),
      new Date('2026-11-01'),
      new Date('2027-01-01'),
      ['meeting'],
      ORG_A,
    );
    assert.equal(cal.items[0]?.type, 'meeting');
    assert.equal((cal.items[0]?.meta as { meetingId?: string }).meetingId, created.id);
    env.disabled.add(ORG_A);
    const off = await env.calendar.listEvents(
      scopeFor(ATTENDEE),
      new Date('2026-11-01'),
      new Date('2027-01-01'),
      [],
      ORG_A,
    );
    assert.equal(
      off.items.filter((i) => i.type === 'meeting').length,
      0,
      'add-on off: no meetings on the calendar',
    );
    env.disabled.delete(ORG_A);
    await rejects(
      env.editor.update(
        actor(ATTENDEE, ORG_A),
        created.id,
        updateMeetingSchema.parse({ title: 'x' }),
        null,
      ),
      ForbiddenException,
      'meeting_organizer_only',
    );
  });

  await check('attendees: same organization staff only', async () => {
    for (const bad of [USER_B, CLIENT_ACC, DELETED_A, SUPER_ROOT]) {
      await rejects(
        env.editor.create(
          ORG_ACTOR,
          createInput({ attendees: { userIds: [bad], emails: [] } }),
          null,
        ),
        BadRequestException,
        'meeting_attendee_not_in_org',
      );
    }
    const m = await env.editor.create(
      ORG_ACTOR,
      createInput({
        attendees: { userIds: [], emails: [{ email: `${USER_B.slice(3, 12)}@example.com` }] },
        notifyAttendees: false,
      }),
      null,
    );
    assert.equal(
      m.attendees[0]?.external,
      true,
      "another organization's staff address stays a guest",
    );
    assert.equal(m.attendees[0]?.userId, null);
    await rejects(env.meetings.get(viewer(USER_B, ORG_B), m.id, null), NotFoundException);
    await rejects(
      env.editor.create(ORG_ACTOR, createInput({ leadId: 'cmlead00000000000000000001' }), null),
      BadRequestException,
      'meeting_link_needs_workspace',
    );
    const candidates = await env.meetings.attendeeCandidates(viewer(ORGANIZER, ORG_A), {});
    assert.deepEqual(
      candidates.items.map((c) => c.id).sort(),
      [ADMIN_A, ATTENDEE, OUTSIDER, STAFF2].sort(),
      'select all: active staff of my organization, not me',
    );
    const ws = await env.meetings.attendeeCandidates(viewer(ORGANIZER, ORG_A), {
      workspaceId: WS_A,
    });
    assert.deepEqual(
      ws.items.map((c) => c.id).sort(),
      [ATTENDEE, STAFF2].sort(),
      'select all from one workspace',
    );
    await rejects(
      env.meetings.attendeeCandidates(viewer(USER_B, ORG_B), { workspaceId: WS_A }),
      NotFoundException,
    );
    await rejects(
      env.meetings.attendeeCandidates(viewer(OUTSIDER, ORG_A), { workspaceId: WS_A }),
      NotFoundException,
      undefined,
    );
  });

  await check('internal RSVP tells the organizer once', async () => {
    const before = env.emitted.length;
    const answered = await env.meetings.rsvp(
      actor(ATTENDEE, ORG_A),
      created.id,
      { response: 'ACCEPTED' },
      null,
    );
    assert.equal(answered.myResponse, 'ACCEPTED');
    const rsvp = env.emitted.slice(before).filter((e) => e.type === 'MEETING_RSVP');
    assert.equal(rsvp.length, 1);
    assert.deepEqual(rsvp[0]?.userIds, [ORGANIZER]);
    await env.meetings.rsvp(actor(ATTENDEE, ORG_A), created.id, { response: 'ACCEPTED' }, null);
    assert.equal(
      env.emitted.slice(before).filter((e) => e.type === 'MEETING_RSVP').length,
      1,
      'same answer: no new notification',
    );
    await rejects(
      env.meetings.rsvp(ORG_ACTOR, created.id, { response: 'ACCEPTED' }, null),
      BadRequestException,
      'meeting_organizer_rsvp',
    );
  });

  await check('external RSVP links: hashed, rotated, minimal public view', async () => {
    const token = (url: string) => /\/rsvp\/([A-Za-z0-9_-]{43})\?/.exec(url)?.[1] ?? '';
    const first = token(env.mails[0]!.rsvp!.accept);
    const view = await env.rsvp.get(first);
    assert.deepEqual(Object.keys(view).sort(), [
      'allDay',
      'cancelled',
      'endsAt',
      'recurring',
      'response',
      'startsAt',
      'timeZone',
      'title',
    ]);
    assert.equal(view.title, 'Planning');
    const before = env.emitted.length;
    const answered = await env.rsvp.answer(first, 'DECLINED');
    assert.equal(answered.response, 'DECLINED');
    const note = env.emitted.slice(before).find((e) => e.type === 'MEETING_RSVP');
    assert.deepEqual(note?.userIds, [ORGANIZER], 'organizer told');
    assert.match(note?.title ?? '', /^Gita Guest declined Planning$/);
    await rejects(env.rsvp.get('A'.repeat(43)), NotFoundException, 'meeting_rsvp_not_found');

    // An update emails the guest again with a fresh link; the old one dies.
    const mailsBefore = env.mails.length;
    await env.editor.update(
      ORG_ACTOR,
      created.id,
      updateMeetingSchema.parse({ location: 'Room 4' }),
      null,
    );
    const update = env.mails.slice(mailsBefore).find((m) => m.to === 'guest@external.example');
    assert.equal(update?.variant, 'update');
    assert.match(update?.ics ?? '', /SEQUENCE:[1-9]/, 'SEQUENCE increments');
    const second = token(update!.rsvp!.accept);
    assert.notEqual(second, first);
    await rejects(env.rsvp.get(first), NotFoundException);
    assert.equal(
      (await env.rsvp.get(second)).response,
      'DECLINED',
      'the answer survives an update that kept the time',
    );

    // An internal attendee's row is never reachable through a link.
    const internalRow = env.db.table('meetingAttendee').find((a) => a['userId'] === ATTENDEE);
    internalRow!['rsvpTokenHash'] = 'f'.repeat(64);
    await rejects(env.rsvp.get('B'.repeat(43)), NotFoundException);

    env.disabled.add(ORG_A);
    await rejects(env.rsvp.get(second), NotFoundException);
    env.disabled.delete(ORG_A);
  });

  // ---------------------------------------------------------------- series edits
  await check('series edits: this occurrence, this and following, cancel', async () => {
    const start = new Date('2027-01-04T05:00:00.000Z'); // Mon 10:00 PKT
    const series = await env.editor.create(
      ORG_ACTOR,
      createInput({
        title: 'Weekly',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 1_800_000).toISOString(),
        recurrence: { freq: 'WEEKLY', byDay: ['MO'], count: 6 },
        attendees: { userIds: [ATTENDEE], emails: [{ email: 'guest2@external.example' }] },
      }),
      null,
    );
    const week = (n: number) => new Date(start.getTime() + n * 7 * 86_400_000);
    const range = { from: new Date('2027-01-01'), to: new Date('2027-03-01') };
    const occ = async (id: string) =>
      (await env.meetings.list(viewer(ATTENDEE, ORG_A), range)).items.filter(
        (i) => i.meetingId === id,
      );
    assert.equal((await occ(series.id)).length, 6);

    // This occurrence: moved an hour later.
    const moved = await env.editor.update(
      ORG_ACTOR,
      series.id,
      updateMeetingSchema.parse({
        scope: 'this',
        occurrenceStart: week(1).toISOString(),
        startsAt: new Date(week(1).getTime() + 3_600_000).toISOString(),
        title: 'Moved one',
      }),
      null,
    );
    assert.equal(moved.meeting?.overrides.length, 1);
    const afterMove = await occ(series.id);
    const one = afterMove.find((o) => o.occurrenceStart.getTime() === week(1).getTime());
    assert.equal(
      one?.startsAt.toISOString(),
      new Date(week(1).getTime() + 3_600_000).toISOString(),
    );
    assert.equal(one?.title, 'Moved one');
    assert.equal(one?.isException, true);
    await rejects(
      env.editor.update(
        ORG_ACTOR,
        series.id,
        updateMeetingSchema.parse({
          scope: 'this',
          occurrenceStart: new Date(week(1).getTime() + 60_000).toISOString(),
          title: 'x',
        }),
        null,
      ),
      NotFoundException,
      'meeting_occurrence_not_found',
    );

    // Cancel one occurrence.
    const mailsBefore = env.mails.length;
    await env.editor.cancel(
      ORG_ACTOR,
      series.id,
      { scope: 'this', occurrenceStart: week(2), notifyAttendees: true },
      null,
    );
    assert.equal((await occ(series.id)).length, 5, 'cancelled occurrence gone');
    const cancelMail = env.mails.slice(mailsBefore).find((m) => m.to === 'guest2@external.example');
    assert.equal(cancelMail?.method, 'CANCEL');
    assert.match(cancelMail?.ics ?? '', /RECURRENCE-ID/, 'CANCEL names the occurrence');

    // This and following: a new series from week 3 with a new title.
    const split = await env.editor.update(
      ORG_ACTOR,
      series.id,
      updateMeetingSchema.parse({
        scope: 'following',
        occurrenceStart: week(3).toISOString(),
        title: 'Weekly v2',
      }),
      null,
    );
    assert.ok(split.newMeetingId, 'a new series');
    const oldOcc = await occ(series.id);
    const newOcc = await occ(split.newMeetingId!);
    assert.deepEqual(
      oldOcc.map((o) => o.occurrenceStart.getTime()),
      [week(0), week(1)].map((d) => d.getTime()),
      'old series keeps weeks 0-1 (week 2 cancelled)',
    );
    assert.deepEqual(
      newOcc.map((o) => o.occurrenceStart.getTime()),
      [week(3), week(4), week(5)].map((d) => d.getTime()),
      'new series has the remaining count',
    );
    assert.ok(newOcc.every((o) => o.title === 'Weekly v2'));
    const newRow = env.db.table('meeting').find((m) => m['id'] === split.newMeetingId);
    assert.notEqual(
      newRow?.['icsUid'],
      env.db.table('meeting').find((m) => m['id'] === series.id)?.['icsUid'],
      'new UID',
    );
    const carried = env.db
      .table('meetingReminder')
      .filter((r) => r['meetingId'] === split.newMeetingId && r['userId'] === ATTENDEE);
    assert.deepEqual(
      carried.map((r) => r['minutesBefore']).sort(),
      [5, 60],
      'reminders carried over',
    );

    // Cancel the whole (new) series.
    const cancelled = await env.editor.cancel(
      ORG_ACTOR,
      split.newMeetingId!,
      { scope: 'all', notifyAttendees: true },
      null,
    );
    assert.equal(cancelled.meeting?.status, 'CANCELLED');
    assert.equal((await occ(split.newMeetingId!)).length, 0, 'cancelled meetings leave the list');
    await rejects(
      env.editor.update(
        ORG_ACTOR,
        split.newMeetingId!,
        updateMeetingSchema.parse({ title: 'x' }),
        null,
      ),
      ConflictException,
      'meeting_cancelled',
    );
  });

  // ---------------------------------------------------------------- reminders
  await check('reminder cron: once per occurrence, snooze, skips', async () => {
    const r = setup();
    const mk = async (over: Partial<CreateMeetingRequest>, by = ORG_ACTOR) =>
      r.editor.create(by, createInput({ notifyAttendees: false, ...over }), null);
    // One-off at T0 with an organizer reminder 10 minutes before.
    const oneOff = await mk({
      title: 'One-off',
      reminders: [10],
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });
    const at = (iso: string) => new Date(iso);
    const reminderNotes = () => r.emitted.filter((e) => e.type === 'MEETING_REMINDER');

    assert.equal(await r.reminders.sweep(at('2026-12-01T09:49:00.000Z')), 0, 'not yet');
    assert.equal(
      await r.reminders.sweep(at('2026-12-01T09:50:00.000Z')),
      1,
      'fires at start - 10 min',
    );
    assert.equal(
      await r.reminders.sweep(at('2026-12-01T09:50:00.000Z')),
      0,
      'a second run does not fire again',
    );
    assert.equal(await r.reminders.sweep(at('2026-12-01T09:51:00.000Z')), 0, 'nor a later one');
    const note = reminderNotes()[0]!;
    assert.equal(note.title, 'One-off in 10 minutes');
    assert.deepEqual(note.userIds, [ORGANIZER]);
    assert.equal(note.url, `/meetings/${oneOff.id}`);
    assert.equal(note.requireInteraction, true);
    assert.equal(note.pushData?.['type'], 'meeting-reminder');
    assert.equal(note.pushData?.['meetingUrl'], 'https://meet.google.com/abc-defg-hij');
    const snooze = note.pushData?.['snooze'] as { deliveryId: string; minutes: number };
    assert.equal(snooze.minutes, 5);

    // Snooze: rings again five minutes later, once.
    await rejects(
      r.meetings.snooze(viewer(ATTENDEE, ORG_A), snooze.deliveryId),
      NotFoundException,
      'meeting_reminder_not_found',
    );
    const s = await r.meetings.snooze(
      viewer(ORGANIZER, ORG_A),
      snooze.deliveryId,
      at('2026-12-01T09:51:00.000Z'),
    );
    assert.equal(s.snoozedUntil.toISOString(), '2026-12-01T09:56:00.000Z');
    assert.equal(await r.reminders.sweep(at('2026-12-01T09:55:00.000Z')), 0);
    assert.equal(
      await r.reminders.sweep(at('2026-12-01T09:56:00.000Z')),
      1,
      'snoozed reminder rings again',
    );
    assert.equal(await r.reminders.sweep(at('2026-12-01T09:57:00.000Z')), 0, 'only once');
    assert.equal(reminderNotes()[1]?.title, 'One-off in 4 minutes');

    // A daily series: an exdate is skipped, a decline silences, a moved
    // occurrence rings at its new time.
    const daily = await mk({
      title: 'Daily',
      startsAt: '2026-12-02T05:00:00.000Z',
      endsAt: '2026-12-02T05:15:00.000Z',
      recurrence: { freq: 'DAILY', count: 5 },
      attendees: { userIds: [ATTENDEE, STAFF2], emails: [] },
      reminders: [10],
    });
    await r.meetings.rsvp(actor(STAFF2, ORG_A), daily.id, { response: 'DECLINED' }, null);
    await r.editor.cancel(
      ORG_ACTOR,
      daily.id,
      {
        scope: 'this',
        occurrenceStart: new Date('2026-12-03T05:00:00.000Z'),
        notifyAttendees: false,
      },
      null,
    );
    await r.editor.update(
      ORG_ACTOR,
      daily.id,
      updateMeetingSchema.parse({
        scope: 'this',
        occurrenceStart: '2026-12-04T05:00:00.000Z',
        startsAt: '2026-12-04T07:00:00.000Z',
        notifyAttendees: false,
      }),
      null,
    );
    const firedFor = async (iso: string) => {
      const before = reminderNotes().length;
      await r.reminders.sweep(at(iso));
      return reminderNotes()
        .slice(before)
        .flatMap((n) => n.userIds)
        .sort();
    };
    // ATTENDEE has 5 and 60, organizer 10, STAFF2 declined (would have 10).
    assert.deepEqual(
      await firedFor('2026-12-02T04:00:00.000Z'),
      [ATTENDEE],
      'day 1, 60 min before',
    );
    assert.deepEqual(
      await firedFor('2026-12-02T04:50:00.000Z'),
      [ORGANIZER],
      'day 1, 10 min before: not the decliner',
    );
    assert.deepEqual(await firedFor('2026-12-02T04:55:00.000Z'), [ATTENDEE], 'day 1, 5 min before');
    assert.deepEqual(
      await firedFor('2026-12-03T04:50:00.000Z'),
      [],
      'cancelled occurrence: nothing',
    );
    assert.deepEqual(
      await firedFor('2026-12-04T04:50:00.000Z'),
      [],
      'moved occurrence: not at the old time',
    );
    assert.deepEqual(
      await firedFor('2026-12-04T06:50:00.000Z'),
      [ORGANIZER],
      'moved occurrence: at the new time',
    );

    // Removed attendee: their leftover reminder row never fires.
    r.db.tables['meetingAttendee'] = r.db
      .table('meetingAttendee')
      .filter((a) => !(a['meetingId'] === daily.id && a['userId'] === ATTENDEE));
    assert.deepEqual(await firedFor('2026-12-05T04:00:00.000Z'), [], 'removed attendee: nothing');

    // Add-on off: nothing; back on: the next occurrence rings.
    r.disabled.add(ORG_A);
    assert.deepEqual(await firedFor('2026-12-05T04:50:00.000Z'), [], 'add-on off: nothing');
    r.disabled.delete(ORG_A);
    assert.deepEqual(await firedFor('2026-12-06T04:50:00.000Z'), [ORGANIZER]);

    // A cancelled meeting never rings; a person moved to another org neither.
    const cancelled = await mk({
      title: 'Cancelled',
      startsAt: '2026-12-10T10:00:00.000Z',
      endsAt: '2026-12-10T11:00:00.000Z',
      reminders: [10],
    });
    await r.editor.cancel(ORG_ACTOR, cancelled.id, { scope: 'all', notifyAttendees: false }, null);
    assert.deepEqual(await firedFor('2026-12-10T09:50:00.000Z'), [], 'cancelled meeting: nothing');
    const moved = await mk({
      title: 'Moved person',
      startsAt: '2026-12-11T10:00:00.000Z',
      endsAt: '2026-12-11T11:00:00.000Z',
      reminders: [10],
    });
    r.db.table('user').find((u) => u['id'] === ORGANIZER)!['organizationId'] = ORG_B;
    assert.deepEqual(
      await firedFor('2026-12-11T09:50:00.000Z'),
      [],
      'organizer now in another organization: nothing',
    );
    r.db.table('user').find((u) => u['id'] === ORGANIZER)!['organizationId'] = ORG_A;
    void moved;

    // DST: a 09:00 Berlin weekly series rings 10 minutes before in both seasons.
    const tz = 'Europe/Berlin';
    const berlin = await mk({
      title: 'Berlin',
      timeZone: tz,
      startsAt: '2027-03-25T08:00:00.000Z',
      endsAt: '2027-03-25T08:30:00.000Z',
      recurrence: { freq: 'WEEKLY', count: 2 },
      reminders: [10],
    });
    void berlin;
    assert.deepEqual(await firedFor('2027-03-25T07:50:00.000Z'), [ORGANIZER], 'CET');
    assert.deepEqual(await firedFor('2027-04-01T06:50:00.000Z'), [ORGANIZER], 'CEST');
    assert.deepEqual(
      await firedFor('2027-04-01T07:50:00.000Z'),
      [],
      'not again by the winter offset',
    );
  });

  // ---------------------------------------------------------------- ICS import
  await check('ics parse: Google, Outlook (Windows zones) and Apple files', () => {
    const g = parseIcsFile(GOOGLE, 'Asia/Karachi');
    assert.equal(g.calendarName, 'Work');
    const standup = g.events.find((e) => e.uid === '7kukuqrfedlm2f5l9tmjf9ugkr@google.com')!;
    assert.equal(standup.timeZone, 'Asia/Karachi');
    assert.equal(standup.startsAt.toISOString(), '2026-11-23T05:00:00.000Z');
    assert.equal(standup.meetingProvider, 'google-meet');
    assert.equal(standup.meetingUrl, 'https://meet.google.com/abc-defg-hij');
    assert.deepEqual(standup.reminders, [10]);
    assert.match(
      standup.description ?? '',
      /^Standup\n\nJoin with Google Meet/,
      'escaped newlines decoded',
    );
    assert.deepEqual(
      standup.exdates.map((d) => d.toISOString()).sort(),
      ['2026-11-25T05:00:00.000Z', '2026-11-30T05:00:00.000Z'],
      'EXDATE and the cancelled exception both remove an occurrence',
    );
    assert.equal(standup.overrides.length, 1);
    assert.equal(standup.overrides[0]?.title, 'Standup (moved)');
    assert.equal(standup.overrides[0]?.startsAt.toISOString(), '2026-11-27T06:00:00.000Z');
    const week = expandOccurrences(standup, new Date('2026-11-23'), new Date('2026-12-01')).items;
    assert.deepEqual(
      week.map((o) => o.startsAt.toISOString()),
      ['2026-11-23T05:00:00.000Z', '2026-11-27T06:00:00.000Z'],
    );
    const holiday = g.events.find((e) => e.uid === 'holiday-1@google.com')!;
    assert.equal(holiday.allDay, true);
    assert.equal(
      holiday.startsAt.toISOString(),
      '2026-12-24T19:00:00.000Z',
      'all-day starts at 00:00 in the importer zone',
    );
    assert.equal(g.events.find((e) => e.uid === 'utc-1@google.com')?.meetingProvider, 'zoom');

    const o = parseIcsFile(OUTLOOK, 'Asia/Karachi');
    const review = o.events.find((e) => e.title === 'Quarterly review')!;
    assert.equal(review.timeZone, 'Europe/Berlin', 'Windows zone mapped to IANA');
    assert.equal(review.sequence, 2);
    assert.equal(review.meetingProvider, 'teams', 'Teams link found in the description');
    assert.deepEqual(review.reminders, [15]);
    assert.deepEqual(
      expandOccurrences(review, new Date('2027-03-01'), new Date('2027-05-01')).items.map((x) =>
        x.startsAt.toISOString(),
      ),
      ['2027-03-25T14:00:00.000Z', '2027-04-01T13:00:00.000Z', '2027-04-08T13:00:00.000Z'],
      '15:00 Berlin across the March change',
    );
    const call = o.events.find((e) => e.uid === 'outlook-pk-1')!;
    assert.equal(call.timeZone, 'Asia/Karachi');
    assert.equal(call.startsAt.toISOString(), '2026-12-01T09:00:00.000Z');
    assert.equal(call.meetingProvider, 'zoom');

    const a = parseIcsFile(APPLE, 'Asia/Karachi');
    const sync = a.events.find((e) => e.title === 'Design sync')!;
    assert.equal(sync.timeZone, 'America/New_York');
    assert.equal(sync.meetingProvider, 'webex');
    assert.deepEqual(sync.reminders, [60], "Apple's ACTION:NONE placeholder alarm is ignored");
    assert.deepEqual(
      expandOccurrences(sync, new Date('2026-10-01'), new Date('2026-12-01')).items.map((x) =>
        x.startsAt.toISOString(),
      ),
      [
        '2026-10-29T13:00:00.000Z',
        '2026-10-30T13:00:00.000Z',
        '2026-10-31T13:00:00.000Z',
        '2026-11-01T14:00:00.000Z',
        '2026-11-02T14:00:00.000Z',
      ],
      '09:00 New York across the November change, UNTIL inclusive',
    );
    const lunch = a.events.find((e) => e.uid === 'floating-1')!;
    assert.equal(lunch.timeZone, 'Asia/Karachi', 'floating time read in the importer zone');
    assert.equal(lunch.startsAt.toISOString(), '2026-12-04T08:00:00.000Z');
  });

  await check(
    'ics import: preview, select all, dedupe, SEQUENCE update, subset, limits',
    async () => {
      const r = setup();
      const me = actor(ATTENDEE, ORG_A);
      const preview = await r.imports.preview(me, upload(GOOGLE));
      assert.equal(preview.events.length, 4);
      assert.ok(preview.events.every((e) => !e.alreadyImported));
      const off = preview.events.find((e) => e.uid === 'cancelled-1@google.com');
      assert.equal(off?.importable, false, 'a cancelled event is not offered');
      assert.equal(preview.events.find((e) => e.uid.startsWith('7kuku'))?.recurring, true);

      const first = await r.imports.import(
        me,
        upload(GOOGLE),
        icsImportSelectionFieldSchema.parse('{"all":true}'),
      );
      assert.deepEqual(
        [first.created, first.updated, first.unchanged, first.skipped],
        [3, 0, 0, 1],
      );
      const standup = r.db
        .table('meeting')
        .find((m) => m['icsUid'] === '7kukuqrfedlm2f5l9tmjf9ugkr@google.com')!;
      assert.equal(standup['source'], 'ICS');
      assert.equal(standup['organizerId'], ATTENDEE, 'the importer owns it');
      assert.equal(
        r.db.table('meetingAttendee').filter((a) => a['meetingId'] === standup['id']).length,
        0,
        'nobody else is added',
      );
      assert.equal(
        r.db.table('meetingOccurrence').filter((o) => o['meetingId'] === standup['id']).length,
        1,
      );
      assert.deepEqual(
        r.db
          .table('meetingReminder')
          .filter((x) => x['meetingId'] === standup['id'])
          .map((x) => x['minutesBefore']),
        [10],
        'VALARM became the reminder',
      );
      const holidayRem = r.db
        .table('meetingReminder')
        .filter(
          (x) =>
            x['meetingId'] ===
            r.db.table('meeting').find((m) => m['icsUid'] === 'holiday-1@google.com')!['id'],
        )
        .map((x) => x['minutesBefore'])
        .sort((x, y) => (x as number) - (y as number));
      assert.deepEqual(holidayRem, [5, 60], 'no alarm: the importer default reminders');
      assert.equal(r.emitted.length + r.mails.length, 0, 'imports notify nobody');

      const again = await r.imports.import(me, upload(GOOGLE), { all: true });
      assert.deepEqual(
        [again.created, again.updated, again.unchanged],
        [0, 0, 3],
        're-import does not duplicate',
      );
      assert.equal(r.db.table('meeting').length, 3);
      const flagged = await r.imports.preview(me, upload(GOOGLE));
      assert.equal(flagged.events.filter((e) => e.alreadyImported).length, 3);

      const changed = Buffer.from(
        GOOGLE.toString('utf8')
          .replace('SUMMARY:Holiday', 'SUMMARY:Public holiday')
          .replace('UID:holiday-1@google.com', 'UID:holiday-1@google.com\r\nSEQUENCE:1'),
      );
      const upd = await r.imports.import(me, upload(changed), { uids: ['holiday-1@google.com'] });
      assert.deepEqual(
        [upd.created, upd.updated, upd.unchanged],
        [0, 1, 0],
        'newer SEQUENCE updates in place',
      );
      assert.equal(
        r.db.table('meeting').find((m) => m['icsUid'] === 'holiday-1@google.com')?.['title'],
        'Public holiday',
      );
      const stale = await r.imports.import(me, upload(GOOGLE), { uids: ['holiday-1@google.com'] });
      assert.deepEqual([stale.updated, stale.unchanged], [0, 1], 'an older SEQUENCE is left alone');

      const other = actor(STAFF2, ORG_A);
      const subset = await r.imports.import(other, upload(OUTLOOK), {
        uids: ['outlook-pk-1', 'not-in-file'],
      });
      assert.deepEqual(
        [subset.created, subset.skipped],
        [1, 1],
        'only the chosen UIDs (unknown ones skipped)',
      );
      const outlookRow = r.db.table('meeting').find((m) => m['icsUid'] === 'outlook-pk-1')!;
      assert.equal(
        outlookRow['organizerId'],
        STAFF2,
        'same UID file imported by another person is their own copy',
      );
      await rejects(
        r.meetings.get(viewer(ATTENDEE, ORG_A), outlookRow['id'] as string, null),
        NotFoundException,
      );

      // Limits and bad input, as RFC 7807 problems.
      const many = ics([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        ...Array.from({ length: 2001 }, (_, i) => [
          'BEGIN:VEVENT',
          `UID:e${i}`,
          'DTSTART:20261201T100000Z',
          'DTEND:20261201T110000Z',
          'SUMMARY:x',
          'END:VEVENT',
        ]).flat(),
        'END:VCALENDAR',
      ]);
      await rejects(
        r.imports.preview(me, upload(many)),
        UnprocessableEntityException,
        'ics_too_many_events',
      );
      await rejects(
        r.imports.preview(me, upload(Buffer.alloc(2 * 1024 * 1024 + 1, 0x41))),
        PayloadTooLargeException,
        'ics_too_large',
      );
      await rejects(
        r.imports.preview(me, upload(Buffer.from('BEGIN:VCALENDAR\r\nnot a calendar'))),
        BadRequestException,
        'ics_invalid',
      );
      await rejects(
        r.imports.preview(me, upload(GOOGLE, 'calendar.txt', 'text/plain')),
        BadRequestException,
        'ics_invalid',
      );
      await rejects(r.imports.preview(me, undefined), BadRequestException, 'ics_invalid');
      assert.ok(
        !icsImportSelectionFieldSchema.safeParse('{"uids":[]}').success,
        'an empty selection is refused',
      );
      const partlyBroken = ics([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:no-start',
        'SUMMARY:No start',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:fine',
        'DTSTART:20261201T100000Z',
        'DTEND:20261201T110000Z',
        'SUMMARY:Fine',
        'END:VEVENT',
        'END:VCALENDAR',
      ]);
      const partly = await r.imports.preview(
        me,
        upload(partlyBroken, 'export.ics', 'application/octet-stream'),
      );
      assert.deepEqual(
        partly.events.map((e) => e.uid),
        ['fine'],
        'a broken event never fails the rest (and .ics by name is accepted)',
      );
      assert.equal(partly.unreadable, 1, 'the broken one is counted');
    },
  );

  // ---------------------------------------------------------------- feed
  await check('calendar feed: token flow and contents', async () => {
    const r = setup();
    const mine = await r.editor.create(
      ORG_ACTOR,
      createInput({
        title: 'Series',
        timeZone: 'Europe/Berlin',
        startsAt: '2026-11-23T08:00:00.000Z',
        endsAt: '2026-11-23T09:00:00.000Z',
        recurrence: { freq: 'WEEKLY', count: 20 },
        attendees: { userIds: [ATTENDEE], emails: [] },
        notifyAttendees: false,
      }),
      null,
    );
    const declined = await r.editor.create(
      ORG_ACTOR,
      createInput({
        title: 'Declined one',
        attendees: { userIds: [ATTENDEE], emails: [] },
        notifyAttendees: false,
      }),
      null,
    );
    await r.meetings.rsvp(actor(ATTENDEE, ORG_A), declined.id, { response: 'DECLINED' }, null);
    const notMine = await r.editor.create(
      actor(STAFF2, ORG_A),
      createInput({ title: 'Private to staff2', notifyAttendees: false }),
      null,
    );
    void notMine;

    assert.equal((await r.feed.status(ATTENDEE)).active, false);
    const link = await r.feed.regenerate(ATTENDEE);
    const token = /\/meetings\/feed\/([A-Za-z0-9_-]{43})\.ics$/.exec(link.url)?.[1];
    assert.ok(token, 'feed URL carries the token');
    assert.ok(link.webcalUrl.startsWith('webcal://'));
    assert.match(
      String(r.db.table('meetingFeedToken')[0]?.['tokenHash']),
      /^[0-9a-f]{64}$/,
      'only the hash is stored',
    );
    assert.equal((await r.feed.status(ATTENDEE)).active, true);

    const body = await r.feed.render(token!, new Date('2026-11-20T00:00:00.000Z'));
    assert.match(body, /METHOD:PUBLISH/);
    const uid = r.db.table('meeting').find((m) => m['id'] === mine.id)?.['icsUid'] as string;
    assert.ok(body.includes(`UID:${uid}`), 'my meeting is in the feed');
    assert.ok(!body.includes('Declined one'), 'declined meetings are left out');
    assert.ok(!body.includes('Private to staff2'), "other people's meetings are never in it");
    assert.match(body, /TRIGGER:-PT1H/, 'my 60-minute reminder');
    assert.match(body, /TRIGGER:-PT5M/, 'my 5-minute reminder');
    assert.match(body, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Berlin/, 'zone for the series');
    const back = parseIcsFile(Buffer.from(body), 'UTC');
    const series = back.events.find((e) => e.uid === uid)!;
    assert.equal(series.timeZone, 'Europe/Berlin');
    assert.deepEqual(
      expandOccurrences(series, new Date('2027-03-20'), new Date('2027-04-01')).items.map((x) =>
        x.startsAt.toISOString(),
      ),
      ['2027-03-22T08:00:00.000Z', '2027-03-29T07:00:00.000Z'],
      'the feed keeps 09:00 Berlin across DST',
    );
    assert.ok(new ICAL.Component(ICAL.parse(body)).getAllSubcomponents('vevent').length >= 1);

    const fresh = await r.feed.regenerate(ATTENDEE);
    await rejects(r.feed.render(token!), NotFoundException);
    const freshToken = /\/feed\/([A-Za-z0-9_-]{43})\.ics$/.exec(fresh.url)![1]!;
    r.disabled.add(ORG_A);
    await rejects(r.feed.render(freshToken), NotFoundException);
    r.disabled.delete(ORG_A);
    r.db.table('organization').find((o) => o['id'] === ORG_A)!['isActive'] = false;
    await rejects(r.feed.render(freshToken), NotFoundException);
    r.db.table('organization').find((o) => o['id'] === ORG_A)!['isActive'] = true;
    await r.feed.render(freshToken);
    await r.feed.revoke(ATTENDEE);
    await rejects(r.feed.render(freshToken), NotFoundException);
    await rejects(r.feed.render('Z'.repeat(43)), NotFoundException);
  });

  await check('delete and cancel close RSVP links and notify', async () => {
    const r = setup();
    const m = await r.editor.create(
      ORG_ACTOR,
      createInput({
        attendees: { userIds: [ATTENDEE], emails: [{ email: 'g3@external.example' }] },
      }),
      null,
    );
    const token = /\/rsvp\/([A-Za-z0-9_-]{43})\?/.exec(r.mails[0]!.rsvp!.accept)![1]!;
    await r.editor.cancel(ORG_ACTOR, m.id, { scope: 'all', notifyAttendees: true }, null);
    assert.equal((await r.rsvp.get(token)).cancelled, true);
    await rejects(r.rsvp.answer(token, 'ACCEPTED'), ConflictException, 'meeting_cancelled');
    assert.ok(
      r.emitted.some((e) => e.type === 'MEETING_CANCELLED' && e.userIds.includes(ATTENDEE)),
    );
    assert.equal(r.mails.at(-1)?.method, 'CANCEL');
    const m2 = await r.editor.create(
      ORG_ACTOR,
      createInput({ attendees: { userIds: [], emails: [{ email: 'g4@external.example' }] } }),
      null,
    );
    const token2 = /\/rsvp\/([A-Za-z0-9_-]{43})\?/.exec(r.mails.at(-1)!.rsvp!.accept)![1]!;
    await r.editor.remove(ORG_ACTOR, m2.id, true);
    assert.equal(r.mails.at(-1)?.method, 'CANCEL', 'deleting a live meeting cancels it for guests');
    await rejects(r.rsvp.get(token2), NotFoundException);
    await rejects(r.meetings.get(viewer(ORGANIZER, ORG_A), m2.id, null), NotFoundException);
  });

  // ---------------------------------------------------------------- hardening
  await check('recurrence: unsafe rules are refused fast, COUNT is capped, long walks stop', () => {
    for (const bad of [
      'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
      'FREQ=WEEKLY;BYMONTHDAY=1',
      'FREQ=DAILY;BYDAY=MO;BYSETPOS=1',
      'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30',
      'FREQ=YEARLY;BYMONTH=2,3;BYMONTHDAY=31',
      'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=9',
      'FREQ=DAILY;COUNT=1001',
    ]) {
      const started = Date.now();
      assert.notEqual(ruleProblem(bad), null, `${bad} is refused`);
      assert.ok(Date.now() - started < 500, `${bad} is refused fast`);
    }
    for (const fine of [
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
      'FREQ=MONTHLY;BYMONTHDAY=31',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'FREQ=DAILY;COUNT=1000',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    ]) {
      assert.equal(ruleProblem(fine), null, `${fine} is accepted`);
    }
    const hang = parseIcsFile(
      ics([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:hang-1',
        'DTSTART:20261201T100000Z',
        'DTEND:20261201T110000Z',
        'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
        'SUMMARY:Never',
        'END:VEVENT',
        'END:VCALENDAR',
      ]),
      'UTC',
      CLOCK.getTime(),
    );
    assert.ok(hang.events[0]?.problem, 'the import marks it not importable');

    const old: SeriesShape = {
      startsAt: new Date('1900-01-01T09:00:00.000Z'),
      endsAt: new Date('1900-01-01T09:30:00.000Z'),
      allDay: false,
      timeZone: 'UTC',
      rrule: 'FREQ=DAILY',
      exdates: [],
      overrides: [],
    };
    const started = Date.now();
    const far = expandOccurrences(old, new Date('2026-01-01'), new Date('2026-02-01'));
    assert.equal(
      far.truncated,
      true,
      `a walk past ${MAX_ITERATIONS} iterations is reported as truncated`,
    );
    assert.ok(Date.now() - started < 3_000, 'and stops');
  });

  await check('recurrence: one iteration budget per request', async () => {
    const budget = newExpansionBudget(50);
    const daily: SeriesShape = {
      startsAt: new Date('2026-01-01T09:00:00.000Z'),
      endsAt: new Date('2026-01-01T09:30:00.000Z'),
      allDay: false,
      timeZone: 'UTC',
      rrule: 'FREQ=DAILY',
      exdates: [],
      overrides: [],
    };
    const res = expandOccurrences(daily, new Date('2026-03-01'), new Date('2026-03-10'), {
      budget,
    });
    assert.equal(res.truncated, true);
    assert.equal(budget.exhausted, true);

    // Many long series in one list call: what fits is listed, the rest is
    // reported as truncated instead of running on.
    const r = setup();
    for (let i = 0; i < 25; i += 1) {
      r.db.insert('meeting', {
        organizationId: ORG_A,
        organizerId: ORGANIZER,
        title: `Long ${i}`,
        startsAt: new Date('2000-01-03T09:00:00.000Z'),
        endsAt: new Date('2000-01-03T09:30:00.000Z'),
        timeZone: 'UTC',
        rrule: 'FREQ=DAILY',
        icsUid: `long-${i}`,
      });
    }
    const list = await r.meetings.list(viewer(ORGANIZER, ORG_A), {
      from: new Date('2026-12-01'),
      to: new Date('2026-12-03'),
    });
    assert.equal(list.truncated, true, 'over budget: truncated');
    assert.ok(list.items.length > 0, 'the series that fit are listed');
  });

  await check(
    'ics import: an old series starts from a year ago, with its later changes',
    async () => {
      const parsed = parseIcsFile(
        ics([
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:old-weekly',
          'DTSTART:20100104T090000Z',
          'DTEND:20100104T093000Z',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'EXDATE:20120102T090000Z,20261123T090000Z',
          'SUMMARY:Old weekly',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:old-weekly',
          'RECURRENCE-ID:20110103T090000Z',
          'DTSTART:20110103T100000Z',
          'DTEND:20110103T103000Z',
          'SUMMARY:Old moved',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:old-weekly',
          'RECURRENCE-ID:20261130T090000Z',
          'DTSTART:20261130T100000Z',
          'DTEND:20261130T103000Z',
          'SUMMARY:New moved',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:ancient',
          'DTSTART:08000101T090000Z',
          'DTEND:08000101T093000Z',
          'RRULE:FREQ=DAILY',
          'SUMMARY:Ancient',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:old-count',
          'DTSTART:20100104T090000Z',
          'DTEND:20100104T093000Z',
          'RRULE:FREQ=WEEKLY;COUNT=10',
          'SUMMARY:Old count',
          'END:VEVENT',
          'END:VCALENDAR',
        ]),
        'UTC',
        CLOCK.getTime(),
      );
      const weekly = parsed.events.find((e) => e.uid === 'old-weekly')!;
      assert.equal(weekly.problem, null);
      assert.equal(
        weekly.startsAt.toISOString(),
        '2025-11-24T09:00:00.000Z',
        'first Monday on or after a year ago',
      );
      assert.equal(weekly.endsAt.toISOString(), '2025-11-24T09:30:00.000Z');
      assert.deepEqual(
        weekly.exdates.map((d) => d.toISOString()),
        ['2026-11-23T09:00:00.000Z'],
        'older exdates dropped',
      );
      assert.deepEqual(
        weekly.overrides.map((o) => o.title),
        ['New moved'],
        'older changed occurrences dropped',
      );
      assert.deepEqual(
        expandOccurrences(weekly, new Date('2026-11-20'), new Date('2026-12-08')).items.map((o) =>
          o.startsAt.toISOString(),
        ),
        ['2026-11-30T10:00:00.000Z', '2026-12-07T09:00:00.000Z'],
        'the series still lands on its Mondays',
      );
      assert.match(
        parsed.events.find((e) => e.uid === 'ancient')?.problem ?? '',
        /too far/,
        'a series too long to read is refused',
      );
      const counted = parsed.events.find((e) => e.uid === 'old-count')!;
      assert.equal(
        counted.startsAt.toISOString(),
        '2010-01-04T09:00:00.000Z',
        'a COUNT series is short already: kept',
      );
    },
  );

  await check('ics import: caps on cancelled and changed dates', () => {
    const stamp = (ms: number) =>
      new Date(ms)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    const day = (i: number) => Date.UTC(2026, 11, 1, 10) + i * 86_400_000;
    const tooManyExdates = parseIcsFile(
      ics([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:exdates-1',
        'DTSTART:20261201T100000Z',
        'DTEND:20261201T110000Z',
        'RRULE:FREQ=DAILY',
        `EXDATE:${Array.from({ length: 1001 }, (_, i) => stamp(day(i + 1))).join(',')}`,
        'SUMMARY:Many exdates',
        'END:VEVENT',
        'END:VCALENDAR',
      ]),
      'UTC',
      CLOCK.getTime(),
    );
    assert.match(tooManyExdates.events[0]?.problem ?? '', /1,000 cancelled dates/);
    const exceptions = Array.from({ length: 501 }, (_, i) => [
      'BEGIN:VEVENT',
      'UID:overrides-1',
      `RECURRENCE-ID:${stamp(day(i + 1))}`,
      `DTSTART:${stamp(day(i + 1) + 3_600_000)}`,
      `DTEND:${stamp(day(i + 1) + 7_200_000)}`,
      'SUMMARY:Moved',
      'END:VEVENT',
    ]).flat();
    const tooManyOverrides = parseIcsFile(
      ics([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:overrides-1',
        'DTSTART:20261201T100000Z',
        'DTEND:20261201T110000Z',
        'RRULE:FREQ=DAILY',
        'SUMMARY:Many changes',
        'END:VEVENT',
        ...exceptions,
        'END:VCALENDAR',
      ]),
      'UTC',
      CLOCK.getTime(),
    );
    assert.match(tooManyOverrides.events[0]?.problem ?? '', /500 changed dates/);
  });

  await check(
    'reminder cron: nextFireAt selection, every page, no flood after downtime',
    async () => {
      const r = setup();
      const daily = await r.editor.create(
        ORG_ACTOR,
        createInput({
          title: 'Daily',
          startsAt: '2026-12-02T05:00:00.000Z',
          endsAt: '2026-12-02T05:15:00.000Z',
          recurrence: { freq: 'DAILY', count: 5 },
          reminders: [10],
          notifyAttendees: false,
        }),
        null,
      );
      const rem = () => r.db.table('meetingReminder').find((x) => x['meetingId'] === daily.id)!;
      assert.equal(
        (rem()['nextFireAt'] as Date).toISOString(),
        '2026-12-02T04:50:00.000Z',
        'written with the meeting',
      );

      // The worker was down for two days: the missed rings are skipped, the
      // one still inside the grace window rings once.
      const notes = () => r.emitted.filter((e) => e.type === 'MEETING_REMINDER');
      assert.equal(
        await r.reminders.sweep(new Date('2026-12-04T04:55:00.000Z')),
        1,
        'only the ring within the grace window',
      );
      assert.equal(notes().at(-1)?.title, 'Daily in 5 minutes');
      assert.equal(
        (rem()['nextFireAt'] as Date).toISOString(),
        '2026-12-05T04:50:00.000Z',
        'moved to the next ring',
      );

      // A cancel silences it at once.
      await r.editor.cancel(ORG_ACTOR, daily.id, { scope: 'all', notifyAttendees: false }, null);
      assert.equal(rem()['nextFireAt'], null);

      // More due reminders than one page: every one rings.
      const many = REMINDER_BATCH + 20;
      for (let i = 0; i < many; i += 1) {
        const m = r.db.insert('meeting', {
          organizationId: ORG_A,
          organizerId: ORGANIZER,
          title: `Bulk ${i}`,
          startsAt: new Date('2026-12-20T10:00:00.000Z'),
          endsAt: new Date('2026-12-20T10:30:00.000Z'),
          lastEndsAt: new Date('2026-12-20T10:30:00.000Z'),
          timeZone: 'UTC',
          icsUid: `bulk-${i}`,
        });
        r.db.insert('meetingReminder', {
          meetingId: m['id'],
          userId: ORGANIZER,
          minutesBefore: 10,
          nextFireAt: new Date('2026-12-20T09:50:00.000Z'),
        });
      }
      assert.equal(
        await r.reminders.sweep(new Date('2026-12-20T09:50:00.000Z')),
        many,
        'no silent cap',
      );
      assert.equal(
        await r.reminders.sweep(new Date('2026-12-20T09:51:00.000Z')),
        0,
        'and each once',
      );
    },
  );

  await check('edit: people who left are dropped, new outsiders refused', async () => {
    const r = setup();
    const m = await r.editor.create(
      ORG_ACTOR,
      createInput({
        attendees: { userIds: [ATTENDEE, STAFF2], emails: [] },
        notifyAttendees: false,
      }),
      null,
    );
    r.db.table('user').find((u) => u['id'] === STAFF2)!['organizationId'] = ORG_B;
    const before = r.emitted.length;
    const res = await r.editor.update(
      ORG_ACTOR,
      m.id,
      updateMeetingSchema.parse({
        title: 'Renamed',
        attendees: { userIds: [ATTENDEE, STAFF2], emails: [] },
      }),
      null,
    );
    assert.deepEqual(
      res.meeting?.attendees.map((a) => a.userId),
      [ATTENDEE],
      'the leaver is dropped, the save goes through',
    );
    assert.ok(
      !r.emitted.slice(before).some((e) => e.userIds.includes(STAFF2)),
      'the leaver is not notified',
    );
    await rejects(
      r.editor.update(
        ORG_ACTOR,
        m.id,
        updateMeetingSchema.parse({ attendees: { userIds: [ATTENDEE, USER_B], emails: [] } }),
        null,
      ),
      BadRequestException,
      'meeting_attendee_not_in_org',
    );
  });

  await check('ics output: no CR injection, VTIMEZONE covers today', () => {
    assert.equal(createInput({ title: 'A\r\nB' }).title, 'A B', 'titles are one line');
    assert.equal(
      createInput({ description: 'x\r\ny\rz' }).description,
      'x\ny\nz',
      'descriptions keep LF only',
    );
    assert.equal(createInput({ location: 'Room\r4' }).location, 'Room 4');
    assert.equal(icsText('a\r\nb\rc\u0007d'), 'a\nb\ncd');
    const m: IcsMeeting = {
      uid: 'u1@meetings.botss',
      sequence: 0,
      title: 'T\rATTENDEE:mailto:evil@x.example',
      description: 'line1\r\nORGANIZER:mailto:evil@x.example',
      location: 'L\rX-INJECT:1',
      meetingUrl: null,
      startsAt: T0,
      endsAt: new Date(T0.getTime() + 3_600_000),
      allDay: false,
      timeZone: 'UTC',
      rrule: null,
      exdates: [],
      overrides: [],
      status: 'CONFIRMED',
      organizer: { email: 'o@example.com', name: 'O' },
      attendees: [
        { email: 'g@external.example', name: null, response: 'NEEDS_ACTION', external: true },
      ],
      updatedAt: T0,
    };
    for (const out of [
      buildRequestIcs(m, 'g@external.example'),
      buildCancelIcs(m, 'g@external.example'),
      buildFeedIcs([{ meeting: m, alarms: [10] }], 'Cal\rX-EVIL:1'),
    ]) {
      assert.ok(!/\r(?!\n)/.test(out), 'no bare CR');
      const lines = out.replace(/\r\n /g, '').split('\r\n');
      assert.ok(
        !lines.some((l) => /^(ATTENDEE:mailto:evil|ORGANIZER:mailto:evil|X-INJECT|X-EVIL)/.test(l)),
        'no injected property',
      );
    }
    const tz = buildVtimezone('Europe/Berlin', Date.UTC(2015, 5, 1), CLOCK.getTime()).toString();
    assert.match(tz, /DTSTART:2014/, 'from the year before the start');
    assert.match(tz, /DTSTART:2031/, 'to five years past now');
    assert.ok(!/DTSTART:2032/.test(tz));
  });

  await check(
    'guest emails: links rotate only once queued, guests see only themselves',
    async () => {
      const r = setup();
      const m = await r.editor.create(
        ORG_ACTOR,
        createInput({
          attendees: {
            userIds: [ATTENDEE],
            emails: [{ email: 'g5@external.example' }, { email: 'g6@external.example' }],
          },
        }),
        null,
      );
      const tokenOf = (to: string) =>
        /\/rsvp\/([A-Za-z0-9_-]{43})\?/.exec(
          r.mails.filter((x) => x.to === to).at(-1)!.rsvp!.accept,
        )![1]!;
      const invite = r.mails.find((x) => x.to === 'g5@external.example')!.ics.replace(/\r\n /g, '');
      assert.ok(invite.includes('mailto:g5@external.example'));
      assert.ok(invite.includes(`ORGANIZER;CN=`), 'the organizer is named');
      assert.ok(!invite.includes('g6@external.example'), 'other guests are not listed');
      assert.ok(
        !invite.includes(`${ATTENDEE.slice(3, 12)}@example.com`),
        'staff addresses are not listed',
      );

      const t5 = tokenOf('g5@external.example');
      const t6 = tokenOf('g6@external.example');
      r.mailFails.add('g5@external.example');
      await r.editor.update(
        ORG_ACTOR,
        m.id,
        updateMeetingSchema.parse({ location: 'Room 9' }),
        null,
      );
      assert.equal(
        (await r.rsvp.get(t5)).title,
        'Planning',
        'the email failed: the old link still works',
      );
      const t6b = tokenOf('g6@external.example');
      assert.notEqual(t6b, t6);
      await rejects(r.rsvp.get(t6), NotFoundException);

      r.mailFails.clear();
      r.mailStub.on = true;
      const sent = r.mails.length;
      await r.editor.update(
        ORG_ACTOR,
        m.id,
        updateMeetingSchema.parse({ location: 'Room 10' }),
        null,
      );
      assert.equal(r.mails.length, sent, 'no transport: nothing sent');
      await r.rsvp.get(t5);
      await r.rsvp.get(t6b);
    },
  );

  await check('ics import: revive a deleted import, SEQUENCE rules', async () => {
    const r = setup();
    const me = actor(ATTENDEE, ORG_A);
    const file = (seq: number, title: string, status = 'CONFIRMED') =>
      ics([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:seq-1',
        'DTSTART:20261210T100000Z',
        'DTEND:20261210T110000Z',
        `SEQUENCE:${seq}`,
        `SUMMARY:${title}`,
        `STATUS:${status}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ]);
    const row = () => r.db.table('meeting').find((x) => x['icsUid'] === 'seq-1')!;
    const first = await r.imports.import(me, upload(file(0, 'One')), { all: true });
    const id = first.meetingIds[0]!;
    const eq = await r.imports.import(me, upload(file(0, 'One b')), { all: true });
    assert.equal(eq.updated, 1, 'equal SEQUENCE, nobody added: updated');
    assert.equal(row()['title'], 'One b');

    await r.editor.update(
      me,
      id,
      updateMeetingSchema.parse({
        attendees: { userIds: [STAFF2], emails: [] },
        notifyAttendees: false,
      }),
      null,
    );
    const kept = await r.imports.import(me, upload(file(Number(row()['sequence']), 'One c')), {
      all: true,
    });
    assert.deepEqual(
      [kept.updated, kept.unchanged],
      [0, 1],
      'equal SEQUENCE after people were added: left alone',
    );
    assert.equal(row()['title'], 'One b');
    const newer = await r.imports.import(me, upload(file(5, 'One d')), { all: true });
    assert.equal(newer.updated, 1, 'a newer SEQUENCE updates');
    assert.equal(row()['title'], 'One d');

    await r.editor.remove(me, id, false);
    const seqAfterDelete = Number(row()['sequence']);
    const gone = await r.imports.import(me, upload(file(9, 'Gone', 'CANCELLED')), { all: true });
    assert.deepEqual(
      [gone.updated, gone.skipped, gone.meetingIds],
      [0, 1, []],
      'a cancelled event never revives (and no deleted id)',
    );
    const back = await r.imports.import(me, upload(file(1, 'Back')), { all: true });
    assert.deepEqual([back.updated, back.meetingIds], [1, [id]]);
    assert.equal(row()['deletedAt'], null, 'revived');
    assert.equal(row()['sequence'], Math.max(seqAfterDelete + 1, 1), 'SEQUENCE above both');
    assert.equal(
      r.db.table('meetingAttendee').filter((a) => a['meetingId'] === id).length,
      0,
      'attendees not brought back',
    );
    assert.ok(
      !r.db.table('meetingReminder').some((x) => x['meetingId'] === id && x['userId'] === STAFF2),
      'nor their reminders',
    );
  });

  await check('snooze: refused after the end, a snoozed ring skips an ended meeting', async () => {
    const r = setup();
    await r.editor.create(
      ORG_ACTOR,
      createInput({ title: 'Short', reminders: [10], notifyAttendees: false }),
      null,
    );
    await r.reminders.sweep(new Date('2026-12-01T09:50:00.000Z'));
    const note = r.emitted.find((e) => e.type === 'MEETING_REMINDER')!;
    const deliveryId = (note.pushData?.['snooze'] as { deliveryId: string }).deliveryId;
    await rejects(
      r.meetings.snooze(viewer(ORGANIZER, ORG_A), deliveryId, new Date('2026-12-01T11:00:00.000Z')),
      ConflictException,
      'meeting_snooze_ended',
    );
    await r.meetings.snooze(
      viewer(ORGANIZER, ORG_A),
      deliveryId,
      new Date('2026-12-01T10:56:00.000Z'),
    );
    assert.equal(
      await r.reminders.sweep(new Date('2026-12-01T11:01:00.000Z')),
      0,
      'over by then: the snooze does not ring',
    );
  });

  if (failures > 0) {
    console.error(`check-meetings: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('check-meetings: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
