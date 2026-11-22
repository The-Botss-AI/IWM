/**
 * Linear trailing-slash trimming. A regex such as /\/+$/ re-scans from every
 * position on a long run of non-matching input (polynomial ReDoS); a backwards
 * index walk visits each character once.
 */

/** Removes every trailing '/'. */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}

/** Removes at most one trailing '/'. */
export function trimOneTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
