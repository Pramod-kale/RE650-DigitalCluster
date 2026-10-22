/**
 * Map style for the ride map: OpenFreeMap's dark style recoloured with the
 * dashboard palette (its own is neutral grey and hides minor roads). Fetched
 * once per app run; falls back to the stock style if the fetch fails.
 */
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useState } from 'react';

import { C } from './dash';

// OpenFreeMap: free vector tiles, no API key. MapLibre adds the required attribution.
export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

const WATER = '#0f2233';
const GREEN = '#122019';
const ROAD_MINOR = '#262c35';
const ROAD_MAJOR = '#3a424d';
const RAIL = '#2a3038';

/** Paint overrides by layer id; ids missing from the style are ignored. */
const PAINT: Record<string, Record<string, string>> = {
  background: { 'background-color': C.bg },
  water: { 'fill-color': WATER },
  waterway: { 'line-color': WATER },
  landcover_ice_shelf: { 'fill-color': C.bg },
  landcover_glacier: { 'fill-color': C.bg },
  landuse_residential: { 'fill-color': '#10151c' },
  landcover_wood: { 'fill-color': GREEN },
  landuse_park: { 'fill-color': GREEN },
  building: { 'fill-color': C.panel, 'fill-outline-color': C.barBg },
  'aeroway-area': { 'fill-color': C.panel },
  'aeroway-taxiway': { 'line-color': ROAD_MINOR },
  'aeroway-runway': { 'line-color': ROAD_MINOR },
  'aeroway-runway-casing': { 'line-color': C.border },
  road_area_pier: { 'fill-color': C.bg },
  road_pier: { 'line-color': C.bg },
  highway_path: { 'line-color': C.barBg },
  highway_minor: { 'line-color': ROAD_MINOR },
  highway_major_casing: { 'line-color': C.border },
  highway_major_inner: { 'line-color': ROAD_MAJOR },
  highway_major_subtle: { 'line-color': ROAD_MAJOR },
  highway_motorway_casing: { 'line-color': C.border },
  highway_motorway_inner: { 'line-color': ROAD_MAJOR },
  highway_motorway_subtle: { 'line-color': ROAD_MAJOR },
  railway_transit: { 'line-color': RAIL },
  railway_transit_dashline: { 'line-color': C.bg },
  railway_minor: { 'line-color': RAIL },
  railway_minor_dashline: { 'line-color': C.bg },
  railway: { 'line-color': RAIL },
  railway_dashline: { 'line-color': C.bg },
  boundary_state: { 'line-color': C.border },
  'boundary_country_z0-4': { 'line-color': C.border },
  'boundary_country_z5-': { 'line-color': C.border },
  water_name: { 'text-color': '#4f7ea8', 'text-halo-color': C.bg },
  highway_name_other: { 'text-color': '#6e7681', 'text-halo-color': C.bg },
  highway_name_motorway: { 'text-color': C.muted },
};
const PLACE_LABEL = { 'text-color': C.muted, 'text-halo-color': C.bg };

export function themeStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const over = PAINT[layer.id] ?? (layer.id.startsWith('place_') ? PLACE_LABEL : null);
      if (!over || layer.type === 'hillshade' || layer.type === 'color-relief') return layer;
      return { ...layer, paint: { ...layer.paint, ...over } } as typeof layer;
    }),
  };
}

let cached: Promise<StyleSpecification | string> | null = null;

function loadStyle(): Promise<StyleSpecification | string> {
  cached ??= fetch(BASE_STYLE_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<StyleSpecification>;
    })
    .then(themeStyle)
    .catch((e) => {
      console.warn('[map] style fetch failed; using stock style', e);
      cached = null; // try again next time the screen opens
      return BASE_STYLE_URL;
    });
  return cached;
}

/** The themed style, or null while it loads (render nothing to avoid a restyle flash). */
export function useMapStyle(): StyleSpecification | string | null {
  const [style, setStyle] = useState<StyleSpecification | string | null>(null);
  useEffect(() => {
    let live = true;
    loadStyle().then((s) => live && setStyle(s));
    return () => {
      live = false;
    };
  }, []);
  return style;
}
