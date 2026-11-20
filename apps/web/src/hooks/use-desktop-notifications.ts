'use client';

import { useEffect, useRef, useState } from 'react';

import { getApi } from '@/lib/api';
import { isDesktop } from '@/lib/desktop-runtime';

/**
 * Wires up native OS push notifications for the calling user.
 *
 * Flow on first mount with a real `userId`:
 *   1. Feature-detect serviceWorker + PushManager. Bail silently if
 *      either is missing (dev over HTTP, ancient browsers).
 *   2. Register `/sw.js` (idempotent - re-registers reuse the same SW).
 *   3. Require notification permission. It is never requested on mount:
 *      browsers only honour the prompt from a user gesture, so the bell
 *      offers an "Enable" button that calls `requestNotificationPermission`,
 *      and this hook re-runs once permission changes.
 *   4. Pull an existing PushManager subscription if there is one;
 *      otherwise create one against the app's VAPID public key.
 *   5. POST `{ endpoint, auth, p256dh }` to the API. The API upserts
 *      so re-mounts on the same device dedupe by endpoint.
 *
 * Failure modes are intentionally swallowed (with a console.warn) so
 * a push misconfiguration never breaks the app shell.
 */
const PERMISSION_EVENT = 'botss:notification-permission';

/** True when the browser can show notifications but the user hasn't decided yet. */
export function canRequestNotificationPermission(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'default';
}

/**
 * Ask for OS notification permission. Call ONLY from a user gesture (a click
 * handler); `useDesktopNotifications` picks up the result and subscribes.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  if (typeof Notification === 'undefined') return null;
  let result: NotificationPermission = Notification.permission;
  try {
    result = await Notification.requestPermission();
  } catch {
    /* some browsers reject outside a user gesture */
  }
  window.dispatchEvent(new Event(PERMISSION_EVENT));
  return result;
}

export function useDesktopNotifications(userId: string | null): void {
  const subscribedKey = useRef<string | null>(null);
  // Bumped when permission changes via `requestNotificationPermission`, so the
  // subscribe flow below re-runs right after the user grants it.
  const [permissionTick, setPermissionTick] = useState(0);

  useEffect(() => {
    const onChange = () => setPermissionTick((n) => n + 1);
    window.addEventListener(PERMISSION_EVENT, onChange);
    return () => window.removeEventListener(PERMISSION_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!userId) return;
    // Re-register only when the user identity changes - re-running on
    // every render would create no-op churn against the push service.
    if (subscribedKey.current === userId) return;

    let cancelled = false;
    void (async () => {
      if (typeof window === 'undefined') return;
      if (typeof Notification === 'undefined') return;

      if (!('serviceWorker' in navigator)) return;
      if (Notification.permission !== 'granted') return;

      // Register the service worker UNCONDITIONALLY - it powers local
      // call/message banners too, not just server push. The local path in
      // `useChatNotifyingEffects` waits on `navigator.serviceWorker.ready`,
      // which per spec only resolves once the origin has an active worker
      // and never rejects. If we only registered when VAPID was configured,
      // an unconfigured deploy would leave `.ready` pending forever and the
      // banner would silently never appear - even with permission granted.
      let registration: ServiceWorkerRegistration;
      try {
        registration = await navigator.serviceWorker.register('/sw.js');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[sw] registration failed:', err);
        return;
      }

      // Server push is the optional leg: it needs PushManager support and a
      // configured VAPID key. Without them the SW is still registered and
      // local banners work; we just skip the push subscription.
      if (!('PushManager' in window)) return;
      // The desktop app gets every push over the chat socket instead
      // (`useOsNotifications`). Electron has no push service, and a working
      // subscription would pop each banner twice.
      if (isDesktop()) return;
      const vapidPublicKey =
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
        process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ??
        null;
      if (!vapidPublicKey) return;

      try {
        // Reuse the existing subscription if the browser already has one;
        // otherwise create against our VAPID key.
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            // The PushManager BufferSource overload across DOM lib
            // versions disagrees on Uint8Array<ArrayBufferLike> vs
            // BufferSource. Cast through unknown to bridge cleanly.
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
          });
        }
        if (cancelled) return;

        const auth = arrayBufferToBase64Url(subscription.getKey('auth'));
        const p256dh = arrayBufferToBase64Url(subscription.getKey('p256dh'));
        if (!auth || !p256dh) return;

        await getApi().notifications.subscribePush({
          endpoint: subscription.endpoint,
          auth,
          p256dh,
          userAgent: navigator.userAgent,
        });
        if (!cancelled) subscribedKey.current = userId;
      } catch (err) {
        // Push setup is best-effort. Permission denied / no SW / network
        // hiccup - none of it should crash the shell.
        // eslint-disable-next-line no-console
        console.warn('[push] subscribe failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, permissionTick]);
}

/**
 * VAPID public keys are distributed as URL-safe base64. The PushManager
 * needs a `Uint8Array`. Adapter copied from the standard MDN recipe.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof atob === 'function' ? atob(base64) : '';
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
  return buffer;
}

/**
 * The PushSubscription's `auth` and `p256dh` keys arrive as binary
 * ArrayBuffers. The server schema wants base64-url strings.
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null;
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : '';
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
