import type { FormField, FormRepeaterChild } from '@botss/shared-types';

import { countryName } from './reference.js';
import { OTHER_PREFIX } from './validate.js';

export interface AnswerTextOptions {
  /** File name for an upload id (responses view, CSV). */
  uploadName?: (uploadId: string) => string | undefined;
  /** Display name for a CRM id. */
  crmName?: (entity: string, id: string) => string | undefined;
}

type AnyField = FormField | FormRepeaterChild;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optionLabel(field: AnyField, id: unknown): string {
  const s = String(id);
  if (s.startsWith(OTHER_PREFIX)) return `Other: ${s.slice(OTHER_PREFIX.length)}`;
  if ('options' in field) return field.options.find((o) => o.id === s)?.label ?? s;
  return s;
}

function richText(node: unknown): string {
  if (!isRecord(node)) return '';
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (node.type === 'hardBreak') return '\n';
  const inner = Array.isArray(node.content) ? node.content.map(richText).join('') : '';
  const block = ['paragraph', 'heading', 'listItem', 'blockquote'].includes(String(node.type));
  return block ? `${inner}\n` : inner;
}

/**
 * One readable line (or a few lines for rich text) for an accepted answer.
 * Used by the responses table, CSV export and notification emails.
 */
export function answerToText(
  field: AnyField,
  value: unknown,
  opts: AnswerTextOptions = {},
): string {
  if (value === undefined || value === null) return '';
  switch (field.type) {
    case 'dropdown':
    case 'radio':
    case 'multi_select':
    case 'checkboxes':
    case 'picture_choice':
      return Array.isArray(value)
        ? value.map((v) => optionLabel(field, v)).join(', ')
        : optionLabel(field, value);
    case 'ranking':
      return Array.isArray(value)
        ? value.map((v, i) => `${i + 1}. ${optionLabel(field, v)}`).join(', ')
        : '';
    case 'yes_no':
      return value === true ? field.yesLabel || 'Yes' : field.noLabel || 'No';
    case 'consent':
      return value === true ? 'Agreed' : 'Not agreed';
    case 'percentage':
      return `${String(value)}%`;
    case 'currency':
      return isRecord(value) ? `${String(value.currency)} ${Number(value.amount).toFixed(2)}` : '';
    case 'duration': {
      const mins = Number(value);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    case 'date_range':
      return isRecord(value) ? `${String(value.start)} to ${String(value.end)}` : '';
    case 'star_rating':
      return `${String(value)} of ${field.max}`;
    case 'emoji_rating':
      return `${String(value)} of ${field.scale}`;
    case 'linear_scale':
      return `${String(value)} (${field.min} to ${field.max})`;
    case 'slider':
      return field.unit ? `${String(value)} ${field.unit}` : String(value);
    case 'matrix':
      if (!isRecord(value)) return '';
      return field.rows
        .filter((r) => value[r.id] !== undefined)
        .map((r) => {
          const cell = value[r.id];
          const cols = (Array.isArray(cell) ? cell : [cell]).map(
            (c) => field.columns.find((col) => col.id === c)?.label ?? String(c),
          );
          return `${r.label}: ${cols.join(', ')}`;
        })
        .join('; ');
    case 'full_name':
      return isRecord(value)
        ? [value.first, value.middle, value.last].filter(Boolean).map(String).join(' ')
        : '';
    case 'address':
      if (!isRecord(value)) return '';
      return [
        value.line1,
        value.line2,
        value.city,
        value.state,
        value.postalCode,
        value.country ? countryName(String(value.country)) : '',
      ]
        .filter(Boolean)
        .map(String)
        .join(', ');
    case 'country':
      return `${countryName(String(value))} (${String(value)})`;
    case 'location':
      if (!isRecord(value)) return '';
      return `${String(value.lat)}, ${String(value.lng)}${value.label ? ` (${String(value.label)})` : ''}`;
    case 'file_upload':
    case 'image_upload':
    case 'signature':
    case 'audio_recording':
    case 'video_recording':
      return (Array.isArray(value) ? value : [value])
        .map((id) => opts.uploadName?.(String(id)) ?? String(id))
        .join(', ');
    case 'crm_picker':
      return (Array.isArray(value) ? value : [value])
        .map((id) => opts.crmName?.(field.entity, String(id)) ?? String(id))
        .join(', ');
    case 'rich_text':
      return richText(value).trim();
    case 'calculated': {
      const n = typeof value === 'number' ? value.toFixed(field.decimals) : String(value);
      return `${field.prefix ?? ''}${n}${field.suffix ?? ''}`;
    }
    case 'repeater':
      if (!Array.isArray(value)) return '';
      return value
        .map((item, i) => {
          const row = isRecord(item) ? item : {};
          const parts = field.fields
            .filter((c) => row[c.id] !== undefined)
            .map((c) => `${c.label}: ${answerToText(c, row[c.id], opts)}`);
          return `${i + 1}) ${parts.join(', ')}`;
        })
        .join('; ');
    case 'tags':
      return Array.isArray(value) ? value.map(String).join(', ') : String(value);
    default:
      if (Array.isArray(value)) return value.map(String).join(', ');
      if (isRecord(value)) return JSON.stringify(value);
      return String(value);
  }
}

/**
 * Makes a value safe for a CSV cell opened in a spreadsheet: neutralises
 * formula triggers (= + - @ tab CR) and quotes the cell.
 */
export function csvCell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
