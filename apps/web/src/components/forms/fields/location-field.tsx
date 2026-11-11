'use client';

import { LocateFixed } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

const LocationMap = dynamic(() => import('./location-map'), {
  ssr: false,
  loading: () => <div className="bg-bg-subtle h-64 w-full animate-pulse rounded-lg" />,
});

interface Loc {
  lat: number;
  lng: number;
  label?: string;
}

function asLoc(value: unknown): Loc | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return null;
  return { lat: v.lat, lng: v.lng, ...(typeof v.label === 'string' ? { label: v.label } : {}) };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Map pin picker. Value is `{ lat, lng, label? }`. */
export function LocationField({
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'location'>) {
  const loc = asLoc(value);
  const [problem, setProblem] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // Set when the pin came from the map itself, so the map does not recenter.
  const fromMapRef = useRef(false);
  // What the person is typing; follows the pin when the pin moves some other way.
  const [latText, setLatText] = useState(loc ? String(loc.lat) : '');
  const [lngText, setLngText] = useState(loc ? String(loc.lng) : '');
  const [seen, setSeen] = useState({ lat: loc?.lat, lng: loc?.lng });
  if (loc && (seen.lat !== loc.lat || seen.lng !== loc.lng)) {
    setSeen({ lat: loc.lat, lng: loc.lng });
    if (Number(latText) !== loc.lat) setLatText(String(loc.lat));
    if (Number(lngText) !== loc.lng) setLngText(String(loc.lng));
  }

  function setPoint(p: { lat: number; lng: number }) {
    onChange({ lat: round(p.lat), lng: round(p.lng), ...(loc?.label ? { label: loc.label } : {}) });
  }

  function setLabel(label: string) {
    if (!loc) return;
    onChange({ lat: loc.lat, lng: loc.lng, ...(label.trim() ? { label } : {}) });
  }

  /** Keyboard alternative to the map: edit one coordinate, keep the other. */
  function setCoordinate(axis: 'lat' | 'lng', text: string) {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) return;
    const limit = axis === 'lat' ? 90 : 180;
    if (Math.abs(n) > limit) return;
    setPoint({ lat: loc?.lat ?? 0, lng: loc?.lng ?? 0, [axis]: n });
  }

  function useMyLocation() {
    setProblem(null);
    if (!navigator.geolocation) {
      setProblem('Your browser cannot share its location. Click the map instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        fromMapRef.current = false;
        setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        setProblem(
          err.code === err.PERMISSION_DENIED
            ? 'Location access is blocked. Allow it in your browser, or click the map.'
            : "Couldn't find your location. Click the map instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="space-y-2" role="group" aria-label="Location" aria-describedby={describedBy}>
      <LocationMap point={loc} onPick={setPoint} onUserPick={fromMapRef} disabled={ctx.disabled} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={ctx.disabled || locating}
          onClick={useMyLocation}
        >
          <LocateFixed className="h-4 w-4" /> {locating ? 'Locating' : 'Use my location'}
        </Button>
        <span className="text-ink-muted text-xs">
          {loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'Click the map to drop a pin.'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Latitude"
          type="number"
          inputMode="decimal"
          step="any"
          min={-90}
          max={90}
          placeholder="Latitude"
          value={latText}
          disabled={ctx.disabled}
          onChange={(e) => {
            fromMapRef.current = false;
            setLatText(e.target.value);
            setCoordinate('lat', e.target.value);
          }}
        />
        <Input
          aria-label="Longitude"
          type="number"
          inputMode="decimal"
          step="any"
          min={-180}
          max={180}
          placeholder="Longitude"
          value={lngText}
          disabled={ctx.disabled}
          onChange={(e) => {
            fromMapRef.current = false;
            setLngText(e.target.value);
            setCoordinate('lng', e.target.value);
          }}
        />
      </div>
      <Input
        id={inputId}
        aria-label="Place name"
        placeholder="Place name (optional)"
        maxLength={300}
        value={loc?.label ?? ''}
        disabled={ctx.disabled || !loc}
        onChange={(e) => setLabel(e.target.value)}
      />
      {problem ? <p className="text-state-error text-xs font-medium">{problem}</p> : null}
    </div>
  );
}
