import { ExpressionError, expressionRefs, parseExpression } from '@botss/forms';
import {
  FORM_NUMERIC_TYPES,
  formFieldSchema,
  formRepeaterChildSchema,
  isFormInputType,
  type FormDefinition,
  type FormField,
  type FormFieldLogic,
  type FormFieldType,
  type FormLogicCondition,
  type FormLogicOperator,
  type FormOption,
  type FormRepeaterChild,
} from '@botss/shared-types';

import { CATALOG_BY_TYPE, newKey } from './field-catalog';

/**
 * Pure editing operations on a form definition. The builder hook wires these
 * to React state; nothing here renders or touches the network.
 */

/** Every settable property of a field except its identity, per field type. */
export type FieldPatch<F extends FormField = FormField> = F extends unknown
  ? { [K in Exclude<keyof F, 'id' | 'type'>]?: F[K] | undefined }
  : never;

/** Shallow patch of a repeater child; `undefined` removes the property. */
export type ChildPatch = { [key: string]: unknown };

/** Lists of `{id,label}` rows a field can own. */
export type OptionListKey = 'options' | 'rows' | 'columns';

/** Shallow patch; `undefined` removes the property. */
function applyPatch<T extends object>(target: T, patch: object): T {
  const next: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T; // the draft is re-validated with formDefinitionSchema before every save
}

export function createField(type: FormFieldType): FormField {
  const entry = CATALOG_BY_TYPE.get(type);
  if (!entry) throw new Error(`Unknown field type ${type}`);
  return formFieldSchema.parse(entry.create(newKey()));
}

export function createRepeaterChild(type: FormFieldType): FormRepeaterChild | null {
  const entry = CATALOG_BY_TYPE.get(type);
  if (!entry) return null;
  const parsed = formRepeaterChildSchema.safeParse(entry.create(newKey()));
  return parsed.success ? parsed.data : null;
}

function rekeyList(list: readonly FormOption[], idMap?: Map<string, string>): FormOption[] {
  return list.map((o) => {
    const id = newKey('o');
    idMap?.set(o.id, id);
    return { ...o, id };
  });
}

/** `name_2`, `name_3`, ... the first one not already used. */
function uniqueParamName(name: string, taken: ReadonlySet<string>): string {
  let n = 2;
  while (taken.has(`${name}_${n}`)) n += 1;
  return `${name}_${n}`;
}

/**
 * Deep copy with new ids for the field, its options, rows, columns and repeater children.
 * A copied hidden field gets a free link parameter name; a preselected choice follows its new option.
 */
export function cloneField(field: FormField, existing: readonly FormField[] = []): FormField {
  const copy = structuredClone(field);
  copy.id = newKey();
  if ('options' in copy) {
    const idMap = new Map<string, string>();
    copy.options = rekeyList(copy.options, idMap);
    if ('defaultValue' in copy && typeof copy.defaultValue === 'string') {
      const mapped = idMap.get(copy.defaultValue);
      if (mapped) (copy as { defaultValue?: string }).defaultValue = mapped;
    }
  }
  if (copy.type === 'matrix') {
    copy.rows = rekeyList(copy.rows);
    copy.columns = rekeyList(copy.columns);
  }
  if (copy.type === 'repeater') copy.fields = copy.fields.map((c) => ({ ...c, id: newKey() }));
  if (copy.type === 'hidden') {
    const taken = new Set(existing.flatMap((f) => (f.type === 'hidden' ? [f.paramName] : [])));
    copy.paramName = uniqueParamName(copy.paramName, taken);
  }
  return copy;
}

function clampIndex(i: number, max: number): number {
  return Math.max(0, Math.min(i, max));
}

export function insertField(
  def: FormDefinition,
  field: FormField,
  atIndex?: number,
): FormDefinition {
  const fields = [...def.fields];
  fields.splice(clampIndex(atIndex ?? fields.length, fields.length), 0, field);
  return { ...def, fields };
}

/** How many other fields have a rule that looks at this field. */
export function countLogicReferences(def: FormDefinition, id: string): number {
  return def.fields.filter((f) => f.id !== id && f.logic?.conditions.some((c) => c.fieldId === id))
    .length;
}

/**
 * Removes a field and any rule conditions in other fields that pointed at it.
 * Formulas are left alone; the issue list flags them.
 */
export function removeFieldById(def: FormDefinition, id: string): FormDefinition {
  const fields = def.fields
    .filter((f) => f.id !== id)
    .map((f): FormField => {
      if (!f.logic || !f.logic.conditions.some((c) => c.fieldId === id)) return f;
      const conditions = f.logic.conditions.filter((c) => c.fieldId !== id);
      if (conditions.length === 0) {
        const { logic: _removed, ...rest } = f;
        return rest as FormField;
      }
      return { ...f, logic: { ...f.logic, conditions } } as FormField;
    });
  return { ...def, fields };
}

export function moveFieldIndex(def: FormDefinition, from: number, to: number): FormDefinition {
  if (from === to || from < 0 || from >= def.fields.length) return def;
  const fields = [...def.fields];
  const [item] = fields.splice(from, 1);
  if (!item) return def;
  fields.splice(clampIndex(to, fields.length), 0, item);
  return { ...def, fields };
}

export function patchFieldById(def: FormDefinition, id: string, patch: object): FormDefinition {
  return { ...def, fields: def.fields.map((f) => (f.id === id ? applyPatch(f, patch) : f)) };
}

/** Applies `fn` to one field; used by the option, child and logic helpers. */
export function mapField(
  def: FormDefinition,
  id: string,
  fn: (f: FormField) => FormField,
): FormDefinition {
  return { ...def, fields: def.fields.map((f) => (f.id === id ? fn(f) : f)) };
}

// ─── Option lists ───────────────────────────────────────────────────────────

function getList(field: FormField, key: OptionListKey): readonly FormOption[] {
  if (key === 'options' && 'options' in field) return field.options;
  if (field.type === 'matrix' && key === 'rows') return field.rows;
  if (field.type === 'matrix' && key === 'columns') return field.columns;
  return [];
}

function withList(field: FormField, key: OptionListKey, list: FormOption[]): FormField {
  return applyPatch(field, { [key]: list });
}

export function updateOptionList(
  def: FormDefinition,
  fieldId: string,
  key: OptionListKey,
  fn: (list: readonly FormOption[]) => FormOption[],
): FormDefinition {
  return mapField(def, fieldId, (f) => withList(f, key, fn(getList(f, key))));
}

export function nextOptionLabel(list: readonly FormOption[], key: OptionListKey): string {
  const noun = key === 'rows' ? 'Row' : key === 'columns' ? 'Column' : 'Option';
  return `${noun} ${list.length + 1}`;
}

export function addToList(
  list: readonly FormOption[],
  key: OptionListKey,
  label?: string,
): FormOption[] {
  return [...list, { id: newKey('o'), label: label?.trim() || nextOptionLabel(list, key) }];
}

export function reorderList<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(clampIndex(to, next.length), 0, item);
  return next;
}

// ─── Repeater children ──────────────────────────────────────────────────────

export function updateChildren(
  def: FormDefinition,
  repeaterId: string,
  fn: (children: readonly FormRepeaterChild[]) => FormRepeaterChild[],
): FormDefinition {
  return mapField(def, repeaterId, (f) =>
    f.type === 'repeater' ? { ...f, fields: fn(f.fields) } : f,
  );
}

export function patchChild(
  children: readonly FormRepeaterChild[],
  childId: string,
  patch: object,
): FormRepeaterChild[] {
  return children.map((c) => (c.id === childId ? applyPatch(c, patch) : c));
}

// ─── Logic ──────────────────────────────────────────────────────────────────

export const LOGIC_OPERATOR_LABELS: Record<FormLogicOperator, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  gt: 'is greater than',
  lt: 'is less than',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

const NUMERIC = new Set<FormFieldType>(FORM_NUMERIC_TYPES);
const ORDERED_TEXT = new Set<FormFieldType>(['date', 'month', 'time', 'datetime']);
const SINGLE_CHOICE = new Set<FormFieldType>(['dropdown', 'radio']);
const MULTI_CHOICE = new Set<FormFieldType>(['multi_select', 'checkboxes', 'tags', 'ranking']);
const TEXT_LIKE = new Set<FormFieldType>([
  'short_text',
  'long_text',
  'rich_text',
  'email',
  'phone',
  'url',
  'country',
  'timezone',
  'hidden',
  'color',
]);

/** Fields a later field's rule may look at: questions that hold a simple answer. */
export function isLogicSource(field: FormField): boolean {
  return isFormInputType(field.type) && field.type !== 'repeater';
}

/** The fields before `fieldId` that its rule can point at. */
export function earlierLogicFields(def: FormDefinition, fieldId: string): FormField[] {
  const index = def.fields.findIndex((f) => f.id === fieldId);
  return def.fields.slice(0, index < 0 ? 0 : index).filter(isLogicSource);
}

/** Earlier numeric fields, for formulas. */
export function earlierNumericFields(def: FormDefinition, fieldId: string): FormField[] {
  const index = def.fields.findIndex((f) => f.id === fieldId);
  return def.fields.slice(0, index < 0 ? 0 : index).filter((f) => NUMERIC.has(f.type));
}

export function operatorsFor(field: FormField): FormLogicOperator[] {
  const empties: FormLogicOperator[] = ['is_empty', 'is_not_empty'];
  if (field.type === 'picture_choice') {
    return field.multiple
      ? ['contains', 'not_contains', ...empties]
      : ['equals', 'not_equals', ...empties];
  }
  if (SINGLE_CHOICE.has(field.type)) return ['equals', 'not_equals', ...empties];
  if (MULTI_CHOICE.has(field.type)) return ['contains', 'not_contains', ...empties];
  if (field.type === 'yes_no' || field.type === 'consent') return ['equals', ...empties];
  if (NUMERIC.has(field.type)) return ['equals', 'not_equals', 'gt', 'lt', ...empties];
  if (ORDERED_TEXT.has(field.type)) return ['equals', 'not_equals', 'gt', 'lt', ...empties];
  if (TEXT_LIKE.has(field.type))
    return ['equals', 'not_equals', 'contains', 'not_contains', ...empties];
  return empties;
}

export type LogicValueKind =
  | 'none'
  | 'option'
  | 'boolean'
  | 'number'
  | 'date'
  | 'time'
  | 'month'
  | 'text';

export function valueKindFor(field: FormField, op: FormLogicOperator): LogicValueKind {
  if (op === 'is_empty' || op === 'is_not_empty') return 'none';
  if ('options' in field && field.type !== 'ranking') return 'option';
  if (field.type === 'ranking') return 'option';
  if (field.type === 'yes_no' || field.type === 'consent') return 'boolean';
  if (NUMERIC.has(field.type)) return 'number';
  if (field.type === 'date') return 'date';
  if (field.type === 'time') return 'time';
  if (field.type === 'month') return 'month';
  return 'text';
}

export function defaultConditionValue(
  field: FormField,
  op: FormLogicOperator,
): FormLogicCondition['value'] {
  const kind = valueKindFor(field, op);
  if (kind === 'option' && 'options' in field) return field.options[0]?.id;
  if (kind === 'boolean') return true;
  if (kind === 'number') return 0;
  return kind === 'none' ? undefined : '';
}

export function defaultCondition(field: FormField): FormLogicCondition {
  const op = operatorsFor(field)[0] ?? 'is_not_empty';
  const value = defaultConditionValue(field, op);
  return value === undefined ? { fieldId: field.id, op } : { fieldId: field.id, op, value };
}

export function emptyLogic(first: FormField): FormFieldLogic {
  return { action: 'show', match: 'all', conditions: [defaultCondition(first)] };
}

/** True when the rule points at a field that is missing or not before this one. */
export function conditionIsBroken(
  def: FormDefinition,
  ownerId: string,
  c: FormLogicCondition,
): boolean {
  return !earlierLogicFields(def, ownerId).some((f) => f.id === c.fieldId);
}

// ─── Formula ────────────────────────────────────────────────────────────────

/** Parse problem for a formula, or null when it reads fine. */
export function expressionProblem(src: string): string | null {
  if (!src.trim()) return 'Write a formula, for example {price} * {qty}.';
  try {
    parseExpression(src);
    return null;
  } catch (err) {
    return err instanceof ExpressionError ? err.message : 'This formula cannot be read.';
  }
}

/** Ids a formula uses that are not in `allowed` (earlier numeric fields). */
export function expressionUnknownRefs(src: string, allowed: ReadonlySet<string>): string[] {
  try {
    return expressionRefs(parseExpression(src)).filter((id) => !allowed.has(id));
  } catch {
    return [];
  }
}

// ─── Drag and drop ──────────────────────────────────────────────────────────

export const PALETTE_DRAG_PREFIX = 'palette:';

export type DropResult =
  | { kind: 'add'; type: FormFieldType; index: number }
  | { kind: 'move'; from: number; to: number };

/** Turns a dnd-kit drop into an operation. `overId` may be a field id or the canvas end zone. */
export function resolveDrop(
  activeId: string,
  overId: string | null,
  fieldIds: readonly string[],
): DropResult | null {
  if (!overId) return null;
  const overIndex = overId === CANVAS_END_ID ? fieldIds.length : fieldIds.indexOf(overId);
  if (overIndex < 0) return null;
  if (activeId.startsWith(PALETTE_DRAG_PREFIX)) {
    const type = activeId.slice(PALETTE_DRAG_PREFIX.length);
    if (!CATALOG_BY_TYPE.has(type as FormFieldType)) return null;
    return { kind: 'add', type: type as FormFieldType, index: overIndex };
  }
  const from = fieldIds.indexOf(activeId);
  if (from < 0 || from === overIndex) return null;
  return { kind: 'move', from, to: overIndex };
}

export const CANVAS_END_ID = 'canvas-end';

// ─── Misc ───────────────────────────────────────────────────────────────────

export const CURRENCY_PRESETS = ['PKR', 'AED', 'TRY', 'USD', 'EUR', 'GBP', 'SAR'] as const;

/** Sentence for the first problem in a failed schema parse, naming the field. */
export function describeSchemaProblem(
  def: FormDefinition,
  issue: { path: PropertyKey[]; message: string },
): string {
  const [head, index] = issue.path;
  if (head === 'fields' && typeof index === 'number') {
    const field = def.fields[index];
    const name = field?.label?.trim() || `Field ${index + 1}`;
    return `${name}: ${issue.message}`;
  }
  return issue.message;
}

export function fieldDisplayName(field: FormField, index: number): string {
  return field.label.trim() || `Field ${index + 1}`;
}

/** Live check issues and server publish errors, grouped by field (deduplicated). */
export function groupProblems(
  issues: readonly { fieldId: string | null; message: string }[],
  publishErrors: Record<string, string[]>,
): { byField: Map<string, string[]>; form: string[] } {
  const byField = new Map<string, string[]>();
  const form: string[] = [];
  const add = (fieldId: string | null, message: string) => {
    if (fieldId === null) {
      if (!form.includes(message)) form.push(message);
      return;
    }
    const list = byField.get(fieldId) ?? [];
    if (!list.includes(message)) list.push(message);
    byField.set(fieldId, list);
  };
  for (const i of issues) add(i.fieldId, i.message);
  for (const [key, messages] of Object.entries(publishErrors)) {
    // Keys are a field id, "form", or "fieldId.index.childId" for repeater rows.
    const fieldId = key === 'form' ? null : (key.split('.')[0] ?? null);
    for (const m of messages) add(fieldId, m);
  }
  return { byField, form };
}
