'use client';

import { Camera, ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { describeError } from '@/lib/toast';

import type { FieldProps } from './types';

/**
 * Image upload: each picked image goes to storage through `ctx.uploader`;
 * the value is the list of upload ids. Thumbnails are local object URLs.
 */
export function ImageUploadField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'image_upload'>) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbsRef = useRef<Record<string, string>>({});
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Uploads finish after awaits, so commit from the latest ids, not the render closure.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const room = field.maxFiles - ids.length;

  useEffect(
    () => () => {
      Object.values(thumbsRef.current).forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProblem(null);
    const all = Array.from(files);
    const chosen = all.slice(0, Math.max(0, room));
    if (all.length > chosen.length) {
      setProblem(`Only ${Math.max(0, room)} more ${room === 1 ? 'image' : 'images'} can be added.`);
    }
    const bad = chosen.find((f) => !f.type.startsWith('image/'));
    if (bad) {
      setProblem(`"${bad.name}" is not an image.`);
      return;
    }
    const tooBig = chosen.find((f) => f.size > field.maxSizeMb * 1024 * 1024);
    if (tooBig) {
      setProblem(`"${tooBig.name}" is larger than ${field.maxSizeMb} MB.`);
      return;
    }
    setBusy((n) => n + chosen.length);
    const added: string[] = [];
    for (const file of chosen) {
      try {
        const id = await ctx.trackUpload(
          ctx.uploader({ fieldId: field.id, file, fileName: file.name }),
        );
        const url = URL.createObjectURL(file);
        thumbsRef.current[id] = url;
        setThumbs((prev) => ({ ...prev, [id]: url }));
        added.push(id);
      } catch (err) {
        setProblem(describeError(err, `Couldn't upload "${file.name}". Try again.`));
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (added.length > 0) onChange([...idsRef.current, ...added]);
    if (fileRef.current) fileRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
  }

  function remove(id: string) {
    const url = thumbsRef.current[id];
    if (url) {
      URL.revokeObjectURL(url);
      delete thumbsRef.current[id];
      setThumbs((prev) => {
        const { [id]: _gone, ...rest } = prev;
        return rest;
      });
    }
    const rest = idsRef.current.filter((x) => x !== id);
    onChange(rest.length > 0 ? rest : undefined);
  }

  const off = ctx.disabled || busy > 0;
  return (
    <div className="space-y-2">
      {ids.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {ids.map((id) => (
            <li
              key={id}
              className="border-line bg-bg-subtle relative aspect-square overflow-hidden rounded-lg border"
            >
              {thumbs[id] ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL
                <img src={thumbs[id]} alt="Uploaded" className="h-full w-full object-cover" />
              ) : (
                <span className="text-ink-muted flex h-full items-center justify-center text-xs">
                  Image
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(id)}
                disabled={ctx.disabled || busy > 0}
                aria-label="Remove image"
                className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:h-7 sm:w-7"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {room > 0 ? (
        <>
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept="image/*"
            aria-describedby={describedBy}
            className="sr-only"
            multiple={room > 1}
            disabled={off}
            onChange={(e) => void pick(e.target.files)}
          />
          {field.allowCamera ? (
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              disabled={off}
              onChange={(e) => void pick(e.target.files)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={off}
              onClick={() => fileRef.current?.click()}
            >
              {busy > 0 ? (
                <Loader size="xs" label="Uploading" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {busy > 0 ? 'Uploading' : field.maxFiles > 1 ? 'Add images' : 'Choose an image'}
            </Button>
            {field.allowCamera ? (
              <Button
                type="button"
                variant="outline"
                disabled={off}
                onClick={() => cameraRef.current?.click()}
              >
                <Camera className="h-4 w-4" /> Take a photo
              </Button>
            ) : null}
          </div>
          <p className="text-ink-muted text-xs">
            Up to {field.maxFiles} {field.maxFiles === 1 ? 'image' : 'images'}, {field.maxSizeMb} MB
            each.
          </p>
        </>
      ) : null}
      {problem ? <p className="text-state-error text-xs font-medium">{problem}</p> : null}
    </div>
  );
}
