'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormListScope } from '@botss/shared-types';

import { useForms } from '@/hooks/use-forms';
import { useDebouncedValue } from '@/hooks/use-debounced';
import { usePermissions } from '@/hooks/use-permissions';
import { useWorkspaceAdmin } from '@/hooks/use-workspace-admin';

export const FORM_PAGE_SIZE = 20;

/** State and query for the forms list page: scope tab, search and paging. */
export function useFormListView() {
  const isWorkspaceAdmin = useWorkspaceAdmin();
  const { isOrgAdmin } = usePermissions();
  const [scope, setScopeState] = useState<FormListScope>('mine');
  const [search, setSearchState] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim(), 250);

  const setScope = useCallback((next: FormListScope) => {
    setScopeState(next);
    setPage(1);
  }, []);
  const setSearch = useCallback((next: string) => {
    setSearchState(next);
    setPage(1);
  }, []);

  const list = useForms({ scope, page, pageSize: FORM_PAGE_SIZE, ...(q ? { q } : {}) });
  // A delete or a narrower filter can leave the page past the last one.
  const totalPages = list.data?.pagination.totalPages;
  useEffect(() => {
    if (totalPages !== undefined && page > Math.max(1, totalPages))
      setPage(Math.max(1, totalPages));
  }, [page, totalPages]);

  return {
    scope,
    setScope,
    search,
    setSearch,
    page,
    setPage,
    list,
    hasFilters: q.length > 0,
    canSeeAll: isWorkspaceAdmin || isOrgAdmin,
  };
}
