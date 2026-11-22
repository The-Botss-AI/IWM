import { create } from 'zustand';

/** One meeting reminder ringing in the open app. */
export interface MeetingAlarm {
  /** The reminder delivery (also what Snooze posts). */
  deliveryId: string;
  meetingId: string;
  /** "<title> starts in 10 minutes". */
  title: string;
  /** When and where. */
  body: string;
  meetingUrl: string | null;
  /** Page of the meeting (with the occurrence). */
  url: string;
  /** Tag of the system notification (browser push) to clear along with this alarm. */
  tag: string;
}

interface AlarmState {
  alarms: MeetingAlarm[];
  push: (alarm: MeetingAlarm) => void;
  remove: (deliveryId: string) => void;
  clear: () => void;
}

export const useAlarmStore = create<AlarmState>((set) => ({
  alarms: [],
  push: (alarm) =>
    set((s) => ({
      // The same delivery twice (socket repeat) rings once; a snoozed one rings again as a new delivery.
      alarms: s.alarms.some((a) => a.deliveryId === alarm.deliveryId)
        ? s.alarms
        : [...s.alarms, alarm],
    })),
  remove: (deliveryId) =>
    set((s) => ({ alarms: s.alarms.filter((a) => a.deliveryId !== deliveryId) })),
  clear: () => set({ alarms: [] }),
}));

/** Tag the service worker gives a reminder's browser notification. */
export function meetingNotificationTag(meetingId: string, occurrenceStart: string): string {
  return `meeting-${meetingId}-${occurrenceStart}`;
}
