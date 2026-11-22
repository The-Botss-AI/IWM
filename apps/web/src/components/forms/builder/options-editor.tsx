'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { FormOption } from '@botss/shared-types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader } from '@/components/ui/loader';
import { useFormImageUpload } from '@/hooks/use-form-image-upload';
import { toastErrorMessage } from '@/lib/toast';

interface OptionsEditorProps {
  /** Heading shown above the list, like "Options" or "Rows". */
  title: string;
  /** Singular noun used in button labels, like "option". */
  noun: string;
  items: readonly FormOption[];
  max: number;
  /** Lowest number of items the form accepts; the last ones cannot be removed. */
  min?: number;
  onAdd: () => void;
  onRename: (optionId: string, label: string) => void;
  onRemove: (optionId: string) => void;
  onReorder: (from: number, to: number) => void;
  /** Picture choice: show an image picker per option. */
  withImages?: boolean;
  onImage?: (optionId: string, url: string | undefined) => void;
}

/** Sortable list of labelled items (options, matrix rows or columns, ranking items). */
export function OptionsEditor({
  title,
  noun,
  items,
  max,
  min = 1,
  onAdd,
  onRename,
  onRemove,
  onReorder,
  withImages = false,
  onImage,
}: OptionsEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((o) => o.id === e.active.id);
    const to = items.findIndex((o) => o.id === e.over?.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-ink text-[13px] font-medium">{title}</span>
        <span className="text-ink-muted text-xs">
          {items.length} of {max}
        </span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((o) => o.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5" role="list">
            {items.map((o, i) => (
              <OptionRow
                key={o.id}
                option={o}
                index={i}
                noun={noun}
                canRemove={items.length > min}
                withImages={withImages}
                onRename={onRename}
                onRemove={onRemove}
                onReorder={onReorder}
                last={i === items.length - 1}
                {...(onImage ? { onImage } : {})}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <Button
        variant="outline"
        size="sm"
        onClick={onAdd}
        disabled={items.length >= max}
        aria-label={`Add ${noun}`}
        className="w-full"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add {noun}
      </Button>
    </div>
  );
}

function OptionRow({
  option,
  index,
  noun,
  canRemove,
  withImages,
  last,
  onRename,
  onRemove,
  onReorder,
  onImage,
}: {
  option: FormOption;
  index: number;
  noun: string;
  canRemove: boolean;
  withImages: boolean;
  last: boolean;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onImage?: (id: string, url: string | undefined) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
  });
  const inputId = useId();
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="border-line rounded-md border bg-white p-1.5"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="text-ink-muted hover:bg-bg-subtle focus-visible:shadow-focus cursor-grab touch-none rounded p-1.5 focus-visible:outline-none"
          aria-label={`Drag ${noun} ${index + 1} to reorder. With the keyboard press space, then the arrow keys.`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <Label htmlFor={inputId} className="sr-only">
          {`${noun} ${index + 1}`}
        </Label>
        <Input
          id={inputId}
          className="h-9 min-w-0 flex-1"
          value={option.label}
          maxLength={300}
          onChange={(e) => onRename(option.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.altKey && e.key === 'ArrowUp' && index > 0) onReorder(index, index - 1);
            if (e.altKey && e.key === 'ArrowDown' && !last) onReorder(index, index + 1);
          }}
        />
        <button
          type="button"
          className="text-ink-muted hover:bg-bg-subtle hover:text-state-error focus-visible:shadow-focus rounded p-1.5 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
          aria-label={`Remove ${noun} ${index + 1}`}
          disabled={!canRemove}
          onClick={() => onRemove(option.id)}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {withImages && onImage ? (
        <OptionImage option={option} index={index} onImage={onImage} />
      ) : null}
    </li>
  );
}

function OptionImage({
  option,
  index,
  onImage,
}: {
  option: FormOption;
  index: number;
  onImage: (id: string, url: string | undefined) => void;
}) {
  const upload = useFormImageUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const urlId = useId();

  const commitUrl = () => {
    const value = draftUrl.trim();
    if (!value) return;
    if (!/^https:\/\//i.test(value)) {
      toastErrorMessage("Couldn't use that link. It must start with https://");
      return;
    }
    onImage(option.id, value);
    setDraftUrl('');
  };

  return (
    <div className="mt-1.5 space-y-1.5 pl-8">
      {option.imageUrl ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- user supplied remote image */}
          <img
            src={option.imageUrl}
            alt=""
            className="border-line h-12 w-12 rounded-md border object-cover"
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove image for option ${index + 1}`}
            onClick={() => onImage(option.id, undefined)}
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Remove image
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-label={`Upload image for option ${index + 1}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) upload.mutate(file, { onSuccess: (url) => onImage(option.id, url) });
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              aria-label={`Upload an image for option ${index + 1}`}
              onClick={() => fileRef.current?.click()}
            >
              {upload.isPending ? (
                <Loader size="xs" label="Uploading" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />
              )}
              Upload image
            </Button>
          </div>
          <div className="flex gap-1.5">
            <Label
              htmlFor={urlId}
              className="sr-only"
            >{`Image link for option ${index + 1}`}</Label>
            <Input
              id={urlId}
              className="h-9 min-w-0 flex-1"
              placeholder="Or paste an https link"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitUrl();
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              aria-label={`Use the image link for option ${index + 1}`}
              disabled={!draftUrl.trim()}
              onClick={commitUrl}
            >
              Use link
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
