import { toastErrorMessage, toastSuccess } from '@/lib/toast';

/** Copy text and say so; a refused clipboard says why instead of failing quietly. */
export async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess(done);
  } catch {
    toastErrorMessage("Couldn't copy", {
      description: 'The browser blocked clipboard access. Select the text and copy it by hand.',
    });
  }
}
