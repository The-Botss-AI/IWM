'use client';

import { TagInput } from '@/components/ui/tag-input';

import type { FieldProps } from './types';

/** Free-text tags. Value: string[]. */
export function TagsField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'tags'>) {
  const tags = Array.isArray(value) ? (value as string[]) : [];
  const full = field.maxTags !== undefined && tags.length >= field.maxTags;
  return (
    <div className="space-y-1" role="group" aria-label={field.label} aria-describedby={describedBy}>
      <TagInput
        id={inputId}
        describedBy={describedBy}
        value={tags}
        disabled={ctx.disabled}
        placeholder={field.placeholder ?? 'Type and press Enter'}
        aria-label={field.label}
        className={full ? '[&_input]:hidden' : undefined}
        onChange={(next) => {
          const capped = field.maxTags ? next.slice(0, field.maxTags) : next;
          onChange(capped.length === 0 ? undefined : capped);
        }}
      />
      {field.maxTags ? (
        <p className="text-ink-muted text-xs">
          {tags.length} / {field.maxTags}
        </p>
      ) : null}
    </div>
  );
}
