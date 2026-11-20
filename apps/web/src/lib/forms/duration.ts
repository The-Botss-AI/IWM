/** Total minutes -> the hour and minute input strings ('' when unanswered). */
export function minutesToParts(value: unknown): { hours: string; minutes: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { hours: '', minutes: '' };
  const total = Math.max(0, Math.round(value));
  return { hours: String(Math.floor(total / 60)), minutes: String(total % 60) };
}

/** Hour and minute input strings -> total minutes, or undefined when both are empty. */
export function partsToMinutes(hours: string, minutes: string): number | undefined {
  if (hours === '' && minutes === '') return undefined;
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  return h * 60 + m;
}
