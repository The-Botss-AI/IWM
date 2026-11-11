import {
  AlignLeft,
  Banknote,
  Calculator,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Clock,
  Contact,
  EyeOff,
  FileText,
  FileUp,
  Flag,
  Gauge,
  Globe,
  Grid3x3,
  Hash,
  Heading,
  Image,
  ImagePlus,
  Link,
  ListChecks,
  ListOrdered,
  Mail,
  MapPin,
  Mic,
  Minus,
  Palette,
  PenLine,
  Percent,
  Phone,
  Repeat,
  ScrollText,
  SeparatorHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  Star,
  Tags,
  Text,
  Timer,
  ToggleLeft,
  Type,
  User,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { FormFieldInput, FormFieldType } from '@botss/shared-types';

export type FieldGroup =
  | 'Text'
  | 'Choice'
  | 'Date and time'
  | 'Scales'
  | 'Structured'
  | 'Files and media'
  | 'Other'
  | 'Advanced'
  | 'Layout';

/** Schema-valid stand-in link for a new media block until the person sets a real one. */
export const MEDIA_PLACEHOLDER_URL = 'https://example.com/image.png';
/** DOM id of the media link input, so the builder can focus it right after the block is added. */
export const MEDIA_URL_INPUT_ID = 'form-media-url';

export function isPlaceholderMediaUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'example.com';
  } catch {
    return false;
  }
}

export const FIELD_GROUPS: readonly FieldGroup[] = [
  'Text',
  'Choice',
  'Date and time',
  'Scales',
  'Structured',
  'Files and media',
  'Other',
  'Advanced',
  'Layout',
];

export interface FieldCatalogEntry {
  type: FormFieldType;
  label: string;
  group: FieldGroup;
  icon: LucideIcon;
  /** One line for the palette tooltip. */
  hint: string;
  /** A new field of this type with sensible defaults. */
  create: (id: string) => FormFieldInput;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Short random key for a field or option id (matches `formKeySchema`). */
export function newKey(prefix = 'f'): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

const opts = (...labels: string[]) => labels.map((label) => ({ id: newKey('o'), label }));

export const FIELD_CATALOG: readonly FieldCatalogEntry[] = [
  // Text
  {
    type: 'short_text',
    label: 'Short text',
    group: 'Text',
    icon: Type,
    hint: 'One line of text',
    create: (id) => ({ id, type: 'short_text', label: 'Short answer' }),
  },
  {
    type: 'long_text',
    label: 'Long text',
    group: 'Text',
    icon: AlignLeft,
    hint: 'A paragraph',
    create: (id) => ({ id, type: 'long_text', label: 'Long answer' }),
  },
  {
    type: 'rich_text',
    label: 'Rich text',
    group: 'Text',
    icon: FileText,
    hint: 'Formatted text with bold, lists and links',
    create: (id) => ({ id, type: 'rich_text', label: 'Formatted answer' }),
  },
  {
    type: 'email',
    label: 'Email',
    group: 'Text',
    icon: Mail,
    hint: 'A checked email address',
    create: (id) => ({ id, type: 'email', label: 'Email' }),
  },
  {
    type: 'phone',
    label: 'Phone',
    group: 'Text',
    icon: Phone,
    hint: 'Phone number with country code',
    create: (id) => ({ id, type: 'phone', label: 'Phone number', defaultCountry: 'PK' }),
  },
  {
    type: 'number',
    label: 'Number',
    group: 'Text',
    icon: Hash,
    hint: 'A number with optional limits',
    create: (id) => ({ id, type: 'number', label: 'Number' }),
  },
  {
    type: 'percentage',
    label: 'Percentage',
    group: 'Text',
    icon: Percent,
    hint: 'A percentage',
    create: (id) => ({ id, type: 'percentage', label: 'Percentage', min: 0, max: 100 }),
  },
  {
    type: 'currency',
    label: 'Currency',
    group: 'Text',
    icon: Banknote,
    hint: 'An amount and its currency',
    create: (id) => ({
      id,
      type: 'currency',
      label: 'Amount',
      currencies: ['PKR', 'AED', 'TRY', 'USD'],
      defaultCurrency: 'USD',
    }),
  },
  {
    type: 'url',
    label: 'Website link',
    group: 'Text',
    icon: Link,
    hint: 'A web address',
    create: (id) => ({ id, type: 'url', label: 'Website' }),
  },
  // Choice
  {
    type: 'dropdown',
    label: 'Dropdown',
    group: 'Choice',
    icon: ChevronDown,
    hint: 'Pick one from a list, with search',
    create: (id) => ({
      id,
      type: 'dropdown',
      label: 'Pick one',
      options: opts('Option 1', 'Option 2', 'Option 3'),
    }),
  },
  {
    type: 'multi_select',
    label: 'Multi-select',
    group: 'Choice',
    icon: ListChecks,
    hint: 'Pick several from a list',
    create: (id) => ({
      id,
      type: 'multi_select',
      label: 'Pick any',
      options: opts('Option 1', 'Option 2', 'Option 3'),
    }),
  },
  {
    type: 'radio',
    label: 'Radio buttons',
    group: 'Choice',
    icon: CircleDot,
    hint: 'Pick one, all options shown',
    create: (id) => ({
      id,
      type: 'radio',
      label: 'Pick one',
      options: opts('Option 1', 'Option 2'),
    }),
  },
  {
    type: 'checkboxes',
    label: 'Checkboxes',
    group: 'Choice',
    icon: CheckSquare,
    hint: 'Pick several, all options shown',
    create: (id) => ({
      id,
      type: 'checkboxes',
      label: 'Pick any',
      options: opts('Option 1', 'Option 2'),
    }),
  },
  {
    type: 'picture_choice',
    label: 'Picture choice',
    group: 'Choice',
    icon: Image,
    hint: 'Options shown as images',
    create: (id) => ({
      id,
      type: 'picture_choice',
      label: 'Pick a picture',
      options: opts('Option 1', 'Option 2'),
    }),
  },
  {
    type: 'yes_no',
    label: 'Yes / No',
    group: 'Choice',
    icon: ToggleLeft,
    hint: 'A yes or no question',
    create: (id) => ({ id, type: 'yes_no', label: 'Yes or no?' }),
  },
  {
    type: 'consent',
    label: 'Consent',
    group: 'Choice',
    icon: ShieldCheck,
    hint: 'A box to tick to agree',
    create: (id) => ({
      id,
      type: 'consent',
      label: 'Consent',
      text: 'I agree to the terms.',
      required: true,
    }),
  },
  {
    type: 'tags',
    label: 'Tags',
    group: 'Choice',
    icon: Tags,
    hint: 'Type words and press Enter',
    create: (id) => ({ id, type: 'tags', label: 'Tags' }),
  },
  // Date and time
  {
    type: 'date',
    label: 'Date',
    group: 'Date and time',
    icon: Calendar,
    hint: 'A calendar date',
    create: (id) => ({ id, type: 'date', label: 'Date' }),
  },
  {
    type: 'time',
    label: 'Time',
    group: 'Date and time',
    icon: Clock,
    hint: 'A time of day',
    create: (id) => ({ id, type: 'time', label: 'Time' }),
  },
  {
    type: 'datetime',
    label: 'Date and time',
    group: 'Date and time',
    icon: CalendarClock,
    hint: 'A date with a time',
    create: (id) => ({ id, type: 'datetime', label: 'Date and time' }),
  },
  {
    type: 'date_range',
    label: 'Date range',
    group: 'Date and time',
    icon: CalendarRange,
    hint: 'A start and end date',
    create: (id) => ({ id, type: 'date_range', label: 'Dates' }),
  },
  {
    type: 'month',
    label: 'Month',
    group: 'Date and time',
    icon: CalendarDays,
    hint: 'A month and year',
    create: (id) => ({ id, type: 'month', label: 'Month' }),
  },
  {
    type: 'duration',
    label: 'Duration',
    group: 'Date and time',
    icon: Timer,
    hint: 'Hours and minutes',
    create: (id) => ({ id, type: 'duration', label: 'How long?' }),
  },
  {
    type: 'timezone',
    label: 'Time zone',
    group: 'Date and time',
    icon: Globe,
    hint: 'A time zone',
    create: (id) => ({ id, type: 'timezone', label: 'Time zone' }),
  },
  // Scales
  {
    type: 'star_rating',
    label: 'Star rating',
    group: 'Scales',
    icon: Star,
    hint: 'Rate with stars',
    create: (id) => ({ id, type: 'star_rating', label: 'Your rating', max: 5 }),
  },
  {
    type: 'emoji_rating',
    label: 'Emoji rating',
    group: 'Scales',
    icon: Smile,
    hint: 'Rate with faces',
    create: (id) => ({ id, type: 'emoji_rating', label: 'How do you feel?', scale: 5 }),
  },
  {
    type: 'linear_scale',
    label: 'Scale / NPS',
    group: 'Scales',
    icon: Gauge,
    hint: 'A numbered scale, like 0 to 10',
    create: (id) => ({
      id,
      type: 'linear_scale',
      label: 'How likely are you to recommend us?',
      min: 0,
      max: 10,
      minLabel: 'Not likely',
      maxLabel: 'Very likely',
    }),
  },
  {
    type: 'slider',
    label: 'Slider',
    group: 'Scales',
    icon: SlidersHorizontal,
    hint: 'Pick a value on a range',
    create: (id) => ({ id, type: 'slider', label: 'Pick a value', min: 0, max: 100, step: 1 }),
  },
  {
    type: 'matrix',
    label: 'Matrix grid',
    group: 'Scales',
    icon: Grid3x3,
    hint: 'Rows of questions, columns of answers',
    create: (id) => ({
      id,
      type: 'matrix',
      label: 'Rate each',
      rows: opts('Quality', 'Speed'),
      columns: opts('Poor', 'Fair', 'Good', 'Excellent'),
    }),
  },
  {
    type: 'ranking',
    label: 'Ranking',
    group: 'Scales',
    icon: ListOrdered,
    hint: 'Drag options into order',
    create: (id) => ({
      id,
      type: 'ranking',
      label: 'Put these in order',
      options: opts('First', 'Second', 'Third'),
    }),
  },
  // Structured
  {
    type: 'full_name',
    label: 'Full name',
    group: 'Structured',
    icon: User,
    hint: 'First and last name',
    create: (id) => ({ id, type: 'full_name', label: 'Full name' }),
  },
  {
    type: 'address',
    label: 'Address',
    group: 'Structured',
    icon: Contact,
    hint: 'Street, city and country',
    create: (id) => ({ id, type: 'address', label: 'Address' }),
  },
  {
    type: 'country',
    label: 'Country',
    group: 'Structured',
    icon: Flag,
    hint: 'Pick a country',
    create: (id) => ({ id, type: 'country', label: 'Country' }),
  },
  {
    type: 'location',
    label: 'Location',
    group: 'Structured',
    icon: MapPin,
    hint: 'A pin on a map',
    create: (id) => ({ id, type: 'location', label: 'Location' }),
  },
  // Files and media
  {
    type: 'file_upload',
    label: 'File upload',
    group: 'Files and media',
    icon: FileUp,
    hint: 'Any file, with type and size limits',
    create: (id) => ({
      id,
      type: 'file_upload',
      label: 'Upload a file',
      maxFiles: 1,
      maxSizeMb: 10,
    }),
  },
  {
    type: 'image_upload',
    label: 'Image or photo',
    group: 'Files and media',
    icon: ImagePlus,
    hint: 'Pictures, or the camera on phones',
    create: (id) => ({
      id,
      type: 'image_upload',
      label: 'Upload a photo',
      maxFiles: 1,
      maxSizeMb: 10,
    }),
  },
  {
    type: 'signature',
    label: 'Signature',
    group: 'Files and media',
    icon: PenLine,
    hint: 'Draw a signature',
    create: (id) => ({ id, type: 'signature', label: 'Signature' }),
  },
  {
    type: 'audio_recording',
    label: 'Voice recording',
    group: 'Files and media',
    icon: Mic,
    hint: 'Record from the microphone',
    create: (id) => ({
      id,
      type: 'audio_recording',
      label: 'Record a voice note',
      maxSeconds: 120,
    }),
  },
  {
    type: 'video_recording',
    label: 'Video recording',
    group: 'Files and media',
    icon: Video,
    hint: 'Record from the camera',
    create: (id) => ({ id, type: 'video_recording', label: 'Record a video', maxSeconds: 60 }),
  },
  // Other
  {
    type: 'color',
    label: 'Color picker',
    group: 'Other',
    icon: Palette,
    hint: 'Pick a colour',
    create: (id) => ({ id, type: 'color', label: 'Pick a colour' }),
  },
  // Advanced
  {
    type: 'hidden',
    label: 'Hidden field',
    group: 'Advanced',
    icon: EyeOff,
    hint: 'Filled from the link, like utm_source',
    create: (id) => ({ id, type: 'hidden', label: 'Source', paramName: 'utm_source' }),
  },
  {
    type: 'calculated',
    label: 'Calculated',
    group: 'Advanced',
    icon: Calculator,
    hint: 'A total worked out from other answers',
    create: (id) => ({ id, type: 'calculated', label: 'Total', expression: '0' }),
  },
  {
    type: 'repeater',
    label: 'Repeating group',
    group: 'Advanced',
    icon: Repeat,
    hint: 'Add the same questions several times',
    create: (id) => ({
      id,
      type: 'repeater',
      label: 'People',
      addLabel: 'Add another',
      fields: [{ id: newKey(), type: 'short_text', label: 'Name' }],
    }),
  },
  {
    type: 'crm_picker',
    label: 'CRM picker',
    group: 'Advanced',
    icon: ScrollText,
    hint: 'Pick a member, client, project or lead (in-app only)',
    create: (id) => ({ id, type: 'crm_picker', label: 'Client', entity: 'client' }),
  },
  // Layout
  {
    type: 'heading',
    label: 'Heading',
    group: 'Layout',
    icon: Heading,
    hint: 'A section title',
    create: (id) => ({ id, type: 'heading', label: 'Section title', level: 2 }),
  },
  {
    type: 'paragraph',
    label: 'Text',
    group: 'Layout',
    icon: Text,
    hint: 'Instructions or a description',
    create: (id) => ({ id, type: 'paragraph', label: '', text: 'Write something here.' }),
  },
  {
    type: 'divider',
    label: 'Divider',
    group: 'Layout',
    icon: Minus,
    hint: 'A line between sections',
    create: (id) => ({ id, type: 'divider' }),
  },
  {
    type: 'media',
    label: 'Image or video',
    group: 'Layout',
    icon: Video,
    hint: 'Show an image or a video',
    create: (id) => ({ id, type: 'media', label: '', kind: 'image', url: MEDIA_PLACEHOLDER_URL }),
  },
  {
    type: 'page_break',
    label: 'Page break',
    group: 'Layout',
    icon: SeparatorHorizontal,
    hint: 'Start a new step',
    create: (id) => ({ id, type: 'page_break', label: 'Next step' }),
  },
];

export const CATALOG_BY_TYPE: ReadonlyMap<FormFieldType, FieldCatalogEntry> = new Map(
  FIELD_CATALOG.map((e) => [e.type, e]),
);
