'use client';

import { FileUp, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { describeError } from '@/lib/toast';

import type { FieldProps } from './types';

interface Picked {
  id: string;
  name: string;
}

/**
 * Reference upload field: each picked file goes straight to storage through
 * `ctx.uploader` (wrapped in `ctx.trackUpload` so submit waits), and the
 * value is the list of upload ids. Names are kept locally for display.
 */
export function FileUploadField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'file_upload'>) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Uploads finish after awaits, so commit from the latest ids, not the render closure.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const room = field.maxFiles - ids.length;

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProblem(null);
    const all = Array.from(files);
    const chosen = all.slice(0, Math.max(0, room));
    if (all.length > chosen.length) {
      setProblem(`Only ${Math.max(0, room)} more ${room === 1 ? 'file' : 'files'} can be added.`);
    }
    const tooBig = chosen.find((f) => f.size > field.maxSizeMb * 1024 * 1024);
    if (tooBig) {
      setProblem(`"${tooBig.name}" is larger than ${field.maxSizeMb} MB.`);
      return;
    }
    setBusy((n) => n + chosen.length);
    const added: Picked[] = [];
    for (const file of chosen) {
      try {
        const id = await ctx.trackUpload(
          ctx.uploader({ fieldId: field.id, file, fileName: file.name }),
        );
        added.push({ id, name: file.name });
      } catch (err) {
        setProblem(describeError(err, `Couldn't upload "${file.name}". Try again.`));
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (added.length > 0) {
      setNames((prev) => ({ ...prev, ...Object.fromEntries(added.map((a) => [a.id, a.name])) }));
      onChange([...idsRef.current, ...added.map((a) => a.id)]);
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(id: string) {
    const rest = idsRef.current.filter((x) => x !== id);
    onChange(rest.length > 0 ? rest : undefined);
  }

  return (
    <div className="space-y-2">
      {ids.length > 0 ? (
        <ul className="space-y-1.5">
          {ids.map((id) => (
            <li
              key={id}
              className="border-line bg-bg-subtle flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span className="text-ink truncate">{names[id] ?? 'Uploaded file'}</span>
              <button
                type="button"
                onClick={() => remove(id)}
                disabled={ctx.disabled || busy > 0}
                className="text-ink-muted hover:bg-bg-app hover:text-ink flex h-11 w-11 items-center justify-center rounded sm:h-7 sm:w-7"
                aria-label={`Remove ${names[id] ?? 'file'}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {room > 0 ? (
        <>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            aria-describedby={describedBy}
            className="sr-only"
            multiple={room > 1}
            accept={field.accept.length > 0 ? field.accept.join(',') : undefined}
            disabled={ctx.disabled || busy > 0}
            onChange={(e) => void pick(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={ctx.disabled || busy > 0}
            onClick={() => inputRef.current?.click()}
          >
            {busy > 0 ? <Loader size="xs" label="Uploading" /> : <FileUp className="h-4 w-4" />}
            {busy > 0 ? 'Uploading' : field.maxFiles > 1 ? 'Add files' : 'Choose a file'}
          </Button>
          <p className="text-ink-muted text-xs">
            Up to {field.maxFiles} {field.maxFiles === 1 ? 'file' : 'files'}, {field.maxSizeMb} MB
            each.
          </p>
        </>
      ) : null}
      {problem ? <p className="text-state-error text-xs font-medium">{problem}</p> : null}
    </div>
  );
}
