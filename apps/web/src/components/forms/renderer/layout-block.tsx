import type { FormField } from '@botss/shared-types';

/** Display-only items: heading, text, divider, image or video. */
export function LayoutBlock({ field }: { field: FormField }) {
  switch (field.type) {
    case 'heading': {
      const cls =
        field.level === 1
          ? 'text-xl font-semibold'
          : field.level === 2
            ? 'text-lg font-semibold'
            : 'text-base font-semibold';
      const Tag = field.level === 1 ? 'h2' : field.level === 2 ? 'h3' : 'h4';
      return (
        <div className="space-y-1 pt-2">
          <Tag className={`${cls} text-ink`}>{field.label}</Tag>
          {field.helpText ? (
            <p className="text-ink-muted whitespace-pre-line text-sm">{field.helpText}</p>
          ) : null}
        </div>
      );
    }
    case 'paragraph':
      return (
        <p className="text-ink whitespace-pre-line text-sm leading-relaxed">
          {field.text || field.label}
        </p>
      );
    case 'divider':
      return <hr className="border-line" />;
    case 'media':
      return (
        <figure className="space-y-1">
          {field.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary https URLs chosen by the form owner
            <img
              src={field.url}
              alt={field.alt ?? ''}
              className="max-h-96 w-full rounded-lg object-contain"
              loading="lazy"
            />
          ) : (
            <video src={field.url} controls preload="metadata" className="w-full rounded-lg">
              <track kind="captions" />
            </video>
          )}
          {field.label ? (
            <figcaption className="text-ink-muted text-xs">{field.label}</figcaption>
          ) : null}
        </figure>
      );
    default:
      return null;
  }
}
