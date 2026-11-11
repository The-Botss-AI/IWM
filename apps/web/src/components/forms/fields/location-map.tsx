'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export interface LatLng {
  lat: number;
  lng: number;
}

// A divIcon avoids the bundler-broken default marker image paths.
const PIN = L.divIcon({
  className: '',
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#6d28d9;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:rotate(-45deg)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

function Clicks({ onPick, disabled }: { onPick: (p: LatLng) => void; disabled: boolean }) {
  useMapEvents({
    click(e) {
      // wrap() keeps lng inside -180..180 when the map is panned past the date line.
      const ll = e.latlng.wrap();
      if (!disabled) onPick({ lat: ll.lat, lng: ll.lng });
    },
  });
  return null;
}

/**
 * Moves the map to `point` when it changes from outside (use my location, typed
 * coordinates). A pin the person just placed or dragged is already in view, so
 * `userMoved` skips the recenter and the zoom stays where they left it.
 */
function Recenter({ point, userMoved }: { point: LatLng | null; userMoved: { current: boolean } }) {
  const map = useMap();
  const lat = point?.lat;
  const lng = point?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    if (userMoved.current) {
      userMoved.current = false;
      return;
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 14));
  }, [map, lat, lng, userMoved]);
  return null;
}

/** Click or drag to place the pin. Loaded client-side only (Leaflet needs `window`). */
export default function LocationMap({
  point,
  onPick,
  onUserPick,
  disabled,
}: {
  point: LatLng | null;
  onPick: (p: LatLng) => void;
  /** Called when the person placed the pin on the map, so the map does not recenter. */
  onUserPick: { current: boolean };
  disabled: boolean;
}) {
  function pickByUser(p: LatLng) {
    onUserPick.current = true;
    onPick(p);
  }
  return (
    <MapContainer
      center={point ? [point.lat, point.lng] : [25, 55]}
      zoom={point ? 14 : 3}
      scrollWheelZoom={false}
      className="border-line h-64 w-full rounded-lg border"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
        // The public form page sends no referrer; OSM tiles require one.
        referrerPolicy="origin"
      />
      <Clicks onPick={pickByUser} disabled={disabled} />
      <Recenter point={point} userMoved={onUserPick} />
      {point ? (
        <Marker
          position={[point.lat, point.lng]}
          icon={PIN}
          draggable={!disabled}
          eventHandlers={{
            dragend(e) {
              const ll = (e.target as L.Marker).getLatLng().wrap();
              pickByUser({ lat: ll.lat, lng: ll.lng });
            },
          }}
        />
      ) : null}
    </MapContainer>
  );
}
