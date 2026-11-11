import type { FormDefinition } from '@botss/shared-types';

/**
 * Starting answers for a fresh fill: each field's default value, and hidden
 * fields filled from the link's query parameters (`?utm_source=...`).
 */
export function initialAnswers(
  def: FormDefinition,
  params: Readonly<Record<string, string | undefined>> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    switch (f.type) {
      case 'hidden': {
        const fromLink = Object.hasOwn(params, f.paramName) ? params[f.paramName] : undefined;
        const v = typeof fromLink === 'string' ? fromLink : f.defaultValue;
        if (v) out[f.id] = v.slice(0, 500);
        break;
      }
      case 'address':
        if (f.defaultCountry) out[f.id] = { country: f.defaultCountry };
        break;
      case 'short_text':
      case 'long_text':
      case 'email':
      case 'url':
      case 'number':
      case 'percentage':
      case 'slider':
      case 'dropdown':
      case 'radio':
      case 'yes_no':
      case 'country':
      case 'color':
        if (f.defaultValue !== undefined) out[f.id] = f.defaultValue;
        break;
      default:
        break;
    }
  }
  return out;
}
