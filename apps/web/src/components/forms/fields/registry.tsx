import type { ComponentType } from 'react';
import type { FormInputType } from '@botss/shared-types';

import { AddressField } from './address-field';
import { AudioRecordingField } from './audio-recording-field';
import { CalculatedField } from './calculated-field';
import { CheckboxesField } from './checkboxes-field';
import { ColorField } from './color-field';
import { ConsentField } from './consent-field';
import { CountryField } from './country-field';
import { CrmPickerField } from './crm-picker-field';
import { CurrencyField } from './currency-field';
import { DateField } from './date-field';
import { DateRangeField } from './date-range-field';
import { DatetimeField } from './datetime-field';
import { DropdownField } from './dropdown-field';
import { DurationField } from './duration-field';
import { EmailField } from './email-field';
import { EmojiRatingField } from './emoji-rating-field';
import { FileUploadField } from './file-upload-field';
import { FullNameField } from './full-name-field';
import { ImageUploadField } from './image-upload-field';
import { LinearScaleField } from './linear-scale-field';
import { LocationField } from './location-field';
import { LongTextField } from './long-text-field';
import { MatrixField } from './matrix-field';
import { MonthField } from './month-field';
import { MultiSelectField } from './multi-select-field';
import { NumberField } from './number-field';
import { PercentageField } from './percentage-field';
import { PhoneField } from './phone-field';
import { PictureChoiceField } from './picture-choice-field';
import { RadioField } from './radio-field';
import { RankingField } from './ranking-field';
import { RepeaterField } from './repeater-field';
import { RichTextField } from './rich-text-field';
import { ShortTextField } from './short-text-field';
import { SignatureField } from './signature-field';
import { SliderField } from './slider-field';
import { StarRatingField } from './star-rating-field';
import { TagsField } from './tags-field';
import { TimeField } from './time-field';
import { TimezoneField } from './timezone-field';
import type { FieldProps } from './types';
import { UrlField } from './url-field';
import { VideoRecordingField } from './video-recording-field';
import { YesNoField } from './yes-no-field';

export interface FieldEntry {
  // `any` on purpose: each component is typed to its own field type and the
  // renderer passes the matching field, so the union is widened here.
  component: ComponentType<FieldProps<any>>;
  /** Several inputs answer one question: wrap in <fieldset>/<legend>. */
  group?: boolean;
  /** The component renders its own label (e.g. the consent checkbox). */
  ownLabel?: boolean;
}

/** Every visible input type. `hidden` never renders. */
export const FIELD_COMPONENTS: Record<Exclude<FormInputType, 'hidden'>, FieldEntry> = {
  short_text: { component: ShortTextField },
  long_text: { component: LongTextField },
  rich_text: { component: RichTextField },
  email: { component: EmailField },
  phone: { component: PhoneField },
  number: { component: NumberField },
  percentage: { component: PercentageField },
  currency: { component: CurrencyField },
  url: { component: UrlField },
  dropdown: { component: DropdownField },
  multi_select: { component: MultiSelectField },
  radio: { component: RadioField, group: true },
  checkboxes: { component: CheckboxesField, group: true },
  picture_choice: { component: PictureChoiceField, group: true },
  yes_no: { component: YesNoField, group: true },
  consent: { component: ConsentField, ownLabel: true },
  tags: { component: TagsField },
  date: { component: DateField },
  time: { component: TimeField },
  datetime: { component: DatetimeField },
  date_range: { component: DateRangeField, group: true },
  month: { component: MonthField },
  duration: { component: DurationField, group: true },
  timezone: { component: TimezoneField },
  star_rating: { component: StarRatingField, group: true },
  emoji_rating: { component: EmojiRatingField, group: true },
  linear_scale: { component: LinearScaleField, group: true },
  slider: { component: SliderField },
  matrix: { component: MatrixField, group: true },
  ranking: { component: RankingField, group: true },
  full_name: { component: FullNameField, group: true },
  address: { component: AddressField, group: true },
  country: { component: CountryField },
  location: { component: LocationField, group: true },
  file_upload: { component: FileUploadField },
  image_upload: { component: ImageUploadField },
  signature: { component: SignatureField },
  audio_recording: { component: AudioRecordingField },
  video_recording: { component: VideoRecordingField },
  color: { component: ColorField },
  calculated: { component: CalculatedField },
  repeater: { component: RepeaterField, group: true },
  crm_picker: { component: CrmPickerField },
};
