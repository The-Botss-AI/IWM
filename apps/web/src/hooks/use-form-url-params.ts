'use client';

import { useMemo } from 'react';

/** URL query parameters as a plain record, for hidden form fields (`?utm_source=...`). */
export function useFormUrlParams(searchParams: {
  forEach: (cb: (value: string, key: string) => void) => void;
}) {
  return useMemo(() => {
    // No prototype, so a key like "constructor" is just a key; the dangerous names are skipped anyway.
    const out: Record<string, string> = Object.create(null) as Record<string, string>;
    searchParams.forEach((value, key) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      if (!Object.hasOwn(out, key)) out[key] = value;
    });
    return out;
  }, [searchParams]);
}
