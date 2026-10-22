import { DEFAULT_SETTINGS, migrateSettings } from '@/settings/settings';

describe('migrateSettings (fuel model 1 → 2)', () => {
  it('turns the untouched 0.36 default into 1.0 and scales stored litres to match', () => {
    // settings.a.json as saved by the app on 2026-09-28.
    const { settings, fuelScale } = migrateSettings({
      host: '192.168.0.10',
      port: 35000,
      ve: 0.85,
      fuelCorrection: 0.36,
      pollIntervalMs: 500,
      mock: false,
      saved_at: 1790562571874,
    });
    expect(settings.fuelCorrection).toBe(1);
    expect(settings.fuelModel).toBe(2);
    expect(fuelScale).toBeCloseTo(1 / 0.36, 6);
    expect(settings).not.toHaveProperty('ve');
  });

  it('keeps a factor the rider calibrated', () => {
    const r = migrateSettings({ ve: 0.85, fuelCorrection: 0.52 });
    expect(r.settings.fuelCorrection).toBe(0.52);
    expect(r.fuelScale).toBeCloseTo(1, 6);
  });

  it('folds a changed VE into the factor so estimates stay the same', () => {
    const r = migrateSettings({ ve: 0.9, fuelCorrection: 0.5 });
    expect(r.settings.fuelCorrection).toBeCloseTo((0.5 * 0.9) / 0.85, 3);
    expect(r.fuelScale).toBeCloseTo(1, 2); // only the 3-decimal rounding of the factor
  });

  it('leaves current settings alone', () => {
    const r = migrateSettings({ ...DEFAULT_SETTINGS, fuelCorrection: 0.36 });
    expect(r.settings.fuelCorrection).toBe(0.36);
    expect(r.fuelScale).toBe(1);
  });

  it('uses defaults for missing or invalid input', () => {
    expect(migrateSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, fuelScale: 1 });
    expect(migrateSettings({ fuelModel: 2, fuelCorrection: -1 }).settings.fuelCorrection).toBe(1);
  });
});
