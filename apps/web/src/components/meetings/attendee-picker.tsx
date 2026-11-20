'use client';

import type { MeetingPerson } from '@botss/shared-types';
import { Users, X } from 'lucide-react';

import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAttendeePicker } from '@/hooks/use-attendee-picker';
import type { ExternalGuest } from '@/lib/meetings/meeting-form';

/**
 * Who is invited: teammates (search, "Select all", or every member of a
 * workspace) and outside guests by email.
 */
export function AttendeePicker({
  people,
  guests,
  organizerId,
  onPeopleChange,
  onGuestsChange,
  disabled,
}: {
  people: MeetingPerson[];
  guests: ExternalGuest[];
  organizerId: string | null;
  onPeopleChange: (next: MeetingPerson[]) => void;
  onGuestsChange: (next: ExternalGuest[]) => void;
  disabled?: boolean;
}) {
  const picker = useAttendeePicker({ people, guests, organizerId, onPeopleChange, onGuestsChange });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Input
          value={picker.search}
          onChange={(e) => picker.setSearch(e.target.value)}
          placeholder="Search teammates by name or email"
          aria-label="Search teammates"
          disabled={disabled}
        />
        {picker.search.trim() ? (
          <ul
            role="listbox"
            aria-label="Teammates"
            className="border-line max-h-44 overflow-y-auto rounded-md border bg-white"
          >
            {picker.results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => picker.add(p)}
                  className="hover:bg-bg-subtle flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  <UserAvatar size="xs" name={p.name} image={p.image} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-ink-muted truncate text-xs">{p.email}</span>
                </button>
              </li>
            ))}
            {picker.results.length === 0 ? (
              <li className="text-ink-muted px-3 py-2 text-xs">
                {picker.searching ? 'Searching' : 'No teammates match'}
              </li>
            ) : null}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || picker.busy}
            onClick={() => void picker.selectAll()}
          >
            <Users className="h-3.5 w-3.5" aria-hidden />
            Select all teammates
          </Button>
          <Select
            value={picker.workspaceId}
            onValueChange={picker.setWorkspaceId}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-48 text-xs" aria-label="Workspace to add">
              <SelectValue placeholder="Add a workspace" />
            </SelectTrigger>
            <SelectContent>
              {picker.workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || picker.busy || !picker.workspaceId}
            onClick={() => void picker.selectWorkspace()}
          >
            Add all members
          </Button>
          {people.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={picker.clearAll}
            >
              Clear teammates
            </Button>
          ) : null}
        </div>
      </div>

      {people.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Invited teammates">
          {people.map((p) => (
            <li
              key={p.id}
              className="bg-bg-subtle inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1 pr-1.5 text-xs"
            >
              <UserAvatar size="xs" name={p.name} image={p.image} />
              <span className="max-w-[10rem] truncate">{p.name}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${p.name}`}
                onClick={() => picker.remove(p.id)}
                className="text-ink-muted hover:text-ink rounded-full p-0.5 hover:bg-white"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1.5">
        <Input
          type="email"
          value={picker.guestDraft}
          disabled={disabled}
          onChange={(e) => picker.setGuestDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              picker.commitGuests(picker.guestDraft);
            }
          }}
          onBlur={() => {
            if (picker.guestDraft.trim()) picker.commitGuests(picker.guestDraft);
          }}
          placeholder="Outside guests: type an email and press Enter"
          aria-label="Outside guest email"
          aria-invalid={picker.guestError ? true : undefined}
        />
        {picker.guestError ? (
          <p role="alert" className="text-state-error text-xs">
            {picker.guestError}
          </p>
        ) : null}
        {guests.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Outside guests">
            {guests.map((g) => (
              <li
                key={g.email}
                className="border-line inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1.5 text-xs"
              >
                <span className="max-w-[14rem] truncate">{g.email}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${g.email}`}
                  onClick={() => picker.removeGuest(g.email)}
                  className="text-ink-muted hover:bg-bg-subtle hover:text-ink rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
