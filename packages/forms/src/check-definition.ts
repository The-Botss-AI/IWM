import {
  FORM_NUMERIC_TYPES,
  isFormInputType,
  type FormDefinition,
  type FormDefinitionIssue,
  type FormField,
  type FormFieldType,
} from '@botss/shared-types';

import { ExpressionError, expressionRefs, parseExpression } from './expression.js';
import { isSafePattern } from './reference.js';

const NUMERIC = new Set<FormFieldType>(FORM_NUMERIC_TYPES);
/** Types that can be compared with gt/lt besides numbers (ISO strings). */
const ORDERED_TEXT = new Set<FormFieldType>(['date', 'month', 'time', 'datetime']);
const OPTION_TYPES = new Set<FormFieldType>([
  'dropdown',
  'radio',
  'multi_select',
  'checkboxes',
  'picture_choice',
]);

/**
 * Publish-time checks on top of the structural Zod schema. An empty list means
 * the form can be published. Messages are written for the builder UI.
 */
export function checkDefinition(def: FormDefinition): FormDefinitionIssue[] {
  const issues: FormDefinitionIssue[] = [];
  const add = (field: FormField | null, message: string): void => {
    issues.push({ fieldId: field?.id ?? null, message });
  };
  const earlier = new Map<string, FormField>();
  const params = new Set<string>();

  if (!def.fields.some((f) => isFormInputType(f.type))) add(null, 'Add at least one question.');

  def.fields.forEach((field, i) => {
    const name = field.label.trim() || `Field ${i + 1}`;

    if (isFormInputType(field.type) && field.type !== 'hidden' && !field.label.trim()) {
      add(field, `Field ${i + 1} needs a label.`);
    }

    if (field.type === 'page_break') {
      const prev = def.fields[i - 1];
      if (i === 0) add(field, 'A page break cannot be the first item.');
      else if (i === def.fields.length - 1) add(field, 'A page break cannot be the last item.');
      else if (prev?.type === 'page_break')
        add(field, 'Two page breaks in a row make an empty page.');
    }

    if (field.logic) {
      for (const c of field.logic.conditions) {
        const target = earlier.get(c.fieldId);
        if (!target) {
          add(
            field,
            `"${name}" has a rule that points at a question that is missing or comes later.`,
          );
          continue;
        }
        if (
          (c.op === 'gt' || c.op === 'lt') &&
          !NUMERIC.has(target.type) &&
          !ORDERED_TEXT.has(target.type)
        ) {
          add(
            field,
            `"${name}" compares "${target.label}" as a number, but it is not a number question.`,
          );
        }
        if (
          (c.op === 'equals' || c.op === 'not_equals') &&
          OPTION_TYPES.has(target.type) &&
          'options' in target &&
          typeof c.value === 'string' &&
          !target.options.some((o) => o.id === c.value)
        ) {
          add(
            field,
            `"${name}" has a rule that uses an option of "${target.label}" that no longer exists.`,
          );
        }
        if (
          target.type === 'consent' &&
          !(
            c.op === 'is_empty' ||
            c.op === 'is_not_empty' ||
            (c.op === 'equals' && c.value === true)
          )
        ) {
          add(field, `"${name}" can only check whether "${target.label}" is ticked or not.`);
        }
        if (c.op !== 'is_empty' && c.op !== 'is_not_empty' && c.value === undefined) {
          add(field, `"${name}" has a rule with no value to compare.`);
        }
      }
    }

    switch (field.type) {
      case 'short_text':
        if (
          field.pattern?.preset === 'custom' &&
          !(field.pattern.regex && isSafePattern(field.pattern.regex))
        ) {
          add(
            field,
            `"${name}" has a custom format that is invalid or too slow to check. Simplify it.`,
          );
        }
        bounds(field, field.minLength, field.maxLength, 'length');
        break;
      case 'long_text':
        bounds(field, field.minLength, field.maxLength, 'length');
        break;
      case 'number':
      case 'percentage':
      case 'currency':
        bounds(field, field.min, field.max, 'value');
        if (
          field.type === 'currency' &&
          field.defaultCurrency &&
          !field.currencies.includes(field.defaultCurrency)
        ) {
          add(field, `"${name}" defaults to a currency that is not in its list.`);
        }
        break;
      case 'slider':
        if (field.min >= field.max) add(field, `"${name}" needs a minimum below its maximum.`);
        else if (field.step > field.max - field.min)
          add(field, `"${name}" has a step larger than its range.`);
        break;
      case 'multi_select':
      case 'checkboxes':
        bounds(field, field.minSelected, field.maxSelected, 'selection');
        if (field.minSelected !== undefined && field.minSelected > field.options.length) {
          add(field, `"${name}" asks for more picks than it has options.`);
        }
        break;
      case 'dropdown':
      case 'radio':
        if (field.defaultValue && !field.options.some((o) => o.id === field.defaultValue)) {
          add(field, `"${name}" defaults to an option that no longer exists.`);
        }
        break;
      case 'picture_choice':
        if (field.options.some((o) => !o.imageUrl))
          add(field, `Every picture choice in "${name}" needs an image.`);
        break;
      case 'date':
      case 'date_range':
        if (field.minDate && field.maxDate && field.minDate > field.maxDate) {
          add(field, `"${name}" has its earliest date after its latest date.`);
        }
        break;
      case 'time':
        if (field.minTime && field.maxTime && field.minTime > field.maxTime) {
          add(field, `"${name}" has its earliest time after its latest time.`);
        }
        break;
      case 'repeater':
        if (field.minItems !== undefined && field.minItems > field.maxItems) {
          add(field, `"${name}" needs at least as many allowed entries as required ones.`);
        }
        field.fields.forEach((child, j) => {
          if (!child.label.trim()) add(field, `Question ${j + 1} inside "${name}" needs a label.`);
          if (
            child.type === 'short_text' &&
            child.pattern?.preset === 'custom' &&
            !(child.pattern.regex && isSafePattern(child.pattern.regex))
          ) {
            add(
              field,
              `"${child.label || `Question ${j + 1}`}" inside "${name}" has a custom format that is invalid or too slow to check.`,
            );
          }
        });
        break;
      case 'hidden':
        if (params.has(field.paramName))
          add(field, `Two hidden fields read the same link parameter "${field.paramName}".`);
        params.add(field.paramName);
        break;
      case 'calculated':
        try {
          const refs = expressionRefs(parseExpression(field.expression));
          for (const ref of refs) {
            const target = earlier.get(ref);
            if (!target)
              add(field, `"${name}" uses {${ref}}, which is missing or comes later in the form.`);
            else if (!NUMERIC.has(target.type))
              add(field, `"${name}" uses "${target.label}", which is not a number question.`);
          }
        } catch (e) {
          if (!(e instanceof ExpressionError)) throw e;
          add(field, `"${name}" has a formula problem: ${e.message}.`);
        }
        break;
      default:
        break;
    }

    earlier.set(field.id, field);
  });

  function bounds(
    field: FormField,
    min: number | undefined,
    max: number | undefined,
    what: string,
  ): void {
    if (min !== undefined && max !== undefined && min > max) {
      add(
        field,
        `"${field.label.trim() || 'A question'}" has a minimum ${what} above its maximum.`,
      );
    }
  }

  return issues;
}
