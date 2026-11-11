/**
 * The Botss - Web Push service worker.
 *
 * Runs out-of-process from the React app so OS notification banners
 * land even when every CRM tab is closed. Two responsibilities:
 *
 *   1. `push`             - parse the JSON payload, raise an OS banner,
 *                           and for call-type payloads pin it with
 *                           `requireInteraction: true` so Windows keeps
 *                           it on screen until the user reacts.
 *   2. `notificationclick` - focus an existing CRM window if one is
 *                           open, otherwise spin a fresh one targeted
 *                           at the deep link inside `data.url`.
 *
 * Keep this file plain JS - no transpilation, no bundler - so Next.js
 * serves it verbatim from /sw.js on every request without revalidation
 * weirdness.
 */

self.addEventListener('install', (event) => {
  // Skip waiting so a redeploy of the worker takes effect on the next
  // tab reload rather than the one after - small UX win.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);
  if (!payload) return;

  const title = payload.title || 'The Botss';
  const isCall = payload.type === 'call';
  // Do Not Disturb call: still shown, with Answer/Decline, but never rings.
  const silent = payload.silent === true;

  /** @type {NotificationOptions} */
  const options = {
    body: payload.body || '',
    badge: '/branding/badge-72.png',
    icon: '/branding/icon-192.png',
    // `tag` collapses repeated banners on the same target - e.g. five
    // chat messages in the same room don't pile up five rows.
    tag: payload.tag || (payload.data && payload.data.roomId) || undefined,
    // Calls are sticky: the OS keeps the banner up until the user
    // dismisses or accepts. Messages auto-dismiss on a timer.
    requireInteraction: isCall && !silent,
    renotify: isCall && !silent,
    silent: silent,
    // Forward structured metadata so notificationclick can route.
    data: Object.assign({}, payload.data || {}, {
      url: payload.url || '/',
      type: payload.type,
    }),
    actions: isCall
      ? [
          { action: 'accept', title: 'Answer' },
          { action: 'decline', title: 'Decline' },
        ]
      : [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// An open CRM tab tells us a call is over (ended, declined, answered
// elsewhere): close that call's banner so it does not linger.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'botss:clear-call' || typeof data.tag !== 'string') return;
  event.waitUntil(
    self.registration.getNotifications({ tag: data.tag }).then((list) => {
      for (const n of list) n.close();
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notificationData = event.notification.data || {};
  const targetUrl = notificationData.url || '/';
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;
  const isDecline = event.action === 'decline' && !!notificationData.callId;

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      if (isDecline) {
        // Decline never opens the call. An open tab emits `call_reject`
        // itself; with none open, a new window does it from `decline=1`.
        const open = allClients.find((c) => new URL(c.url).origin === self.location.origin);
        if (open) {
          open.postMessage({ type: 'botss:call-decline', callId: notificationData.callId });
          return;
        }
        if (self.clients.openWindow) {
          const declineUrl = new URL(absoluteUrl);
          declineUrl.searchParams.set('call', notificationData.callId);
          declineUrl.searchParams.set('decline', '1');
          try {
            await self.clients.openWindow(declineUrl.href);
          } catch (_err) {
            /* blocked */
          }
        }
        return;
      }
      // Prefer focusing an existing tab on the same origin and navigating
      // it in-place. The user keeps their session + cached query state.
      for (const client of allClients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ('focus' in client) {
          try {
            await client.focus();
          } catch (_err) {
            /* focus can fail when the OS denies cross-origin focus */
          }
          if ('navigate' in client) {
            try {
              await client.navigate(absoluteUrl);
            } catch (_err) {
              /* some browsers reject mid-call navigate; ignore */
            }
          }
          return;
        }
      }
      // No CRM tab open → spin a new one. `openWindow` returns null if
      // the browser blocks the popup, in which case we silently fail -
      // the user clicked the OS banner, no surface to surface an error on.
      if (self.clients.openWindow) {
        try {
          await self.clients.openWindow(absoluteUrl);
        } catch (_err) {
          /* blocked */
        }
      }
    })(),
  );
});

/** Defensive JSON parser - push services may strip or corrupt payloads. */
function parsePushPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch (_err) {
    try {
      // Some browsers deliver as plain text.
      const text = event.data.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (_innerErr) {
      return null;
    }
  }
}
