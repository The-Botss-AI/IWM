'use client';

import { RotateCcw, Square, Upload, Video } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';

import { formatClock, useMediaRecording } from './audio-recording-field';
import type { FieldProps } from './types';

/** Records from the camera with a live preview, a timer and re-record. */
export function VideoRecordingField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'video_recording'>) {
  const rec = useMediaRecording({
    kind: 'video',
    maxSeconds: field.maxSeconds,
    fieldId: field.id,
    value,
    onChange,
    upload: ctx.uploader,
    trackUpload: ctx.trackUpload,
  });
  const liveRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = liveRef.current;
    if (el) el.srcObject = rec.stream;
  }, [rec.stream, rec.status]);

  return (
    <div className="space-y-2" role="group" aria-label={field.label} aria-describedby={describedBy}>
      {rec.status === 'recording' ? (
        <>
          <video
            ref={liveRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full rounded-lg bg-black object-cover"
          />
          <div className="flex items-center gap-3">
            <span
              className="bg-state-error h-2.5 w-2.5 animate-pulse rounded-full"
              aria-hidden="true"
            />
            <span className="text-ink text-sm tabular-nums" role="timer">
              {formatClock(rec.elapsed)} / {formatClock(field.maxSeconds)}
            </span>
            <Button type="button" variant="outline" onClick={rec.stop}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          </div>
        </>
      ) : null}
      {rec.status === 'uploading' ? (
        <p className="text-ink-muted flex items-center gap-2 text-sm">
          <Loader size="xs" label="Uploading" /> Uploading
        </p>
      ) : null}
      {rec.previewUrl && rec.status !== 'recording' ? (
        <video
          controls
          playsInline
          src={rec.previewUrl}
          className="aspect-video w-full rounded-lg bg-black"
        />
      ) : null}
      {rec.status === 'done' && !rec.previewUrl ? (
        <p className="text-ink text-sm">Recording saved.</p>
      ) : null}
      {rec.status === 'idle' ? (
        <Button
          id={inputId}
          type="button"
          variant="outline"
          disabled={ctx.disabled}
          onClick={() => void rec.start()}
        >
          <Video className="h-4 w-4" /> Record video
        </Button>
      ) : null}
      {rec.status === 'done' ? (
        <Button
          id={inputId}
          type="button"
          variant="outline"
          disabled={ctx.disabled}
          onClick={rec.reset}
        >
          <RotateCcw className="h-4 w-4" /> Record again
        </Button>
      ) : null}
      {rec.status === 'failed' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            id={inputId}
            type="button"
            variant="outline"
            disabled={ctx.disabled}
            onClick={rec.retryUpload}
          >
            <Upload className="h-4 w-4" /> Try upload again
          </Button>
          <Button type="button" variant="outline" disabled={ctx.disabled} onClick={rec.reset}>
            <RotateCcw className="h-4 w-4" /> Record again
          </Button>
        </div>
      ) : null}
      {rec.status === 'idle' ? (
        <p className="text-ink-muted text-xs">Up to {formatClock(field.maxSeconds)}.</p>
      ) : null}
      {rec.problem ? <p className="text-state-error text-xs font-medium">{rec.problem}</p> : null}
    </div>
  );
}
