'use client';

import { useSessionContext } from '@/components/auth/session-gate';

/** True when the signed-in user is an OWNER or ADMIN of the current workspace. A UX hint only. */
export function useWorkspaceAdmin(): boolean {
  const session = useSessionContext();
  const data = session.data;
  const membership = data?.workspaceMemberships.find(
    (m) => m.workspaceId === data.currentWorkspaceId,
  );
  return membership?.role === 'OWNER' || membership?.role === 'ADMIN';
}
