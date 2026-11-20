'use client';

import {
  meetingReminderPushDataSchema,
  realtimePushEventSchema,
  type MeetingReminderPushData,
} from '@botss/shared-types';
import { useEffect, useRef } from 'react';

import { useSnoozeReminder } from '@/hooks/use-meetings';
import { getChatNotifications } from '@/lib/chat-prefs';
import { getChatSocket } from '@/lib/chat-socket';
import { RingLoop } from '@/lib/chat-sounds';
import { openMeetingLink } from '@/lib/meetings/meeting-links';
import {
  meetingNotificationTag,
  useAlarmStore,
  type MeetingAlarm,
} from '@/lib/meetings/reminder-alarm-store';

/** The alarm stops ringing by itself after this long; the modal stays until answered. */
const RING_MAX_MS = 45_000;
/** A reminder is loud even when the person set the volume low or off. */
const MIN_VOLUME = 0.5;

function readSnoozeId(detail: unknown): string | null {
  const id = (detail as { deliveryId?: unknown } | null | undefined)?.deliveryId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Ask the browser notification (service worker) of this reminder to go away. */
function clearSystemNotification(tag: string): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'botss:clear-meeting', tag });
  } catch {
    /* no service worker */
  }
}

/**
 * Meeting reminders ringing inside the open app. They come in over the chat
 * socket (`os_notification`, the same push a phone gets), ring even with Do
 * Not Disturb on (a decision: a missed meeting costs more than a sound), and
 * stay on screen until the person joins, snoozes or dismisses them. Also
 * takes Snooze taps from the system notification (service worker) and the
 * phone shell.
 */
export function useMeetingReminderAlarm(userId: string | null) {
  const alarms = useAlarmStore((s) => s.alarms);
  const push = useAlarmStore((s) => s.push);
  const remove = useAlarmStore((s) => s.remove);
  const snooze = useSnoozeReminder();
  const ring = useRef<RingLoop | null>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Incoming reminders.
  useEffect(() => {
    if (!userId) return;
    const socket = getChatSocket();
    const onPush = (raw: unknown) => {
      const event = realtimePushEventSchema.safeParse(raw);
      if (!event.success) return;
      const data = meetingReminderPushDataSchema.safeParse(event.data.data);
      if (!data.success) return;
      const d: MeetingReminderPushData = data.data;
      const alarm: MeetingAlarm = {
        deliveryId: d.snooze.deliveryId,
        meetingId: d.meetingId,
        title: event.data.title,
        body: event.data.body,
        meetingUrl: d.meetingUrl,
        url: event.data.url ?? `/meetings/${d.meetingId}`,
        tag: meetingNotificationTag(d.meetingId, d.occurrenceStart),
      };
      push(alarm);
    };
    socket.on('os_notification', onPush);
    return () => {
      socket.off('os_notification', onPush);
    };
  }, [userId, push]);

  // Snooze taps from a system notification (service worker) or the phone shell.
  const { mutate: snoozeMutate } = snooze;
  useEffect(() => {
    if (!userId) return;
    const take = (id: string | null) => {
      if (id) snoozeMutate(id);
    };
    const onWorkerMessage = (e: MessageEvent) => {
      if ((e.data as { type?: unknown } | null)?.type !== 'botss:meeting-snooze') return;
      take(readSnoozeId(e.data));
      remove(readSnoozeId(e.data) ?? '');
    };
    const drainQueued = () => {
      const w = window as unknown as { __BOTSS_MEETING_SNOOZES__?: unknown[] };
      const queued = w.__BOTSS_MEETING_SNOOZES__;
      w.__BOTSS_MEETING_SNOOZES__ = [];
      for (const id of queued ?? []) {
        if (typeof id === 'string' && id) {
          take(id);
          remove(id);
        }
      }
    };
    window.addEventListener('botss:meeting-snooze', drainQueued);
    drainQueued();
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
    return () => {
      window.removeEventListener('botss:meeting-snooze', drainQueued);
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
    };
  }, [userId, snoozeMutate, remove]);

  // Ring while any alarm is showing. A browser that blocks sound until the
  // page has been touched just stays silent; the modal still shows.
  // The ring is stopped by the timeout, so a delivery that arrives later
  // (one not yet rung for) starts it again; removing an alarm does not.
  const alarmCount = alarms.length;
  const alarmKey = alarms.map((a) => a.deliveryId).join(',');
  const rungFor = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (alarmCount === 0) {
      ring.current?.stop();
      ring.current = null;
      rungFor.current.clear();
      if (ringTimer.current) clearTimeout(ringTimer.current);
      return;
    }
    const fresh = alarmKey.split(',').filter((id) => !rungFor.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => rungFor.current.add(id));
    if (ring.current) {
      // Already ringing: a new delivery gets a full ring period.
      if (ringTimer.current) clearTimeout(ringTimer.current);
      const current = ring.current;
      ringTimer.current = setTimeout(() => {
        current.stop();
        if (ring.current === current) ring.current = null;
      }, RING_MAX_MS);
      return;
    }
    try {
      const loop = new RingLoop();
      loop.start(Math.max(getChatNotifications().volume, MIN_VOLUME));
      ring.current = loop;
      ringTimer.current = setTimeout(() => {
        loop.stop();
        if (ring.current === loop) ring.current = null;
      }, RING_MAX_MS);
    } catch {
      /* audio unavailable */
    }
  }, [alarmCount, alarmKey]);
  useEffect(
    () => () => {
      ring.current?.stop();
      if (ringTimer.current) clearTimeout(ringTimer.current);
    },
    [],
  );

  function silence(): void {
    ring.current?.stop();
    ring.current = null;
    if (ringTimer.current) clearTimeout(ringTimer.current);
  }

  return {
    alarms,
    join: (alarm: MeetingAlarm) => {
      if (alarm.meetingUrl) openMeetingLink(alarm.meetingUrl);
      clearSystemNotification(alarm.tag);
      remove(alarm.deliveryId);
      silence();
    },
    snooze: (alarm: MeetingAlarm) => {
      snooze.mutate(alarm.deliveryId);
      clearSystemNotification(alarm.tag);
      remove(alarm.deliveryId);
      silence();
    },
    dismiss: (alarm: MeetingAlarm) => {
      clearSystemNotification(alarm.tag);
      remove(alarm.deliveryId);
      silence();
    },
    snoozing: snooze.isPending,
  };
}
