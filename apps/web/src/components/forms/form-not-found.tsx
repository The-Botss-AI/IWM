import Link from 'next/link';

import { Button } from '@/components/ui/button';

/** Shown when a form is missing, deleted, or the person may not open it. */
export function FormNotFound({
  message = "This form doesn't exist or you don't have access to it.",
}: {
  message?: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center">
      <h1 className="text-ink text-lg font-semibold">Form not found</h1>
      <p className="text-ink-muted text-sm">{message}</p>
      <Button asChild variant="secondary">
        <Link href="/form-builder">Back to forms</Link>
      </Button>
    </div>
  );
}
