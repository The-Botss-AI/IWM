import type {
  FormDefinition,
  FormField,
  FormFieldLogic,
  FormLogicCondition,
} from '@botss/shared-types';

/** Answers as the renderer or the validator holds them: field id -> value. */
export type AnswerMap = Readonly<Record<string, unknown>>;

/**
 * Empty = nothing entered. `false` and `0` are answers, not empty. Depth is
 * capped so a deeply nested value cannot overflow the stack (deeper than the
 * cap counts as entered; the validator rejects such shapes anyway).
 */
export function answerIsEmpty(value: unknown, depth = 0): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    if (depth >= 8) return false;
    return Object.values(value as object).every((v) => answerIsEmpty(v, depth + 1));
  }
  return false;
}

/** The number a value stands for in comparisons and formulas, if any. */
export function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  if (value && typeof value === 'object' && 'amount' in value)
    return numericValue((value as { amount: unknown }).amount);
  return null;
}

const ISO_DATE_PREFIX = /^\d{4}-\d{2}(-\d{2})?/;

function norm(v: unknown): string {
  return String(v).trim().toLowerCase();
}

function scalarEquals(value: unknown, target: FormLogicCondition['value']): boolean {
  if (target === undefined) return false;
  if (typeof value === 'boolean' || typeof target === 'boolean')
    return String(value) === String(target);
  const a = numericValue(value);
  const b = numericValue(target);
  if (a !== null && b !== null && typeof value !== 'string') return a === b;
  return norm(value) === norm(target);
}

function compare(value: unknown, target: FormLogicCondition['value'], dir: 1 | -1): boolean {
  const a = numericValue(value);
  const b = numericValue(target);
  if (a !== null && b !== null) return dir === 1 ? a > b : a < b;
  // Dates and months compare as ISO strings.
  if (
    typeof value === 'string' &&
    typeof target === 'string' &&
    ISO_DATE_PREFIX.test(value) &&
    ISO_DATE_PREFIX.test(target)
  ) {
    return dir === 1 ? value > target : value < target;
  }
  return false;
}

export function conditionHolds(cond: FormLogicCondition, value: unknown): boolean {
  switch (cond.op) {
    case 'is_empty':
      return answerIsEmpty(value);
    case 'is_not_empty':
      return !answerIsEmpty(value);
    case 'equals':
      if (answerIsEmpty(value)) return false;
      return Array.isArray(value)
        ? value.some((v) => scalarEquals(v, cond.value))
        : scalarEquals(value, cond.value);
    case 'not_equals':
      if (answerIsEmpty(value)) return true;
      return Array.isArray(value)
        ? !value.some((v) => scalarEquals(v, cond.value))
        : !scalarEquals(value, cond.value);
    case 'contains':
    case 'not_contains': {
      let hit = false;
      if (!answerIsEmpty(value) && cond.value !== undefined) {
        hit = Array.isArray(value)
          ? value.some((v) => scalarEquals(v, cond.value))
          : typeof value === 'string' && norm(value).includes(norm(cond.value));
      }
      return cond.op === 'contains' ? hit : !hit;
    }
    case 'gt':
      return compare(value, cond.value, 1);
    case 'lt':
      return compare(value, cond.value, -1);
  }
}

/**
 * Whether a field's own logic lets it show. A condition on a field that is not
 * visible sees an empty value, so hiding a question also clears what depends on it.
 */
export function logicAllows(
  logic: FormFieldLogic | undefined,
  answers: AnswerMap,
  visible: ReadonlySet<string>,
): boolean {
  if (!logic) return true;
  const results = logic.conditions.map((c) =>
    conditionHolds(c, visible.has(c.fieldId) ? answers[c.fieldId] : undefined),
  );
  const matched = logic.match === 'all' ? results.every(Boolean) : results.some(Boolean);
  return logic.action === 'show' ? matched : !matched;
}

/**
 * Walks the form in order and returns the ids of every field (layout
 * included) that is currently shown. A hidden page break hides its whole page,
 * up to the next page break. Conditions only reference earlier fields
 * (`checkDefinition`), so one pass is exact.
 */
export function visibleFieldIds(def: FormDefinition, answers: AnswerMap): Set<string> {
  const visible = new Set<string>();
  walkVisible(def.fields, answers, visible, () => {});
  return visible;
}

/** Shared walker: calls `onVisible` for each shown field, in order, as `visible` grows. */
export function walkVisible(
  fields: readonly FormField[],
  answers: AnswerMap,
  visible: Set<string>,
  onVisible: (field: FormField) => void,
): void {
  let pageShown = true;
  for (const field of fields) {
    if (field.type === 'page_break') {
      pageShown = logicAllows(field.logic, answers, visible);
      if (pageShown) {
        visible.add(field.id);
        onVisible(field);
      }
      continue;
    }
    if (!pageShown) continue;
    if (logicAllows(field.logic, answers, visible)) {
      visible.add(field.id);
      onVisible(field);
    }
  }
}

/** Splits fields into pages at each page break (the break starts the next page). */
export function splitPages(fields: readonly FormField[]): FormField[][] {
  const pages: FormField[][] = [[]];
  for (const f of fields) {
    if (f.type === 'page_break') pages.push([f]);
    else pages[pages.length - 1]!.push(f);
  }
  return pages.filter((p, i) => i === 0 || p.length > 0);
}
