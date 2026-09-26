/**
 * OBD2 PID decoders + derived calculations (fuel, gear).
 * 1:1 port of backend/obd.py.
 */
import {
  AFR_STOICH,
  DEFAULT_FUEL_CORRECTION_FACTOR,
  DEFAULT_VE,
  DISPLACEMENT_L,
  GASOLINE_DENSITY,
  GEAR_RATIOS,
  M_AIR,
  PRIMARY_RATIO,
  R_GAS,
  SECONDARY_RATIO,
  TIRE_CIRCUM_M,
} from './constants';

export function decodePid(pid: number, data: Uint8Array | null): number | null {
  if (data == null || data.length === 0) return null;
  const A = data[0];
  const B = data.length > 1 ? data[1] : 0;
  switch (pid) {
    case 0x04: return (A * 100.0) / 255; // engine load %
    case 0x0b: return A; // MAP kPa
    case 0x0c: return (A * 256 + B) / 4.0; // RPM
    case 0x0d: return A; // speed km/h
    case 0x0e: return A / 2.0 - 64; // timing advance °
    case 0x0f: return A - 40.0; // IAT °C
    case 0x11: return (A * 100.0) / 255; // TPS %
    case 0x5c: return A - 40.0; // EOT °C
    default: return null;
  }
}

/** Estimated gear (1-6) or null if it cannot be determined. */
export function estimateGear(rpm: number, speedKmh: number): number | null {
  if (speedKmh < 5 || rpm < 800) return null;
  const wheelRpm = (speedKmh / 3.6 / TIRE_CIRCUM_M) * 60;
  if (wheelRpm < 1) return null;
  const actualRatio = rpm / wheelRpm / (PRIMARY_RATIO * SECONDARY_RATIO);
  let bestGear = 0;
  let bestRatio = 0;
  let bestDiff = Infinity;
  for (const [g, r] of Object.entries(GEAR_RATIOS)) {
    const diff = Math.abs(r - actualRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestGear = Number(g);
      bestRatio = r;
    }
  }
  return bestDiff / bestRatio < 0.15 ? bestGear : null;
}

/**
 * Speed-density estimate: consumption in L/h, scaled by the fuel correction
 * factor (stoich AFR 14.7 vs. the lean AFR the ECU actually runs at cruise).
 */
export function calcFuelLh(
  mapKpa: number,
  rpm: number,
  iatC: number,
  ve: number = DEFAULT_VE,
  correction: number = DEFAULT_FUEL_CORRECTION_FACTOR,
): number {
  if (rpm < 100 || mapKpa < 1) return 0.0;
  const iatK = Math.max(iatC + 273.15, 200.0);
  const mafGs = (mapKpa * DISPLACEMENT_L * rpm * ve * M_AIR) / (R_GAS * iatK * 120);
  const fuelGs = mafGs / AFR_STOICH;
  return ((fuelGs * 3600) / GASOLINE_DENSITY) * correction;
}
