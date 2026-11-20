'use client';

import { Suspense, use } from 'react';

import { PublicRsvpView } from '@/components/meetings/public-rsvp-view';

/**
 * The emailed RSVP link for outside guests. No sign in. Lives outside the
 * `(app)` group so no session gate or app shell wraps it.
 */
export default function PublicRsvpPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <Suspense fallback={null}>
      <PublicRsvpView token={token} />
    </Suspense>
  );
}
