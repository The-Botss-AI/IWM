/**
 * Call notification plumbing shared by the call hook.
 *
 * A call push is a system notification (phone shell or browser service
 * worker). It has to disappear when the call ends, is declined, or is
 * answered on another device, and its Decline button has to reach the call
 * socket. The pieces here only post messages; the receivers are the mobile
 * shell (`apps/mobile/app/index.tsx`) and `public/sw.js`.
 */

/** Same tag the server puts on the call push (`call:<roomId>`). */
export function callNotificationTag(roomId: string): string {
  return `call:${roomId}`;
}

/** Ask the phone shell and the service worker to remove this call's notification. */
export function clearCallNotification(callId: string, roomId: string | null): void {
  if (typeof window === 'undefined') return;
  const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } })
    .ReactNativeWebView;
  rn?.postMessage(JSON.stringify({ type: 'botss:call-ended', callId }));
  if (roomId) {
    navigator.serviceWorker?.controller?.postMessage({
      type: 'botss:clear-call',
      tag: callNotificationTag(roomId),
    });
  }
}

/** Call id from a `botss:call-decline` event detail or service-worker message, if valid. */
export function readDeclineCallId(detail: unknown): string | null {
  const id = (detail as { callId?: unknown } | null | undefined)?.callId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
