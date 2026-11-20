'use client';

import { COUNTRY_CODES, countryName } from '@botss/forms';
import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  buildPhoneValue,
  callingCode,
  defaultPhoneCountry,
  parseInternational,
  splitPhoneValue,
} from '@/lib/forms/phone';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

/** Country (with dial code) plus national number; the value is E.164. */
export function PhoneField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'phone'>) {
  const [country, setCountry] = useState<string>(
    () => splitPhoneValue(value).country ?? field.defaultCountry ?? 'PK',
  );
  const [national, setNational] = useState<string>(() => splitPhoneValue(value).national);

  // The browser region is only known on the client, so it is applied after
  // mount (keeps server and client markup equal) and only when nothing else
  // chose the country.
  useEffect(() => {
    if (splitPhoneValue(value).country || field.defaultCountry) return;
    setCountry(defaultPhoneCountry(undefined, navigator.language));
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({
        code,
        name: countryName(code),
        dial: callingCode(code),
      })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  return (
    <div className="flex gap-2">
      <select
        aria-label="Country"
        value={country}
        disabled={ctx.disabled}
        onChange={(e) => {
          setCountry(e.target.value);
          onChange(buildPhoneValue(e.target.value, national));
        }}
        className={cn(
          'border-line text-ink h-10 w-36 shrink-0 rounded-md border bg-white px-2 text-sm sm:w-52',
          'focus-visible:border-brand-purple focus-visible:shadow-focus focus-visible:outline-none',
          'disabled:bg-bg-subtle disabled:text-ink-disabled disabled:cursor-not-allowed',
        )}
      >
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} (+{c.dial})
          </option>
        ))}
      </select>
      <Input
        id={inputId}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={field.placeholder}
        value={national}
        maxLength={30}
        disabled={ctx.disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-required={field.required || undefined}
        onChange={(e) => {
          const typed = e.target.value;
          // A number typed with "+" names its own country: follow it.
          const intl = parseInternational(typed);
          const nextCountry = intl?.country ?? country;
          if (intl) setCountry(intl.country);
          setNational(typed);
          onChange(buildPhoneValue(nextCountry, typed));
        }}
      />
    </div>
  );
}
