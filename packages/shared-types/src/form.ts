import { z } from 'zod';

import { cuid } from './common/id.js';
import { paginationQuerySchema, paginationMetaSchema } from './common/pagination.js';
import { FormInternalAccess, FormStatus, FormSubmissionSource } from './enums.js';

/* eslint-disable @typescript-eslint/no-redeclare -- value/type pairs share names by design */

// ============================================================================
// Form builder (2026-11). Separate from TaskForm (project intake).
//
// A form definition is an ordered list of fields. Input fields collect an
// answer keyed by their `id`; layout fields (heading, paragraph, divider,
// media, page break) only display. Structural rules live here; cross-field
// checks (logic and formula references, safe patterns) live in @botss/forms
// `checkDefinition`, which publish runs.
// ============================================================================

/** Hard caps. The API and the builder both read these. */
export const FORM_LIMITS = {
  maxFields: 200,
  maxOptions: 500,
  maxLogicConditions: 20,
  maxRepeaterFields: 20,
  maxRepeaterItems: 50,
  maxMatrixRows: 50,
  maxMatrixColumns: 20,
  maxUploadFiles: 10,
  maxTags: 50,
  /** Text fields with a pattern are capped at this length (ReDoS guard). */
  maxPatternInputLength: 500,
  maxShortText: 1000,
  maxLongText: 10000,
  maxRichTextJsonBytes: 50000,
  maxRecordingSeconds: 600,
  maxAnswerKeys: 250,
} as const;

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Names an object already has (`constructor`, `toString`, `__proto__`...).
 * Ids and link parameters become object keys, so these are refused outright.
 */
function isReservedKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key in Object.prototype;
}

/** Field / option ids are short client-generated keys, stable across edits. */
export const formKeySchema = z
  .string()
  .regex(ID_RE, 'Use letters, digits, - or _ (max 40)')
  .refine((k) => !isReservedKey(k), 'This name is reserved. Pick another.');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB');
const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Expected a 3 letter currency code');
const countryCode = z.string().regex(/^[A-Z]{2}$/, 'Expected a 2 letter country code');
const httpUrl = z
  .string()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Use an http or https link');

// ─── Field types ────────────────────────────────────────────────────────────

export const FORM_INPUT_TYPES = [
  // Text
  'short_text',
  'long_text',
  'rich_text',
  'email',
  'phone',
  'number',
  'percentage',
  'currency',
  'url',
  // Choice
  'dropdown',
  'multi_select',
  'radio',
  'checkboxes',
  'picture_choice',
  'yes_no',
  'consent',
  'tags',
  // Date and time
  'date',
  'time',
  'datetime',
  'date_range',
  'month',
  'duration',
  'timezone',
  // Scales
  'star_rating',
  'emoji_rating',
  'linear_scale',
  'slider',
  'matrix',
  'ranking',
  // Structured
  'full_name',
  'address',
  'country',
  'location',
  // Media and files
  'file_upload',
  'image_upload',
  'signature',
  'audio_recording',
  'video_recording',
  // Other
  'color',
  // Advanced
  'hidden',
  'calculated',
  'repeater',
  'crm_picker',
] as const;

export const FORM_LAYOUT_TYPES = [
  'heading',
  'paragraph',
  'divider',
  'media',
  'page_break',
] as const;

export const FormFieldType = z.enum([...FORM_INPUT_TYPES, ...FORM_LAYOUT_TYPES]);
export type FormFieldType = z.infer<typeof FormFieldType>;
export type FormInputType = (typeof FORM_INPUT_TYPES)[number];
export type FormLayoutType = (typeof FORM_LAYOUT_TYPES)[number];

/** Answers that are FormUpload ids. */
export const FORM_UPLOAD_TYPES = [
  'file_upload',
  'image_upload',
  'signature',
  'audio_recording',
  'video_recording',
] as const satisfies readonly FormInputType[];
export type FormUploadFieldType = (typeof FORM_UPLOAD_TYPES)[number];

/** Field types allowed inside a repeating group. */
export const FORM_REPEATER_CHILD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'percentage',
  'currency',
  'url',
  'dropdown',
  'multi_select',
  'radio',
  'checkboxes',
  'yes_no',
  'date',
  'time',
  'datetime',
  'month',
  'country',
  'color',
  'star_rating',
] as const satisfies readonly FormInputType[];

/** Types whose answer is a number, usable in calculated-field formulas and gt/lt logic. */
export const FORM_NUMERIC_TYPES = [
  'number',
  'percentage',
  'currency',
  'slider',
  'star_rating',
  'emoji_rating',
  'linear_scale',
  'duration',
  'calculated',
] as const satisfies readonly FormInputType[];

// ─── Shared pieces ──────────────────────────────────────────────────────────

export const formOptionSchema = z.object({
  id: formKeySchema,
  label: z.string().min(1).max(300),
  /** Picture choice only. */
  imageUrl: httpUrl.optional(),
});
export type FormOption = z.infer<typeof formOptionSchema>;

const options = z.array(formOptionSchema).min(1).max(FORM_LIMITS.maxOptions);

export const FormLogicOperator = z.enum([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'gt',
  'lt',
  'is_empty',
  'is_not_empty',
]);
export type FormLogicOperator = z.infer<typeof FormLogicOperator>;

export const formLogicConditionSchema = z.object({
  fieldId: formKeySchema,
  op: FormLogicOperator,
  /** Option id, text, number or boolean to compare against; unused for the empty checks. */
  value: z.union([z.string().max(300), z.number(), z.boolean()]).optional(),
});
export type FormLogicCondition = z.infer<typeof formLogicConditionSchema>;

export const formFieldLogicSchema = z.object({
  action: z.enum(['show', 'hide']),
  match: z.enum(['all', 'any']),
  conditions: z.array(formLogicConditionSchema).min(1).max(FORM_LIMITS.maxLogicConditions),
});
export type FormFieldLogic = z.infer<typeof formFieldLogicSchema>;

export const FormPatternPreset = z.enum(['letters', 'digits', 'alphanumeric', 'custom']);
export type FormPatternPreset = z.infer<typeof FormPatternPreset>;

export const formPatternSchema = z.object({
  preset: FormPatternPreset,
  /** Only for `custom`. Checked for catastrophic backtracking at publish. */
  regex: z.string().min(1).max(200).optional(),
  message: z.string().max(200).optional(),
});
export type FormPattern = z.infer<typeof formPatternSchema>;

const base = {
  id: formKeySchema,
  label: z.string().max(300).default(''),
  helpText: z.string().max(1000).optional(),
  logic: formFieldLogicSchema.optional(),
};

const input = {
  ...base,
  placeholder: z.string().max(200).optional(),
  required: z.boolean().default(false),
  /** Overrides the default "required" / format error text. */
  errorMessage: z.string().max(200).optional(),
};

const lengthBounds = {
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
};

const numberBounds = {
  min: z.number().optional(),
  max: z.number().optional(),
  decimals: z.number().int().min(0).max(6).optional(),
};

const selectBounds = {
  minSelected: z.number().int().min(0).optional(),
  maxSelected: z.number().int().min(1).optional(),
};

const uploadConfig = {
  maxFiles: z.number().int().min(1).max(FORM_LIMITS.maxUploadFiles).default(1),
  maxSizeMb: z.number().int().min(1).max(100).default(10),
};

// ─── Input fields ───────────────────────────────────────────────────────────

const shortText = z.object({
  ...input,
  type: z.literal('short_text'),
  ...lengthBounds,
  pattern: formPatternSchema.optional(),
  defaultValue: z.string().max(FORM_LIMITS.maxShortText).optional(),
});
const longText = z.object({
  ...input,
  type: z.literal('long_text'),
  ...lengthBounds,
  defaultValue: z.string().max(FORM_LIMITS.maxLongText).optional(),
});
const richText = z.object({
  ...input,
  type: z.literal('rich_text'),
  /** Plain-text length cap. */
  maxLength: z.number().int().min(1).optional(),
});
const email = z.object({
  ...input,
  type: z.literal('email'),
  defaultValue: z.string().max(320).optional(),
});
const phone = z.object({
  ...input,
  type: z.literal('phone'),
  defaultCountry: countryCode.optional(),
});
const number = z.object({
  ...input,
  type: z.literal('number'),
  ...numberBounds,
  defaultValue: z.number().optional(),
});
const percentage = z.object({
  ...input,
  type: z.literal('percentage'),
  ...numberBounds,
  defaultValue: z.number().optional(),
});
const currency = z.object({
  ...input,
  type: z.literal('currency'),
  currencies: z.array(currencyCode).min(1).max(30).default(['USD']),
  defaultCurrency: currencyCode.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});
const url = z.object({
  ...input,
  type: z.literal('url'),
  defaultValue: z.string().max(2000).optional(),
});

const dropdown = z.object({
  ...input,
  type: z.literal('dropdown'),
  options,
  /** Adds an "Other" choice with a text box. */
  allowOther: z.boolean().optional(),
  defaultValue: formKeySchema.optional(),
});
const multiSelect = z.object({
  ...input,
  type: z.literal('multi_select'),
  options,
  ...selectBounds,
});
const radio = z.object({
  ...input,
  type: z.literal('radio'),
  options,
  allowOther: z.boolean().optional(),
  defaultValue: formKeySchema.optional(),
});
const checkboxes = z.object({
  ...input,
  type: z.literal('checkboxes'),
  options,
  ...selectBounds,
  allowOther: z.boolean().optional(),
});
const pictureChoice = z.object({
  ...input,
  type: z.literal('picture_choice'),
  options,
  multiple: z.boolean().default(false),
});
const yesNo = z.object({
  ...input,
  type: z.literal('yes_no'),
  yesLabel: z.string().max(40).optional(),
  noLabel: z.string().max(40).optional(),
  defaultValue: z.boolean().optional(),
});
const consent = z.object({
  ...input,
  type: z.literal('consent'),
  /** The statement the person agrees to. Required consent must be ticked. */
  text: z.string().min(1).max(2000),
  linkUrl: httpUrl.optional(),
  linkLabel: z.string().max(80).optional(),
});
const tags = z.object({
  ...input,
  type: z.literal('tags'),
  maxTags: z.number().int().min(1).max(FORM_LIMITS.maxTags).optional(),
});

const date = z.object({
  ...input,
  type: z.literal('date'),
  minDate: isoDate.optional(),
  maxDate: isoDate.optional(),
});
const time = z.object({
  ...input,
  type: z.literal('time'),
  minTime: isoTime.optional(),
  maxTime: isoTime.optional(),
});
const datetime = z.object({ ...input, type: z.literal('datetime') });
const dateRange = z.object({
  ...input,
  type: z.literal('date_range'),
  minDate: isoDate.optional(),
  maxDate: isoDate.optional(),
});
const month = z.object({ ...input, type: z.literal('month') });
const duration = z.object({
  ...input,
  type: z.literal('duration'),
  /** Upper bound in minutes. */
  maxMinutes: z.number().int().min(1).max(100000).optional(),
});
const timezone = z.object({ ...input, type: z.literal('timezone') });

const starRating = z.object({
  ...input,
  type: z.literal('star_rating'),
  max: z.number().int().min(3).max(10).default(5),
});
const emojiRating = z.object({
  ...input,
  type: z.literal('emoji_rating'),
  scale: z.union([z.literal(3), z.literal(5)]).default(5),
});
const linearScale = z.object({
  ...input,
  type: z.literal('linear_scale'),
  /** 0..10 with min 0 is an NPS question. */
  min: z.union([z.literal(0), z.literal(1)]).default(1),
  max: z.number().int().min(2).max(10).default(5),
  minLabel: z.string().max(60).optional(),
  maxLabel: z.string().max(60).optional(),
});
const slider = z.object({
  ...input,
  type: z.literal('slider'),
  min: z.number().default(0),
  max: z.number().default(100),
  step: z.number().positive().default(1),
  unit: z.string().max(20).optional(),
  defaultValue: z.number().optional(),
});
const matrix = z.object({
  ...input,
  type: z.literal('matrix'),
  rows: z.array(formOptionSchema).min(1).max(FORM_LIMITS.maxMatrixRows),
  columns: z.array(formOptionSchema).min(1).max(FORM_LIMITS.maxMatrixColumns),
  /** One answer per row (radio) or several (checkbox). Required = every row answered. */
  multiple: z.boolean().default(false),
});
const ranking = z.object({ ...input, type: z.literal('ranking'), options });

const fullName = z.object({
  ...input,
  type: z.literal('full_name'),
  includeMiddle: z.boolean().default(false),
});
const address = z.object({
  ...input,
  type: z.literal('address'),
  includeLine2: z.boolean().default(true),
  defaultCountry: countryCode.optional(),
});
const country = z.object({
  ...input,
  type: z.literal('country'),
  defaultValue: countryCode.optional(),
});
const location = z.object({ ...input, type: z.literal('location') });

const fileUpload = z.object({
  ...input,
  type: z.literal('file_upload'),
  ...uploadConfig,
  /** MIME types or wildcards (`image/*`). Empty = any type. */
  accept: z.array(z.string().max(100)).max(30).default([]),
});
const imageUpload = z.object({
  ...input,
  type: z.literal('image_upload'),
  ...uploadConfig,
  /** On phones, offer the camera directly. */
  allowCamera: z.boolean().default(true),
});
const signature = z.object({ ...input, type: z.literal('signature') });
const audioRecording = z.object({
  ...input,
  type: z.literal('audio_recording'),
  maxSeconds: z.number().int().min(5).max(FORM_LIMITS.maxRecordingSeconds).default(120),
});
const videoRecording = z.object({
  ...input,
  type: z.literal('video_recording'),
  maxSeconds: z.number().int().min(5).max(FORM_LIMITS.maxRecordingSeconds).default(60),
});

const color = z.object({
  ...input,
  type: z.literal('color'),
  presets: z.array(hexColor).max(24).optional(),
  defaultValue: hexColor.optional(),
});

const hidden = z.object({
  ...base,
  type: z.literal('hidden'),
  /** URL query parameter that fills this field, e.g. `utm_source`. */
  paramName: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,60}$/)
    .refine((k) => !isReservedKey(k), 'This name is reserved. Pick another.'),
  defaultValue: z.string().max(500).optional(),
});
const calculated = z.object({
  ...base,
  type: z.literal('calculated'),
  /** Arithmetic over other fields: `{price} * {qty} + 5`. Recomputed by the server. */
  expression: z.string().min(1).max(500),
  decimals: z.number().int().min(0).max(6).default(2),
  prefix: z.string().max(10).optional(),
  suffix: z.string().max(10).optional(),
});
const crmPicker = z.object({
  ...input,
  type: z.literal('crm_picker'),
  entity: z.enum(['member', 'client', 'project', 'lead']),
  multiple: z.boolean().default(false),
});

/** Fields allowed inside a repeating group (no logic, uploads or nesting). */
export const formRepeaterChildSchema = z.discriminatedUnion('type', [
  shortText.omit({ logic: true }),
  longText.omit({ logic: true }),
  email.omit({ logic: true }),
  phone.omit({ logic: true }),
  number.omit({ logic: true }),
  percentage.omit({ logic: true }),
  currency.omit({ logic: true }),
  url.omit({ logic: true }),
  dropdown.omit({ logic: true }),
  multiSelect.omit({ logic: true }),
  radio.omit({ logic: true }),
  checkboxes.omit({ logic: true }),
  yesNo.omit({ logic: true }),
  date.omit({ logic: true }),
  time.omit({ logic: true }),
  datetime.omit({ logic: true }),
  month.omit({ logic: true }),
  country.omit({ logic: true }),
  color.omit({ logic: true }),
  starRating.omit({ logic: true }),
]);
export type FormRepeaterChild = z.infer<typeof formRepeaterChildSchema>;

const repeater = z.object({
  ...input,
  type: z.literal('repeater'),
  fields: z.array(formRepeaterChildSchema).min(1).max(FORM_LIMITS.maxRepeaterFields),
  minItems: z.number().int().min(0).optional(),
  maxItems: z.number().int().min(1).max(FORM_LIMITS.maxRepeaterItems).default(10),
  /** Button text, e.g. "Add another person". */
  addLabel: z.string().max(60).optional(),
});

// ─── Layout fields ──────────────────────────────────────────────────────────

const heading = z.object({
  ...base,
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
});
const paragraph = z.object({
  ...base,
  type: z.literal('paragraph'),
  text: z.string().max(5000).default(''),
});
const divider = z.object({ ...base, type: z.literal('divider') });
const media = z.object({
  ...base,
  type: z.literal('media'),
  kind: z.enum(['image', 'video']),
  url: httpUrl,
  alt: z.string().max(300).optional(),
});
const pageBreak = z.object({
  ...base,
  type: z.literal('page_break'),
  nextLabel: z.string().max(40).optional(),
});

export const formFieldSchema = z.discriminatedUnion('type', [
  shortText,
  longText,
  richText,
  email,
  phone,
  number,
  percentage,
  currency,
  url,
  dropdown,
  multiSelect,
  radio,
  checkboxes,
  pictureChoice,
  yesNo,
  consent,
  tags,
  date,
  time,
  datetime,
  dateRange,
  month,
  duration,
  timezone,
  starRating,
  emojiRating,
  linearScale,
  slider,
  matrix,
  ranking,
  fullName,
  address,
  country,
  location,
  fileUpload,
  imageUpload,
  signature,
  audioRecording,
  videoRecording,
  color,
  hidden,
  calculated,
  repeater,
  crmPicker,
  heading,
  paragraph,
  divider,
  media,
  pageBreak,
]);
export type FormField = z.infer<typeof formFieldSchema>;
export type FormFieldInput = z.input<typeof formFieldSchema>;
export type FormFieldOf<T extends FormFieldType> = Extract<FormField, { type: T }>;

export function isFormInputType(type: FormFieldType): type is FormInputType {
  return (FORM_INPUT_TYPES as readonly string[]).includes(type);
}
export function isFormUploadType(type: FormFieldType): type is FormUploadFieldType {
  return (FORM_UPLOAD_TYPES as readonly string[]).includes(type);
}

/**
 * Structural check only: ids unique (fields, options, repeater children).
 * Reference and pattern checks are @botss/forms `checkDefinition`, run on publish.
 */
export const formDefinitionSchema = z
  .object({
    fields: z.array(formFieldSchema).max(FORM_LIMITS.maxFields),
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    def.fields.forEach((f, i) => {
      if (seen.has(f.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate field id "${f.id}"`,
          path: ['fields', i, 'id'],
        });
      }
      seen.add(f.id);
      const lists: Array<[string, readonly { id: string }[]]> = [];
      if ('options' in f) lists.push(['options', f.options]);
      if (f.type === 'matrix') lists.push(['rows', f.rows], ['columns', f.columns]);
      if (f.type === 'repeater') lists.push(['fields', f.fields]);
      for (const [key, list] of lists) {
        const ids = new Set<string>();
        list.forEach((o, j) => {
          if (ids.has(o.id)) {
            ctx.addIssue({
              code: 'custom',
              message: `Duplicate id "${o.id}"`,
              path: ['fields', i, key, j, 'id'],
            });
          }
          ids.add(o.id);
        });
      }
    });
  });
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormDefinitionInput = z.input<typeof formDefinitionSchema>;

// ─── Form settings ──────────────────────────────────────────────────────────

export const formSettingsSchema = z.object({
  /** Shown after a successful submit. */
  confirmationMessage: z.string().max(2000).optional(),
  /** Sends the person here after submit instead of the confirmation text. */
  redirectUrl: httpUrl.optional(),
  /** Owner gets an in-app notification and an email per response. */
  notifyOnSubmit: z.boolean().default(true),
  submitLabel: z.string().max(40).optional(),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

// ─── Answers ────────────────────────────────────────────────────────────────

/** Stored `FormSubmission.answers`: field id -> JSON value accepted by the validator. */
export const formAnswersSchema = z.record(z.string().max(40), z.json());
export type FormAnswers = z.infer<typeof formAnswersSchema>;

// ─── Entities ───────────────────────────────────────────────────────────────

export const formPersonSchema = z.object({
  id: cuid,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});
export type FormPerson = z.infer<typeof formPersonSchema>;

/** List row. Management fields (`publicToken`, counts) are null for fill-only viewers. */
export const formSummarySchema = z.object({
  id: cuid,
  workspaceId: cuid,
  title: z.string(),
  description: z.string().nullable(),
  status: FormStatus,
  publishedVersion: z.number().int().nonnegative(),
  internalAccess: FormInternalAccess,
  publicEnabled: z.boolean(),
  closesAt: z.coerce.date().nullable(),
  responseLimit: z.number().int().positive().nullable(),
  createdBy: formPersonSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  /** True for the owner and admins: may edit, share and read responses. */
  canManage: z.boolean(),
  /** Null when `canManage` is false. */
  submissionCount: z.number().int().nonnegative().nullable(),
  /** True when the caller may fill it in the app right now. */
  canFill: z.boolean(),
});
export type FormSummary = z.infer<typeof formSummarySchema>;

/** Full form for its managers (builder). */
export const formDetailSchema = formSummarySchema.extend({
  draft: formDefinitionSchema,
  settings: formSettingsSchema,
  publicToken: z.string().nullable(),
  /** True when the draft differs from the published version. */
  hasUnpublishedChanges: z.boolean(),
});
export type FormDetail = z.infer<typeof formDetailSchema>;

export const createFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  draft: formDefinitionSchema.optional(),
  settings: formSettingsSchema.optional(),
  internalAccess: FormInternalAccess.optional(),
  closesAt: z.coerce.date().nullable().optional(),
  responseLimit: z.number().int().positive().max(1000000).nullable().optional(),
});
export type UpdateFormInput = z.infer<typeof updateFormSchema>;

export const FormListScope = z.enum(['mine', 'shared', 'all']);
export type FormListScope = z.infer<typeof FormListScope>;

export const listFormsQuerySchema = paginationQuerySchema.extend({
  scope: FormListScope.default('mine'),
  q: z.string().trim().max(200).optional(),
});
export type ListFormsQuery = z.infer<typeof listFormsQuerySchema>;

export const formListResponseSchema = z.object({
  items: z.array(formSummarySchema),
  pagination: paginationMetaSchema,
});
export type FormListResponse = z.infer<typeof formListResponseSchema>;

/** Publish result, or the problems that block it. */
export const formDefinitionIssueSchema = z.object({
  fieldId: z.string().nullable(),
  message: z.string(),
});
export type FormDefinitionIssue = z.infer<typeof formDefinitionIssueSchema>;

export const setFormPublicLinkSchema = z.object({ enabled: z.boolean() });
export type SetFormPublicLinkInput = z.infer<typeof setFormPublicLinkSchema>;

// ─── Internal access ────────────────────────────────────────────────────────

export const formAccessEntrySchema = z.object({
  user: formPersonSchema,
  createdAt: z.coerce.date(),
});
export type FormAccessEntry = z.infer<typeof formAccessEntrySchema>;

export const addFormAccessSchema = z.object({
  userIds: z.array(cuid).min(1).max(100),
});
export type AddFormAccessInput = z.infer<typeof addFormAccessSchema>;

export const formAccessParamSchema = z.object({ id: cuid, userId: cuid });

// ─── Filling ────────────────────────────────────────────────────────────────

/**
 * What a person filling the form receives (in-app or public). Never carries
 * the workspace, owner, token or response counts.
 */
export const fillableFormSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  version: z.number().int().positive(),
  definition: formDefinitionSchema,
  submitLabel: z.string().nullable(),
  /** False when closed, past its close date or at its response limit. */
  open: z.boolean(),
});
export type FillableForm = z.infer<typeof fillableFormSchema>;

export const submitFormSchema = z.object({
  /** The published version the person filled. */
  version: z.number().int().positive(),
  answers: z
    .record(z.string().max(40), z.unknown())
    .refine((a) => Object.keys(a).length <= FORM_LIMITS.maxAnswerKeys, 'Too many answers'),
  /**
   * Milliseconds from opening the form to submitting, measured in the browser
   * with a monotonic clock (public bot check; never compared with server time).
   */
  fillMs: z
    .number()
    .int()
    .nonnegative()
    .max(7 * 24 * 60 * 60 * 1000)
    .optional(),
  /** Honeypot: must be empty. */
  website: z.string().max(200).optional(),
  /** Cloudflare Turnstile token when the server has Turnstile keys. */
  turnstileToken: z.string().max(4096).optional(),
});
export type SubmitFormInput = z.infer<typeof submitFormSchema>;

export const submitFormResponseSchema = z.object({
  ok: z.literal(true),
  confirmationMessage: z.string().nullable(),
  redirectUrl: z.string().nullable(),
});
export type SubmitFormResponse = z.infer<typeof submitFormResponseSchema>;

/**
 * Field-level problems from a rejected submission or publish, carried in the
 * RFC 7807 problem's `errors` member: field id (repeater rows as
 * `fieldId.index.childId`, form-wide as `form`) -> messages.
 */
export const formFieldErrorsSchema = z.record(z.string(), z.array(z.string()));
export type FormFieldErrors = z.infer<typeof formFieldErrorsSchema>;

export const createFormUploadSchema = z.object({
  version: z.number().int().positive(),
  fieldId: formKeySchema,
  fileName: z.string().trim().min(1).max(200),
  /** A real media type (optionally with parameters, e.g. `audio/webm;codecs=opus`); signed into the upload. */
  mimeType: z
    .string()
    .trim()
    .toLowerCase()
    .max(120)
    .regex(
      /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(;\s*[a-z0-9_.+-]+=[a-z0-9_.+"-]+)*$/,
      'Not a valid file type',
    ),
  sizeBytes: z.number().int().positive(),
});
export type CreateFormUploadInput = z.infer<typeof createFormUploadSchema>;

export const formUploadTicketSchema = z.object({
  uploadId: cuid,
  /** Presigned PUT; send the file body with the returned headers. */
  uploadUrl: z.string().url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.coerce.date(),
});
export type FormUploadTicket = z.infer<typeof formUploadTicketSchema>;

// ─── Responses ──────────────────────────────────────────────────────────────

export const formSubmissionUploadSchema = z.object({
  id: cuid,
  fieldId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  /** BigInt over the wire as a string. */
  sizeBytes: z.string(),
});
export type FormSubmissionUpload = z.infer<typeof formSubmissionUploadSchema>;

export const formSubmissionSchema = z.object({
  id: cuid,
  formId: cuid,
  versionId: cuid,
  version: z.number().int().positive(),
  source: FormSubmissionSource,
  submittedBy: formPersonSchema.nullable(),
  answers: formAnswersSchema,
  uploads: z.array(formSubmissionUploadSchema),
  createdAt: z.coerce.date(),
});
export type FormSubmission = z.infer<typeof formSubmissionSchema>;

export const formVersionSchema = z.object({
  id: cuid,
  version: z.number().int().positive(),
  definition: formDefinitionSchema,
  publishedAt: z.coerce.date(),
});
export type FormVersion = z.infer<typeof formVersionSchema>;

export const listFormSubmissionsQuerySchema = paginationQuerySchema.extend({
  source: FormSubmissionSource.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListFormSubmissionsQuery = z.infer<typeof listFormSubmissionsQuerySchema>;

export const formSubmissionListResponseSchema = z.object({
  items: z.array(formSubmissionSchema),
  pagination: paginationMetaSchema,
  /** Every version referenced on this page, to label old answers. */
  versions: z.array(formVersionSchema),
  /** Display names for CRM picker answers on this page: id -> name. */
  crmLabels: z.record(z.string(), z.string()),
});
export type FormSubmissionListResponse = z.infer<typeof formSubmissionListResponseSchema>;

export const formSubmissionParamSchema = z.object({ id: cuid, submissionId: cuid });
export const formUploadParamSchema = z.object({ id: cuid, submissionId: cuid, uploadId: cuid });

export const formUploadUrlSchema = z.object({
  url: z.string().url(),
  expiresAt: z.coerce.date(),
});
export type FormUploadUrl = z.infer<typeof formUploadUrlSchema>;

/** Public link token: 24 url-safe characters. */
export const formPublicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
export const formPublicTokenParamSchema = z.object({ token: formPublicTokenSchema });
