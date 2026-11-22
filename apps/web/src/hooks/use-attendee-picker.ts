'use client';

import { MAX_MEETING_ATTENDEES, type MeetingPerson } from '@botss/shared-types';
import { useState } from 'react';

import { fetchAllCandidates, useAttendeeCandidates } from '@/hooks/use-meetings';
import { useDebouncedValue } from '@/hooks/use-debounced';
import { useWorkspaces } from '@/hooks/use-workspace';
import { addGuests, mergePeople } from '@/lib/meetings/attendees';
import type { ExternalGuest } from '@/lib/meetings/meeting-form';
import { toastError, toastInfo } from '@/lib/toast';

interface Args {
  people: MeetingPerson[];
  guests: ExternalGuest[];
  organizerId: string | null;
  onPeopleChange: (next: MeetingPerson[]) => void;
  onGuestsChange: (next: ExternalGuest[]) => void;
}

/** State and actions behind the attendee picker (search, select all, workspace, guests). */
export function useAttendeePicker({
  people,
  guests,
  organizerId,
  onPeopleChange,
  onGuestsChange,
}: Args) {
  const [search, setSearch] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [guestDraft, setGuestDraft] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);
  const debounced = useDebouncedValue(search.trim(), 250);
  const candidates = useAttendeeCandidates(
    { ...(debounced ? { search: debounced } : {}) },
    debounced.length > 0,
  );
  const workspaces = useWorkspaces();

  const picked = new Set(people.map((p) => p.id));
  const results = (candidates.data?.items ?? []).filter(
    (p) => p.id !== organizerId && !picked.has(p.id),
  );

  function add(person: MeetingPerson): void {
    onPeopleChange(mergePeople(people, [person], organizerId).list);
    setSearch('');
  }

  function remove(id: string): void {
    onPeopleChange(people.filter((p) => p.id !== id));
  }

  async function addEveryone(forWorkspace?: string): Promise<void> {
    setBusy(true);
    try {
      const result = await fetchAllCandidates(forWorkspace);
      const merged = mergePeople(people, result.items, organizerId);
      onPeopleChange(merged.list);
      if (merged.hitLimit || result.truncated) {
        toastInfo(
          `Added ${merged.added} people`,
          `A meeting holds at most ${MAX_MEETING_ATTENDEES} people.`,
        );
      } else {
        toastInfo(
          merged.added === 0 ? 'Everyone is already added' : `Added ${merged.added} people`,
        );
      }
    } catch (err) {
      toastError(err, "Couldn't load your teammates");
    } finally {
      setBusy(false);
    }
  }

  function commitGuests(raw: string): boolean {
    const result = addGuests(guests, raw);
    if (!result.ok) {
      setGuestError(result.message);
      return false;
    }
    setGuestError(null);
    onGuestsChange(result.guests);
    setGuestDraft('');
    return true;
  }

  return {
    search,
    setSearch,
    results,
    searching: candidates.isFetching,
    workspaces: workspaces.data?.items ?? [],
    workspaceId,
    setWorkspaceId,
    busy,
    add,
    remove,
    selectAll: () => addEveryone(),
    selectWorkspace: () => (workspaceId ? addEveryone(workspaceId) : Promise.resolve()),
    clearAll: () => onPeopleChange([]),
    guestDraft,
    setGuestDraft,
    guestError,
    commitGuests,
    removeGuest: (email: string) => onGuestsChange(guests.filter((g) => g.email !== email)),
  };
}
