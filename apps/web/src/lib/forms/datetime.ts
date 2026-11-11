const pad = (n: number): string => String(n).padStart(2, '0');

/** Date -> value for `<input type="datetime-local">` in the viewer's time zone. */
export function toDateTimeLocal(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value -> Date (viewer's time zone), or null when empty or invalid. */
export function fromDateTimeLocal(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Stored ISO UTC instant -> `datetime-local` input value in the viewer's time zone. */
export function isoToLocalInput(iso: unknown): string {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  return toDateTimeLocal(Number.isNaN(d.getTime()) ? null : d);
}

/** `datetime-local` input value -> ISO UTC string, or undefined when empty or invalid. */
export function localInputToIso(value: string): string | undefined {
  return fromDateTimeLocal(value)?.toISOString();
}
