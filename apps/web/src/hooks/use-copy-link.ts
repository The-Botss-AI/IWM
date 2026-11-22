'use client';

import { useCallback } from 'react';

import { toastErrorMessage, toastInfo } from '@/lib/toast';

/** Copies text to the clipboard and tells the person how it went. */
export function useCopyLink() {
  return useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toastInfo('Link copied');
    } catch {
      toastErrorMessage("Couldn't copy the link", {
        description:
          'Your browser blocked clipboard access. Allow it in site settings, or copy it by hand.',
      });
    }
  }, []);
}
