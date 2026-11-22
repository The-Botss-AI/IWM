'use client';

import { Check, Eraser, PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type SignaturePadType from 'signature_pad';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { describeError } from '@/lib/toast';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

/** Draw a signature, confirm it, and it uploads as a PNG; the value is the upload id. */
/** Wait after the last stroke before saving, so a multi part signature is not cut short. */
const AUTOSAVE_MS = 700;

export function SignatureField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'signature'>) {
  const signed = typeof value === 'string';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadType | null>(null);
  const previewRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef<() => Promise<void>>(async () => {});
  const mountedRef = useRef(true);
  /**
   * While drawn ink waits for its autosave, the form counts it as an upload
   * in flight, so Submit and Next stay disabled until it is saved (or
   * cleared) and a quick Submit never loses the signature.
   */
  const releaseRef = useRef<(() => void) | null>(null);
  const trackRef = useRef(ctx.trackUpload);
  trackRef.current = ctx.trackUpload;
  const holdSubmit = useRef(() => {
    if (releaseRef.current) return;
    void trackRef.current(
      new Promise<void>((resolve) => {
        releaseRef.current = resolve;
      }),
    );
  }).current;
  const releaseSubmit = useRef(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }).current;

  useEffect(() => {
    if (signed) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    const raf = requestAnimationFrame(() => {
      void import('signature_pad').then(({ default: SignaturePad }) => {
        const canvas = canvasRef.current;
        if (disposed || !canvas) return;
        const resize = () => {
          const ratio = Math.max(window.devicePixelRatio || 1, 1);
          const data = padRef.current?.toData();
          canvas.width = canvas.offsetWidth * ratio;
          canvas.height = canvas.offsetHeight * ratio;
          canvas.getContext('2d')?.scale(ratio, ratio);
          padRef.current?.clear();
          if (data) padRef.current?.fromData(data);
        };
        const pad = new SignaturePad(canvas, {
          penColor: '#0f1f5c',
          minWidth: 0.8,
          maxWidth: 2.6,
          backgroundColor: 'rgba(0,0,0,0)',
        });
        padRef.current = pad;
        resize();
        const onBegin = () => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
        const onEnd = () => {
          setHasInk(!pad.isEmpty());
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          // Save the ink without waiting for the button, so submit never loses it.
          holdSubmit();
          saveTimerRef.current = setTimeout(
            () => void confirmRef.current().finally(releaseSubmit),
            AUTOSAVE_MS,
          );
        };
        pad.addEventListener('beginStroke', onBegin);
        pad.addEventListener('endStroke', onEnd);
        window.addEventListener('resize', resize);
        cleanup = () => {
          pad.removeEventListener('beginStroke', onBegin);
          pad.removeEventListener('endStroke', onEnd);
          window.removeEventListener('resize', resize);
          pad.off();
          padRef.current = null;
        };
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [signed, holdSubmit, releaseSubmit]);

  useEffect(() => {
    // Set on every mount: StrictMode runs this effect twice in development.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      releaseSubmit();
    };
  }, [releaseSubmit]);

  function clear() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    releaseSubmit();
    padRef.current?.clear();
    setHasInk(false);
    setProblem(null);
  }

  async function confirm() {
    const canvas = canvasRef.current;
    if (!canvas || !padRef.current || padRef.current.isEmpty()) {
      releaseSubmit();
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setBusy(true);
    setProblem(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error("Couldn't read the signature. Draw it again.");
      const id = await ctx.trackUpload(
        ctx.uploader({ fieldId: field.id, file: blob, fileName: 'signature.png' }),
      );
      if (!mountedRef.current) return;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const url = URL.createObjectURL(blob);
      previewRef.current = url;
      setPreview(url);
      onChange(id);
    } catch (err) {
      if (mountedRef.current)
        setProblem(describeError(err, "Couldn't save the signature. Try again."));
    } finally {
      if (mountedRef.current) setBusy(false);
      // Saved (or failed visibly) by the timer or the button: either way stop holding Submit.
      releaseSubmit();
    }
  }
  confirmRef.current = confirm;

  function again() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview(null);
    setHasInk(false);
    onChange(undefined);
  }

  if (signed) {
    return (
      <div className="space-y-2">
        <div
          className="border-line flex h-40 items-center justify-center rounded-lg border bg-white"
          aria-describedby={describedBy}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL
            <img
              src={preview}
              alt="Your signature"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-ink-muted text-sm">Signature saved.</span>
          )}
        </div>
        <p className="text-ink-muted flex items-center gap-1.5 text-xs font-medium" role="status">
          <Check className="h-3.5 w-3.5" /> Saved
        </p>
        <Button
          id={inputId}
          type="button"
          variant="outline"
          disabled={ctx.disabled}
          onClick={again}
        >
          <PenLine className="h-4 w-4" /> Sign again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        id={inputId}
        aria-label="Signature area. Draw your signature with a finger, stylus or mouse."
        aria-describedby={describedBy}
        className={cn(
          'border-line h-40 w-full touch-none rounded-lg border border-dashed bg-white',
          busy && 'pointer-events-none opacity-70',
        )}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={ctx.disabled || busy || !hasInk}
          onClick={clear}
        >
          <Eraser className="h-4 w-4" /> Clear
        </Button>
        <Button
          type="button"
          disabled={ctx.disabled || busy || !hasInk}
          onClick={() => void confirm()}
        >
          {busy ? <Loader size="xs" label="Saving" /> : null}
          Use this signature
        </Button>
      </div>
      {problem ? <p className="text-state-error text-xs font-medium">{problem}</p> : null}
    </div>
  );
}
