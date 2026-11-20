'use client';

import { Suspense, use } from 'react';

import { MeetingDetail } from '@/components/meetings/meeting-detail';

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <MeetingDetail id={id} />
    </Suspense>
  );
}
