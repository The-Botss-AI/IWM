import type { FormField } from '@botss/shared-types';

import { isPlaceholderMediaUrl } from '@/lib/forms/field-catalog';
import { cn } from '@/lib/utils';

const bar = 'h-8 rounded-md border border-line bg-bg-subtle/60';

function Choices({ labels, round }: { labels: readonly string[]; round?: boolean }) {
  return (
    <ul className="space-y-1" role="list">
      {labels.slice(0, 3).map((l, i) => (
        <li key={i} className="text-ink-muted flex items-center gap-2 text-xs">
          <span
            className={cn(
              'border-line-strong h-3.5 w-3.5 shrink-0 border bg-white',
              round ? 'rounded-full' : 'rounded',
            )}
            aria-hidden
          />
          <span className="truncate">{l || 'Untitled option'}</span>
        </li>
      ))}
      {labels.length > 3 ? (
        <li className="text-ink-muted text-xs">and {labels.length - 3} more</li>
      ) : null}
    </ul>
  );
}

/** A small static sketch of how a field looks, for the builder canvas. Not interactive. */
export function FieldPreview({ field }: { field: FormField }) {
  switch (field.type) {
    case 'long_text':
    case 'rich_text':
      return <div className="border-line bg-bg-subtle/60 h-16 rounded-md border" aria-hidden />;
    case 'radio':
    case 'yes_no':
      return (
        <Choices
          round
          labels={
            field.type === 'yes_no'
              ? [field.yesLabel || 'Yes', field.noLabel || 'No']
              : field.options.map((o) => o.label)
          }
        />
      );
    case 'checkboxes':
    case 'multi_select':
    case 'ranking':
      return <Choices labels={field.options.map((o) => o.label)} />;
    case 'picture_choice':
      return (
        <div className="flex gap-1.5" aria-hidden>
          {field.options.slice(0, 4).map((o) => (
            <div
              key={o.id}
              className="border-line bg-bg-subtle h-10 w-10 overflow-hidden rounded-md border"
            >
              {o.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- user supplied remote image
                <img src={o.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
          ))}
        </div>
      );
    case 'consent':
      return <Choices labels={[field.text]} />;
    case 'star_rating':
      return (
        <p className="text-ink-muted text-sm tracking-widest" aria-hidden>
          {'☆'.repeat(Math.min(field.max, 10))}
        </p>
      );
    case 'linear_scale':
      return (
        <p className="text-ink-muted text-xs">
          {field.min} to {field.max}
          {field.minLabel || field.maxLabel
            ? ` (${field.minLabel ?? ''} / ${field.maxLabel ?? ''})`
            : ''}
        </p>
      );
    case 'matrix':
      return (
        <p className="text-ink-muted text-xs">
          {field.rows.length} rows by {field.columns.length} columns
        </p>
      );
    case 'repeater':
      return (
        <p className="text-ink-muted text-xs">
          {field.fields.length} questions per row, up to {field.maxItems} rows
        </p>
      );
    case 'calculated':
      return <p className="text-ink-muted truncate font-mono text-xs">= {field.expression}</p>;
    case 'hidden':
      return (
        <p className="text-ink-muted text-xs">
          From link parameter {field.paramName || '(not set)'}
        </p>
      );
    case 'heading':
      return (
        <p
          className={cn(
            'text-ink truncate font-semibold',
            field.level === 1 ? 'text-xl' : field.level === 2 ? 'text-base' : 'text-sm',
          )}
        >
          {field.label || 'Heading'}
        </p>
      );
    case 'paragraph':
      return (
        <p className="text-ink-muted line-clamp-2 text-sm">{field.text || 'Empty text block'}</p>
      );
    case 'divider':
      return <hr className="border-line" />;
    case 'media':
      if (isPlaceholderMediaUrl(field.url))
        return (
          <p className="text-state-error text-xs font-medium">
            Set the {field.kind === 'image' ? 'image' : 'video'} link
          </p>
        );
      return (
        <p className="text-ink-muted truncate text-xs">
          {field.kind === 'image' ? 'Image' : 'Video'}: {field.url}
        </p>
      );
    case 'page_break':
      return <p className="text-ink-muted text-xs">New step starts here</p>;
    case 'dropdown':
    case 'country':
    case 'timezone':
      return (
        <div
          className={cn(bar, 'text-ink-muted flex items-center justify-end px-3 text-xs')}
          aria-hidden
        >
          v
        </div>
      );
    default:
      return <div className={bar} aria-hidden />;
  }
}
