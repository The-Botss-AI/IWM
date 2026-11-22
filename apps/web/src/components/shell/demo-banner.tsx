'use client';

import { FlaskConical, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { env } from '@/lib/env';

const DISMISS_KEY = 'iwm-demo-banner-dismissed';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Slim notice on every page of a public live demo (NEXT_PUBLIC_DEMO_MODE).
 * Floats in the bottom left corner so it never shifts the app layout, and
 * can be hidden for the rest of the browser session. Renders nothing on a
 * normal install.
 */
export function DemoBanner() {
  // Hidden until mounted so the server render and the first client render
  // agree; the session flag is only readable in the browser.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(!readDismissed());
  }, []);

  if (!env.demoMode || !visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private mode: hidden until the next page load, which is fine.
    }
  };

  return (
    <div
      role="status"
      className="border-line text-ink shadow-soft bg-bg-app fixed bottom-3 left-3 z-[60] flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border py-1 pl-3 pr-1 text-xs"
    >
      <FlaskConical className="text-brand-600 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">Live demo. Data resets every day.</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide the demo notice"
        className="text-ink-muted hover:text-ink focus-visible:shadow-focus rounded-full p-1 focus-visible:outline-none"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
