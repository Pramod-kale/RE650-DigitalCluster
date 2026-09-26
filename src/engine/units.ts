/** Fuel economy in km/L (the unit used everywhere in the app). */

/** Average km/L over a distance; null until there's enough data to mean anything. */
export function kmPerL(km: number, litres: number): number | null {
  if (km <= 0.1 || litres <= 0.001) return null;
  return Math.round((km / litres) * 10) / 10;
}

/**
 * Instantaneous km/L from speed and fuel rate. Only meaningful when moving; on
 * a closed throttle the fuel rate approaches 0 and this shoots up, so the
 * display caps it (see fmtKmL).
 */
export function instantKmPerL(speedKmh: number, fuelLh: number): number | null {
  if (speedKmh <= 1.0 || fuelLh <= 0.01) return null;
  return Math.round((speedKmh / fuelLh) * 10) / 10;
}

export function fmtKmL(v: number | null | undefined, dash = '—'): string {
  if (v == null || Number.isNaN(v)) return dash;
  return v >= 100 ? '99+' : v.toFixed(1);
}
