'use client';

import { Mic, RotateCcw, Square, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { describeError } from '@/lib/toast';

import type { FieldProps } from './types';

export type RecordingKind = 'audio' | 'video';

const CANDIDATES: Record<RecordingKind, string[]> = {
  audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'],
  video: ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
};

function pickMimeType(kind: RecordingKind): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CANDIDATES[kind].find((t) => MediaRecorder.isTypeSupported(t));
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

type Status = 'idle' | 'recording' | 'uploading' | 'failed' | 'done';

interface RecorderArgs {
  kind: RecordingKind;
  maxSeconds: number;
  fieldId: string;
  value: unknown;
  onChange: (value: unknown) => void;
  upload: FieldProps['ctx']['uploader'];
  trackUpload: FieldProps['ctx']['trackUpload'];
}

/**
 * MediaRecorder lifecycle shared by the audio and video fields. The finished
 * blob is uploaded at once; the value is the upload id. All tracks are
 * stopped on stop and on unmount.
 */
export function useMediaRecording({
  kind,
  maxSeconds,
  fieldId,
  value,
  onChange,
  upload,
  trackUpload,
}: RecorderArgs) {
  const [status, setStatus] = useState<Status>(typeof value === 'string' ? 'done' : 'idle');
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  // Kept when the upload fails so the person can retry without recording again.
  const pendingBlobRef = useRef<Blob | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const supported =
    typeof window === 'undefined' ||
    (typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices);

  const release = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => {
    // Set on every mount: StrictMode runs this effect twice in development.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        rec.stop();
      }
      release();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, [release]);

  const uploadBlob = useCallback(
    async (blob: Blob) => {
      setProblem(null);
      setStatus('uploading');
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      try {
        const id = await trackUpload(upload({ fieldId, file: blob, fileName: `recording.${ext}` }));
        if (!mountedRef.current) return;
        pendingBlobRef.current = null;
        setStatus('done');
        onChangeRef.current(id);
      } catch (err) {
        if (!mountedRef.current) return;
        pendingBlobRef.current = blob;
        setProblem(describeError(err, "Couldn't upload the recording. Try again."));
        setStatus('failed');
      }
    },
    [fieldId, trackUpload, upload],
  );

  const finish = useCallback(
    async (blob: Blob) => {
      if (!mountedRef.current) return;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const url = URL.createObjectURL(blob);
      previewRef.current = url;
      setPreviewUrl(url);
      await uploadBlob(blob);
    },
    [uploadBlob],
  );

  const retryUpload = useCallback(() => {
    const blob = pendingBlobRef.current;
    if (blob) void uploadBlob(blob);
  }, [uploadBlob]);

  const start = useCallback(async () => {
    setProblem(null);
    const mimeType = pickMimeType(kind);
    if (!supported || !mimeType) {
      setProblem(
        'Recording is not supported in this browser. Try a recent Chrome, Edge, Firefox or Safari.',
      );
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: true } : { audio: true, video: true },
      );
    } catch (err) {
      const denied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      const missing = err instanceof DOMException && err.name === 'NotFoundError';
      setProblem(
        denied
          ? `Allow ${kind === 'audio' ? 'microphone' : 'camera and microphone'} access in your browser to record.`
          : missing
            ? `No ${kind === 'audio' ? 'microphone' : 'camera'} was found on this device.`
            : "Couldn't start recording.",
      );
      return;
    }
    streamRef.current = media;
    setStream(media);
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(media, { mimeType });
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      release();
      const type = rec.mimeType || mimeType;
      void finish(new Blob(chunks, { type: type.split(';')[0] ?? type }));
    };
    rec.onerror = () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          // Already stopped by the error.
        }
      }
      release();
      if (!mountedRef.current) return;
      setProblem("Couldn't record. Try again.");
      setElapsed(0);
      setStatus('idle');
    };
    rec.start(1000);
    setElapsed(0);
    setStatus('recording');
    let seconds = 0;
    timerRef.current = setInterval(() => {
      seconds += 1;
      setElapsed(seconds);
      if (seconds >= maxSeconds && rec.state !== 'inactive') rec.stop();
    }, 1000);
  }, [finish, kind, maxSeconds, release, supported]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const reset = useCallback(() => {
    pendingBlobRef.current = null;
    setProblem(null);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setElapsed(0);
    setStatus('idle');
    onChange(undefined);
  }, [onChange]);

  return {
    status,
    elapsed,
    problem,
    previewUrl,
    stream,
    supported,
    start,
    stop,
    reset,
    retryUpload,
  };
}

/** Records from the microphone, with a timer, preview and re-record. */
export function AudioRecordingField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'audio_recording'>) {
  const rec = useMediaRecording({
    kind: 'audio',
    maxSeconds: field.maxSeconds,
    fieldId: field.id,
    value,
    onChange,
    upload: ctx.uploader,
    trackUpload: ctx.trackUpload,
  });

  return (
    <div className="space-y-2" role="group" aria-label={field.label} aria-describedby={describedBy}>
      {rec.status === 'recording' ? (
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
      ) : null}
      {rec.status === 'uploading' ? (
        <p className="text-ink-muted flex items-center gap-2 text-sm">
          <Loader size="xs" label="Uploading" /> Uploading
        </p>
      ) : null}
      {rec.previewUrl && rec.status !== 'recording' ? (
        <audio controls src={rec.previewUrl} className="w-full" />
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
          <Mic className="h-4 w-4" /> Record audio
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
