'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** Small labelled controls shared by the property editors. */

export function PropGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-line space-y-3 border-b pb-4 last:border-b-0">
      {title ? (
        <h3 className="text-ink-muted text-xs font-semibold uppercase tracking-wide">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}

export function PropRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-ink-muted text-xs">{hint}</p> : null}
    </div>
  );
}

export function TextProp({
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength,
  optional = true,
  inputId,
}: {
  label: string;
  /** Fixed DOM id, for code that needs to focus the input. */
  inputId?: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  /** When true an empty box clears the property. */
  optional?: boolean;
}) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  return (
    <PropRow label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <Input
        id={id}
        value={value ?? ''}
        {...(placeholder ? { placeholder } : {})}
        {...(maxLength ? { maxLength } : {})}
        onChange={(e) => onChange(optional && e.target.value === '' ? undefined : e.target.value)}
      />
    </PropRow>
  );
}

export function TextAreaProp({
  label,
  value,
  onChange,
  hint,
  maxLength,
  rows = 3,
}: {
  label: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  hint?: string;
  maxLength?: number;
  rows?: number;
}) {
  const id = useId();
  return (
    <PropRow label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <Textarea
        id={id}
        rows={rows}
        value={value ?? ''}
        {...(maxLength ? { maxLength } : {})}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    </PropRow>
  );
}

/** Number box that keeps what the person types (such as "-" or "1.") until it parses. */
export function NumberProp({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  placeholder,
  integer = false,
}: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  placeholder?: string;
  integer?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setText((cur) => {
      const parsed = cur.trim() === '' ? undefined : Number(cur);
      if (parsed === value) return cur;
      return value === undefined ? '' : String(value);
    });
  }, [value]);
  return (
    <PropRow label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <Input
        id={id}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(step !== undefined ? { step } : {})}
        {...(placeholder ? { placeholder } : {})}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === '') return onChange(undefined);
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          const v = integer ? Math.trunc(n) : n;
          // Out of range values stay in the box but never reach the draft.
          if ((min !== undefined && v < min) || (max !== undefined && v > max)) return;
          onChange(v);
        }}
        onBlur={() => setText(value === undefined ? '' : String(value))}
      />
    </PropRow>
  );
}

export function ToggleProp({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer leading-snug">
          {label}
        </Label>
        {hint ? <p className="text-ink-muted mt-0.5 text-xs">{hint}</p> : null}
      </div>
    </div>
  );
}

export function SelectProp<V extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  hint,
  className,
}: {
  label: string;
  value: V | undefined;
  options: readonly { value: V; label: string }[];
  onChange: (next: V) => void;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <PropRow label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <Select value={value ?? ''} onValueChange={(v) => onChange(v as V)}>
        <SelectTrigger id={id} className={cn(className)}>
          <SelectValue placeholder={placeholder ?? 'Choose'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PropRow>
  );
}
