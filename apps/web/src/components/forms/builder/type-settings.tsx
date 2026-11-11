'use client';

import { Plus, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { FORM_LIMITS, type FormField } from '@botss/shared-types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TagInput } from '@/components/ui/tag-input';
import type { FormBuilderOps } from '@/hooks/use-form-builder';
import { earlierNumericFields, type FieldPatch, type OptionListKey } from '@/lib/forms/builder-ops';
import { MEDIA_URL_INPUT_ID } from '@/lib/forms/field-catalog';

import { CalculatedEditor } from './calculated-editor';
import { CurrencyEditor } from './currency-editor';
import { OptionsEditor } from './options-editor';
import { NumberProp, PropGroup, SelectProp, TextAreaProp, TextProp, ToggleProp } from './props-ui';
import { RepeaterEditor } from './repeater-editor';
import { LengthBounds, NumberBounds, PatternEditor } from './validation-editor';

interface TypeSettingsProps {
  field: FormField;
  allFields: readonly FormField[];
  ops: FormBuilderOps;
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const numOptions = (from: number, to: number) =>
  range(from, to).map((n) => ({ value: String(n), label: String(n) }));

const FILE_ACCEPT_PRESETS = [
  { label: 'Images', value: 'image/*' },
  { label: 'PDF', value: 'application/pdf' },
  { label: 'Video', value: 'video/*' },
  { label: 'Audio', value: 'audio/*' },
] as const;

/** The settings that belong to one field type. Common settings live in FieldProperties. */
export function TypeSettings({ field, allFields, ops }: TypeSettingsProps) {
  const patch = (p: FieldPatch) => ops.updateField(field.id, p);
  const list = (key: OptionListKey) => ({
    onAdd: () => ops.addOption(field.id, key),
    onRename: (id: string, label: string) => ops.renameOption(field.id, key, id, label),
    onRemove: (id: string) => ops.removeOption(field.id, key, id),
    onReorder: (from: number, to: number) => ops.reorderOptions(field.id, key, from, to),
  });

  let body: ReactNode = null;

  switch (field.type) {
    case 'short_text':
      body = (
        <>
          <LengthBounds field={field} onPatch={patch} />
          <PatternEditor field={field} onPatch={patch} />
          <TextProp
            label="Default answer"
            value={field.defaultValue}
            maxLength={FORM_LIMITS.maxShortText}
            onChange={(defaultValue) => patch({ defaultValue })}
          />
        </>
      );
      break;
    case 'long_text':
      body = <LengthBounds field={field} onPatch={patch} />;
      break;
    case 'rich_text':
      body = (
        <NumberProp
          label="Max length (characters)"
          integer
          min={1}
          value={field.maxLength}
          onChange={(maxLength) => patch({ maxLength })}
        />
      );
      break;
    case 'phone':
      body = (
        <TextProp
          label="Default country code"
          value={field.defaultCountry}
          maxLength={2}
          placeholder="PK"
          hint="Two letters, like PK, AE or TR."
          onChange={(v) => patch({ defaultCountry: v ? v.toUpperCase() : undefined })}
        />
      );
      break;
    case 'number':
    case 'percentage':
      body = <NumberBounds field={field} onPatch={patch} />;
      break;
    case 'currency':
      body = (
        <>
          <CurrencyEditor field={field} onPatch={patch} />
          <NumberBounds field={field} onPatch={patch} withDecimals={false} />
        </>
      );
      break;
    case 'dropdown':
    case 'radio':
      body = (
        <>
          <OptionsEditor
            title="Options"
            noun="option"
            items={field.options}
            max={FORM_LIMITS.maxOptions}
            {...list('options')}
          />
          <ToggleProp
            label='Add an "Other" choice with a text box'
            checked={field.allowOther === true}
            onChange={(allowOther) => patch({ allowOther })}
          />
        </>
      );
      break;
    case 'multi_select':
    case 'checkboxes':
      body = (
        <>
          <OptionsEditor
            title="Options"
            noun="option"
            items={field.options}
            max={FORM_LIMITS.maxOptions}
            {...list('options')}
          />
          {field.type === 'checkboxes' ? (
            <ToggleProp
              label='Add an "Other" choice with a text box'
              checked={field.allowOther === true}
              onChange={(allowOther) => patch({ allowOther })}
            />
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <NumberProp
              label="Pick at least"
              integer
              min={0}
              value={field.minSelected}
              onChange={(minSelected) => patch({ minSelected })}
            />
            <NumberProp
              label="Pick at most"
              integer
              min={1}
              value={field.maxSelected}
              onChange={(maxSelected) => patch({ maxSelected })}
            />
          </div>
        </>
      );
      break;
    case 'picture_choice':
      body = (
        <>
          <OptionsEditor
            title="Pictures"
            noun="option"
            items={field.options}
            max={FORM_LIMITS.maxOptions}
            withImages
            onImage={(id, url) => ops.setOptionImage(field.id, id, url)}
            {...list('options')}
          />
          <ToggleProp
            label="Allow picking several"
            checked={field.multiple}
            onChange={(multiple) => patch({ multiple })}
          />
        </>
      );
      break;
    case 'ranking':
      body = (
        <OptionsEditor
          title="Items to rank"
          noun="item"
          items={field.options}
          max={FORM_LIMITS.maxOptions}
          {...list('options')}
        />
      );
      break;
    case 'yes_no':
      body = (
        <div className="grid grid-cols-2 gap-2">
          <TextProp
            label="Yes label"
            value={field.yesLabel}
            maxLength={40}
            placeholder="Yes"
            onChange={(yesLabel) => patch({ yesLabel })}
          />
          <TextProp
            label="No label"
            value={field.noLabel}
            maxLength={40}
            placeholder="No"
            onChange={(noLabel) => patch({ noLabel })}
          />
        </div>
      );
      break;
    case 'consent':
      body = (
        <>
          <TextAreaProp
            label="Consent text"
            value={field.text}
            maxLength={2000}
            onChange={(text) => patch({ text: text ?? '' })}
          />
          <TextProp
            label="Link address"
            value={field.linkUrl}
            maxLength={2000}
            placeholder="https://"
            onChange={(linkUrl) => patch({ linkUrl })}
          />
          <TextProp
            label="Link text"
            value={field.linkLabel}
            maxLength={80}
            placeholder="Read the terms"
            onChange={(linkLabel) => patch({ linkLabel })}
          />
        </>
      );
      break;
    case 'tags':
      body = (
        <NumberProp
          label="Max tags"
          integer
          min={1}
          max={FORM_LIMITS.maxTags}
          value={field.maxTags}
          onChange={(maxTags) => patch({ maxTags })}
        />
      );
      break;
    case 'date':
    case 'date_range':
      body = (
        <div className="grid grid-cols-2 gap-2">
          <DateProp
            label="Earliest date"
            type="date"
            value={field.minDate}
            onChange={(minDate) => patch({ minDate })}
          />
          <DateProp
            label="Latest date"
            type="date"
            value={field.maxDate}
            onChange={(maxDate) => patch({ maxDate })}
          />
        </div>
      );
      break;
    case 'time':
      body = (
        <div className="grid grid-cols-2 gap-2">
          <DateProp
            label="Earliest time"
            type="time"
            value={field.minTime}
            onChange={(minTime) => patch({ minTime })}
          />
          <DateProp
            label="Latest time"
            type="time"
            value={field.maxTime}
            onChange={(maxTime) => patch({ maxTime })}
          />
        </div>
      );
      break;
    case 'duration':
      body = (
        <NumberProp
          label="Longest duration (minutes)"
          integer
          min={1}
          max={100000}
          value={field.maxMinutes}
          onChange={(maxMinutes) => patch({ maxMinutes })}
        />
      );
      break;
    case 'star_rating':
      body = (
        <SelectProp
          label="Number of stars"
          value={String(field.max)}
          options={numOptions(3, 10)}
          onChange={(v) => patch({ max: Number(v) })}
        />
      );
      break;
    case 'emoji_rating':
      body = (
        <SelectProp
          label="Number of faces"
          value={String(field.scale)}
          options={numOptions(3, 5).filter((o) => o.value !== '4')}
          onChange={(v) => patch({ scale: v === '3' ? 3 : 5 })}
        />
      );
      break;
    case 'linear_scale':
      body = (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SelectProp
              label="Starts at"
              value={String(field.min)}
              options={numOptions(0, 1)}
              onChange={(v) => patch({ min: v === '0' ? 0 : 1 })}
            />
            <SelectProp
              label="Ends at"
              value={String(field.max)}
              options={numOptions(2, 10)}
              onChange={(v) => patch({ max: Number(v) })}
            />
          </div>
          <TextProp
            label="Label for the low end"
            value={field.minLabel}
            maxLength={60}
            onChange={(minLabel) => patch({ minLabel })}
          />
          <TextProp
            label="Label for the high end"
            value={field.maxLabel}
            maxLength={60}
            onChange={(maxLabel) => patch({ maxLabel })}
          />
        </>
      );
      break;
    case 'slider':
      body = (
        <>
          <div className="grid grid-cols-3 gap-2">
            <NumberProp
              label="Min"
              value={field.min}
              onChange={(min) => patch({ min: min ?? 0 })}
            />
            <NumberProp
              label="Max"
              value={field.max}
              onChange={(max) => patch({ max: max ?? 100 })}
            />
            <NumberProp
              label="Step"
              value={field.step}
              min={0.000001}
              onChange={(step) => patch({ step: step ?? 1 })}
            />
          </div>
          <TextProp
            label="Unit"
            value={field.unit}
            maxLength={20}
            placeholder="kg"
            onChange={(unit) => patch({ unit })}
          />
        </>
      );
      break;
    case 'matrix':
      body = (
        <>
          <OptionsEditor
            title="Rows"
            noun="row"
            items={field.rows}
            max={FORM_LIMITS.maxMatrixRows}
            {...list('rows')}
          />
          <OptionsEditor
            title="Columns"
            noun="column"
            items={field.columns}
            max={FORM_LIMITS.maxMatrixColumns}
            {...list('columns')}
          />
          <ToggleProp
            label="Allow several answers per row"
            checked={field.multiple}
            onChange={(multiple) => patch({ multiple })}
          />
        </>
      );
      break;
    case 'full_name':
      body = (
        <ToggleProp
          label="Ask for a middle name"
          checked={field.includeMiddle}
          onChange={(includeMiddle) => patch({ includeMiddle })}
        />
      );
      break;
    case 'address':
      body = (
        <>
          <ToggleProp
            label="Include an address line 2"
            checked={field.includeLine2}
            onChange={(includeLine2) => patch({ includeLine2 })}
          />
          <TextProp
            label="Default country code"
            value={field.defaultCountry}
            maxLength={2}
            placeholder="PK"
            onChange={(v) => patch({ defaultCountry: v ? v.toUpperCase() : undefined })}
          />
        </>
      );
      break;
    case 'file_upload':
    case 'image_upload':
      body = (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SelectProp
              label="Max files"
              value={String(field.maxFiles)}
              options={numOptions(1, FORM_LIMITS.maxUploadFiles)}
              onChange={(v) => patch({ maxFiles: Number(v) })}
            />
            <NumberProp
              label="Max size (MB)"
              integer
              min={1}
              max={100}
              value={field.maxSizeMb}
              onChange={(maxSizeMb) => patch({ maxSizeMb: maxSizeMb ?? 10 })}
            />
          </div>
          {field.type === 'file_upload' ? (
            <AcceptEditor accept={field.accept} onChange={(accept) => patch({ accept })} />
          ) : (
            <ToggleProp
              label="Offer the camera on phones"
              checked={field.allowCamera}
              onChange={(allowCamera) => patch({ allowCamera })}
            />
          )}
        </>
      );
      break;
    case 'audio_recording':
    case 'video_recording':
      body = (
        <NumberProp
          label="Longest recording (seconds)"
          integer
          min={5}
          max={FORM_LIMITS.maxRecordingSeconds}
          value={field.maxSeconds}
          onChange={(maxSeconds) => patch({ maxSeconds: maxSeconds ?? 60 })}
        />
      );
      break;
    case 'color':
      body = (
        <ColorPresets
          presets={field.presets ?? []}
          onChange={(presets) => patch({ presets: presets.length ? presets : undefined })}
        />
      );
      break;
    case 'hidden':
      body = (
        <>
          <TextProp
            label="Link parameter name"
            value={field.paramName}
            optional={false}
            maxLength={60}
            hint="Filled from the link, for example ?utm_source=newsletter."
            onChange={(paramName) => patch({ paramName: paramName ?? '' })}
          />
          <TextProp
            label="Default value"
            value={field.defaultValue}
            maxLength={500}
            onChange={(defaultValue) => patch({ defaultValue })}
          />
        </>
      );
      break;
    case 'calculated':
      body = (
        <CalculatedEditor
          field={field}
          earlierNumeric={earlierNumericFields({ fields: [...allFields] }, field.id)}
          allFields={allFields}
          onPatch={patch}
        />
      );
      break;
    case 'repeater':
      body = (
        <RepeaterEditor
          field={field}
          onPatch={patch}
          onAddChild={(type) => ops.addChild(field.id, type)}
          onUpdateChild={(childId, p) => ops.updateChild(field.id, childId, p)}
          onRemoveChild={(childId) => ops.removeChild(field.id, childId)}
          onMoveChild={(from, to) => ops.moveChild(field.id, from, to)}
          onChildOptions={(childId, fn) => ops.updateChildOptions(field.id, childId, fn)}
        />
      );
      break;
    case 'crm_picker':
      body = (
        <>
          <SelectProp
            label="Pick from"
            value={field.entity}
            options={[
              { value: 'member', label: 'Team members' },
              { value: 'client', label: 'Clients' },
              { value: 'project', label: 'Projects' },
              { value: 'lead', label: 'Leads' },
            ]}
            onChange={(entity) => patch({ entity })}
          />
          <ToggleProp
            label="Allow picking several"
            checked={field.multiple}
            onChange={(multiple) => patch({ multiple })}
          />
          <p className="text-ink-muted text-xs">
            Only works for people filling the form inside the app.
          </p>
        </>
      );
      break;
    case 'heading':
      body = (
        <SelectProp
          label="Size"
          value={String(field.level)}
          options={[
            { value: '1', label: 'Large' },
            { value: '2', label: 'Medium' },
            { value: '3', label: 'Small' },
          ]}
          onChange={(v) => patch({ level: v === '1' ? 1 : v === '3' ? 3 : 2 })}
        />
      );
      break;
    case 'paragraph':
      body = (
        <TextAreaProp
          label="Text"
          rows={6}
          value={field.text}
          maxLength={5000}
          onChange={(text) => patch({ text: text ?? '' })}
        />
      );
      break;
    case 'media':
      body = (
        <>
          <SelectProp
            label="Type"
            value={field.kind}
            options={[
              { value: 'image', label: 'Image' },
              { value: 'video', label: 'Video' },
            ]}
            onChange={(kind) => patch({ kind })}
          />
          <TextProp
            label="Link address"
            inputId={MEDIA_URL_INPUT_ID}
            value={field.url}
            optional={false}
            maxLength={2000}
            placeholder="https://"
            onChange={(url) => patch({ url: url ?? '' })}
          />
          <TextProp
            label="Description for screen readers"
            value={field.alt}
            maxLength={300}
            onChange={(alt) => patch({ alt })}
          />
        </>
      );
      break;
    case 'page_break':
      body = (
        <TextProp
          label="Next button text"
          value={field.nextLabel}
          maxLength={40}
          placeholder="Next"
          onChange={(nextLabel) => patch({ nextLabel })}
        />
      );
      break;
    default:
      body = null;
  }

  return body ? <PropGroup title="Settings">{body}</PropGroup> : null;
}

function DateProp({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: 'date' | 'time';
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </div>
  );
}

function AcceptEditor({
  accept,
  onChange,
}: {
  accept: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-ink text-[13px] font-medium">Allowed file types</span>
      <TagInput
        value={accept}
        onChange={onChange}
        placeholder="image/*, .pdf"
        aria-label="Allowed file types"
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick add file types">
        {FILE_ACCEPT_PRESETS.map((p) => (
          <Button
            key={p.value}
            variant="outline"
            size="sm"
            disabled={accept.includes(p.value)}
            aria-label={`Allow ${p.label}`}
            onClick={() => onChange([...accept, p.value])}
          >
            <Plus className="h-3 w-3" aria-hidden /> {p.label}
          </Button>
        ))}
      </div>
      <p className="text-ink-muted text-xs">Leave empty to allow any file.</p>
    </div>
  );
}

function ColorPresets({
  presets,
  onChange,
}: {
  presets: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-ink text-[13px] font-medium">Preset colors</span>
      <ul className="flex flex-wrap gap-2" role="list">
        {presets.map((c, i) => (
          <li key={i} className="border-line flex items-center gap-1 rounded-md border p-1">
            <input
              type="color"
              value={c}
              aria-label={`Preset color ${i + 1}`}
              className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
              onChange={(e) => onChange(presets.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              aria-label={`Remove preset color ${i + 1}`}
              className="text-ink-muted hover:bg-bg-subtle focus-visible:shadow-focus rounded p-1 focus-visible:outline-none"
              onClick={() => onChange(presets.filter((_, j) => j !== i))}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        disabled={presets.length >= 24}
        aria-label="Add a preset color"
        onClick={() => onChange([...presets, '#6366f1'])}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add color
      </Button>
    </div>
  );
}
