'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormSubmissionSource } from '@botss/shared-types';

import { useExportFormCsv, useFormSubmissions } from '@/hooks/use-forms';
import { dayRangeToInstants, type DayRange } from '@/lib/date-range';
import { buildResponseTable, versionOf } from '@/lib/forms/responses';

export const RESPONSES_PAGE_SIZE = 50;

/** Filters, paging, table model and export for the responses tab. */
export function useFormResponsesView(formId: string) {
  const [page, setPage] = useState(1);
  const [source, setSourceState] = useState<FormSubmissionSource | 'ALL'>('ALL');
  const [range, setRangeState] = useState<DayRange | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters = useMemo(() => {
    const instants = range ? dayRangeToInstants(range) : null;
    return {
      ...(source !== 'ALL' ? { source } : {}),
      ...(instants ? { from: instants.from, to: instants.to } : {}),
    };
  }, [source, range]);

  const query = useFormSubmissions(formId, { page, pageSize: RESPONSES_PAGE_SIZE, ...filters });
  const exporter = useExportFormCsv(formId);

  // A delete or a narrower filter can leave the page past the last one.
  const totalPages = query.data?.pagination.totalPages;
  useEffect(() => {
    if (totalPages !== undefined && page > Math.max(1, totalPages))
      setPage(Math.max(1, totalPages));
  }, [page, totalPages]);

  const setSource = useCallback((next: FormSubmissionSource | 'ALL') => {
    setSourceState(next);
    setPage(1);
  }, []);
  const setRange = useCallback((next: DayRange | null) => {
    setRangeState(next);
    setPage(1);
  }, []);

  const table = useMemo(() => (query.data ? buildResponseTable(query.data) : null), [query.data]);
  const selected = useMemo(() => {
    if (!query.data || !selectedId) return null;
    const submission = query.data.items.find((s) => s.id === selectedId);
    if (!submission) return null;
    return {
      submission,
      version: versionOf(query.data.versions, submission),
      crmLabels: query.data.crmLabels,
    };
  }, [query.data, selectedId]);

  return {
    query,
    table,
    selected,
    selectedId,
    setSelectedId,
    page,
    setPage,
    source,
    setSource,
    range,
    setRange,
    hasFilters: source !== 'ALL' || range !== null,
    exportCsv: () => exporter.mutate(filters),
    exporting: exporter.isPending,
  };
}
