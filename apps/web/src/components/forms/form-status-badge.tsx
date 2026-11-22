import type { FormStatus, FormSummary } from '@botss/shared-types';

import { Badge } from '@/components/ui/badge';
import { effectiveFormStatus } from '@/lib/forms/accepting';

const LABELS: Record<FormStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Live', CLOSED: 'Closed' };
const TONES = { DRAFT: 'neutral', PUBLISHED: 'success', CLOSED: 'warning' } as const;

/** Shows Closed once a live form passed its close date or reached its response limit. */
export function FormStatusBadge({
  form,
}: {
  form: Pick<FormSummary, 'status' | 'closesAt' | 'responseLimit' | 'submissionCount'>;
}) {
  const status = effectiveFormStatus(form);
  return <Badge tone={TONES[status]}>{LABELS[status]}</Badge>;
}
