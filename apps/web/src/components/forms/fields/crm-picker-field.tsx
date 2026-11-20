'use client';

import { ApiError } from '@botss/api-client';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from 'cmdk';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WorkspaceMembersCombobox } from '@/components/workspace/workspace-members-combobox';
import { useClients } from '@/hooks/use-clients';
import { useDebouncedValue } from '@/hooks/use-debounced';
import { useLeads } from '@/hooks/use-leads';
import { useProjects } from '@/hooks/use-projects';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

type Entity = FieldProps<'crm_picker'>['field']['entity'];
type SearchEntity = Exclude<Entity, 'member'>;

interface Option {
  value: string;
  label: string;
}

interface Result {
  options: Option[];
  loading: boolean;
  error: unknown;
}

type Render = (result: Result) => ReactNode;

const PAGE_SIZE = 25;

function toOptions(items: { id: string; name: string }[] | undefined): Option[] {
  return (items ?? []).map((i) => ({ value: i.id, label: i.name }));
}

// One component per entity so only the list that is shown is fetched.
function ClientData({ search, children }: { search: string; children: Render }) {
  const q = useClients({ pageSize: PAGE_SIZE, ...(search ? { search } : {}) });
  const options = useMemo(() => toOptions(q.data?.items), [q.data]);
  return <>{children({ options, loading: q.isLoading, error: q.error })}</>;
}
function ProjectData({ search, children }: { search: string; children: Render }) {
  const q = useProjects({ pageSize: PAGE_SIZE, ...(search ? { search } : {}) });
  const options = useMemo(() => toOptions(q.data?.items), [q.data]);
  return <>{children({ options, loading: q.isLoading, error: q.error })}</>;
}
function LeadData({ search, children }: { search: string; children: Render }) {
  const q = useLeads({ pageSize: PAGE_SIZE, ...(search ? { search } : {}) });
  const options = useMemo(() => toOptions(q.data?.items), [q.data]);
  return <>{children({ options, loading: q.isLoading, error: q.error })}</>;
}

function EntityData({
  entity,
  search,
  children,
}: {
  entity: SearchEntity;
  search: string;
  children: Render;
}) {
  if (entity === 'client') return <ClientData search={search}>{children}</ClientData>;
  if (entity === 'project') return <ProjectData search={search}>{children}</ProjectData>;
  return <LeadData search={search}>{children}</LeadData>;
}

function emptyMessage(error: unknown, noun: string): string {
  if (error instanceof ApiError && error.status === 403) return "You can't pick from this list";
  if (error) return "Couldn't load this list";
  return `No ${noun}s found`;
}

/** Server-searched picker. cmdk's own filtering is off: the server filters. */
function SearchPicker({
  entity,
  value,
  selectedLabel,
  onPick,
  disabled,
  inputId,
  describedBy,
  exclude,
  placeholder,
}: {
  entity: SearchEntity;
  value: string | null;
  selectedLabel: string | undefined;
  onPick: (option: Option) => void;
  disabled: boolean;
  inputId: string;
  describedBy: string | undefined;
  exclude: readonly string[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 250);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={inputId}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn('h-10 w-full justify-between font-normal', !value && 'text-ink-disabled')}
        >
          <span className="truncate">{value ? (selectedLabel ?? 'Selected') : placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false} className="max-h-72 overflow-hidden rounded-md" loop>
          <div className="border-line border-b px-2">
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={`Search ${entity}s`}
              className="placeholder:text-ink-disabled flex h-10 w-full bg-transparent py-2 text-sm outline-none"
            />
          </div>
          <CommandList className="max-h-60 overflow-auto p-1">
            <EntityData entity={entity} search={debounced}>
              {({ options, loading, error }) => {
                const shown = options.filter(
                  (o) => o.value === value || !exclude.includes(o.value),
                );
                if (loading) {
                  return (
                    <div className="flex justify-center px-2 py-3">
                      <Loader size="xs" />
                    </div>
                  );
                }
                if (shown.length === 0) {
                  return (
                    <div className="text-ink-muted px-2 py-3 text-center text-sm">
                      {emptyMessage(error, entity)}
                    </div>
                  );
                }
                return (
                  <CommandGroup>
                    {shown.map((o) => (
                      <CommandItem
                        key={o.value}
                        value={o.value}
                        onSelect={() => {
                          onPick(o);
                          setOpen(false);
                          setSearch('');
                        }}
                        className="aria-selected:bg-bg-subtle flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
                      >
                        <span className="text-ink flex-1 truncate">{o.label}</span>
                        <Check
                          className={cn(
                            'h-4 w-4 shrink-0',
                            o.value === value ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              }}
            </EntityData>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Pick workspace records. Dropped by the server on public forms, so hidden there. */
export function CrmPickerField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'crm_picker'>) {
  // Names of picked records, filled when the person picks. Ids that arrive
  // already selected show "Selected" until the person picks again.
  const [labels, setLabels] = useState<Record<string, string>>({});
  const ids: string[] = Array.isArray(value)
    ? (value as string[])
    : typeof value === 'string'
      ? [value]
      : [];
  if (ctx.mode === 'public') return null;

  const noun = field.entity;
  const placeholderText =
    field.placeholder ?? (field.multiple ? `Add a ${noun}` : `Select a ${noun}`);

  if (field.entity === 'member') {
    return (
      <div aria-describedby={describedBy}>
        <WorkspaceMembersCombobox
          key={field.multiple ? ids.length : 'single'}
          value={field.multiple ? null : (ids[0] ?? null)}
          onChange={(v) => {
            if (!field.multiple) onChange(v ?? undefined);
            else if (v && !ids.includes(v)) onChange([...ids, v]);
          }}
          placeholder={placeholderText}
          excludeUserIds={field.multiple ? ids : []}
          disabled={ctx.disabled}
          clearable={!field.required}
        />
      </div>
    );
  }

  const entity = field.entity;
  function pick(o: Option) {
    setLabels((prev) => ({ ...prev, [o.value]: o.label }));
    if (!field.multiple) onChange(o.value);
    else if (!ids.includes(o.value)) onChange([...ids, o.value]);
  }

  if (!field.multiple) {
    return (
      <SearchPicker
        entity={entity}
        value={ids[0] ?? null}
        selectedLabel={ids[0] ? labels[ids[0]] : undefined}
        onPick={pick}
        disabled={ctx.disabled}
        inputId={inputId}
        describedBy={describedBy}
        exclude={[]}
        placeholder={placeholderText}
      />
    );
  }

  return (
    <div className="space-y-2">
      {ids.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <li
              key={id}
              className="bg-bg-subtle text-ink flex items-center gap-1 rounded-full py-1 pl-3 pr-1.5 text-sm"
            >
              {labels[id] ?? 'Selected'}
              <button
                type="button"
                aria-label={`Remove ${labels[id] ?? noun}`}
                disabled={ctx.disabled}
                onClick={() => {
                  const rest = ids.filter((x) => x !== id);
                  onChange(rest.length > 0 ? rest : undefined);
                }}
                className="text-ink-muted hover:text-ink flex h-11 w-11 items-center justify-center rounded-full sm:h-6 sm:w-6"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <SearchPicker
        entity={entity}
        value={null}
        selectedLabel={undefined}
        onPick={pick}
        disabled={ctx.disabled}
        inputId={inputId}
        describedBy={describedBy}
        exclude={ids}
        placeholder={placeholderText}
      />
    </div>
  );
}
