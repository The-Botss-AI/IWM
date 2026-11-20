'use client';

import {
  MEETING_ICS_MAX_BYTES,
  type IcsImportPreview,
  type IcsImportResult,
} from '@botss/shared-types';
import { useState } from 'react';

import { useImportIcs, usePreviewIcsImport } from '@/hooks/use-meetings';
import { toastErrorMessage } from '@/lib/toast';

export type IcsStep = 'pick' | 'preview' | 'result';

/** The .ics import flow: pick a file, preview, choose events, import, summary. */
export function useIcsImport() {
  const [step, setStep] = useState<IcsStep>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<IcsImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<IcsImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const previewMutation = usePreviewIcsImport();
  const importMutation = useImportIcs();

  const selectable = (preview?.events ?? []).filter((e) => e.importable);
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.uid));

  function reset(): void {
    setStep('pick');
    setFile(null);
    setPreview(null);
    setSelected(new Set());
    setResult(null);
    setFileError(null);
  }

  async function choose(next: File | null): Promise<void> {
    setFileError(null);
    if (!next) return;
    if (!/\.ics$/i.test(next.name) && next.type !== 'text/calendar') {
      setFileError('Choose a calendar file that ends in .ics');
      return;
    }
    if (next.size > MEETING_ICS_MAX_BYTES) {
      setFileError('That file is larger than 2 MB. Export a shorter date range and try again');
      return;
    }
    try {
      const data = await previewMutation.mutateAsync(next);
      setFile(next);
      setPreview(data);
      // New events start checked; ones already in the calendar start unchecked.
      setSelected(
        new Set(data.events.filter((e) => e.importable && !e.alreadyImported).map((e) => e.uid)),
      );
      setStep('preview');
    } catch {
      // The mutation's error toast already says why.
    }
  }

  function toggle(uid: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(selectable.map((e) => e.uid)));
  }

  async function runImport(): Promise<void> {
    if (!file || selected.size === 0) {
      toastErrorMessage('Pick at least one event to import');
      return;
    }
    try {
      const selection = allSelected ? ({ all: true } as const) : { uids: [...selected] };
      setResult(await importMutation.mutateAsync({ file, selection }));
      setStep('result');
    } catch {
      // The mutation's error toast already says why.
    }
  }

  return {
    step,
    file,
    preview,
    selected,
    selectable,
    allSelected,
    result,
    fileError,
    reading: previewMutation.isPending,
    importing: importMutation.isPending,
    choose,
    toggle,
    toggleAll,
    runImport,
    reset,
  };
}
