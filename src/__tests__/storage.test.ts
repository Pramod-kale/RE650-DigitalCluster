import type { PersistedState } from '@/engine/store';
import { mergeStates } from '@/storage/persist';
import { parseRideName, rideFileName, summarizeCsv } from '@/storage/rideSummary';

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));

const base: PersistedState = {
  km_total: 0,
  fuel_total_l: 0,
  started_at: null,
  tank_since_fill_l: 0,
  tank_since_fill_km: 0,
  tank_last_fill_t: null,
  saved_at: 0,
};

describe('mergeStates', () => {
  it('a fresh install (zeros, newer saved_at) never wins over folder history', () => {
    const folder = {
      ...base,
      km_total: 5230.4,
      fuel_total_l: 210.2,
      started_at: 1000,
      tank_since_fill_km: 120,
      tank_since_fill_l: 4.1,
      tank_last_fill_t: 5000,
      saved_at: 10_000,
    };
    const fresh = { ...base, started_at: 99_000, saved_at: 99_999 };
    const m = mergeStates(fresh, folder)!;
    expect(m.km_total).toBe(5230.4);
    expect(m.fuel_total_l).toBe(210.2);
    expect(m.tank_since_fill_km).toBe(120);
    expect(m.started_at).toBe(1000);
  });
  it('a later tank-full marker wins even with fewer km since fill', () => {
    const old = { ...base, km_total: 100, tank_since_fill_km: 300, tank_last_fill_t: 1 };
    const refilled = { ...base, km_total: 101, tank_since_fill_km: 1, tank_last_fill_t: 2 };
    expect(mergeStates(old, refilled)!.tank_since_fill_km).toBe(1);
    expect(mergeStates(refilled, old)!.tank_since_fill_km).toBe(1);
  });
  it('null handling', () => {
    expect(mergeStates(null, null)).toBeNull();
    expect(mergeStates(base, null)).toBe(base);
  });
});

describe('ride file names', () => {
  it('round-trips and keeps the backend naming (incl. _MOCK)', () => {
    const d = new Date(2026, 3, 26, 17, 1, 49);
    expect(rideFileName(d, false)).toBe('ride_20260426_170149.csv');
    expect(rideFileName(d, true)).toBe('ride_20260426_170149_MOCK.csv');
    expect(parseRideName('ride_20260426_170149_MOCK.csv')).toEqual({
      startedAt: d.getTime(),
      mock: true,
    });
    expect(parseRideName('state.a.json')).toBeNull();
  });
});

describe('summarizeCsv', () => {
  const header = 'timestamp,rpm,speed,tps,map,iat,eot,load,voltage,fuel_lh,gear\n';
  it('integrates speed/fuel per second and skips long gaps', () => {
    const ts = (sec: number) =>
      `10:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    let csv = header;
    // 61 rows over 60 s at 36 km/h and 1.8 L/h → 0.6 km, 0.03 L
    for (let sec = 0; sec <= 60; sec++) csv += `${ts(sec)},3000,36,20,40,28,80,30,13.9,1.800,3\n`;
    // 10-minute gap (bike off) then one row: must not add distance
    csv += '10:11:00,3000,36,20,40,28,80,30,13.9,1.800,3\n';
    const r = summarizeCsv('ride_20260426_100000.csv', csv);
    expect(r.km).toBeCloseTo(0.6, 5);
    expect(r.fuelL).toBeCloseTo(0.03, 5);
    expect(r.durationMin).toBe(1);
    expect(r.vMax).toBe(36);
    expect(r.rpmMax).toBe(3000);
    expect(r.rows).toBe(62);
  });
  it('handles midnight and empty files', () => {
    const csv = header + '23:59:59,1000,60,0,0,0,0,0,0,0,\n00:00:01,1000,60,0,0,0,0,0,0,0,\n';
    expect(summarizeCsv('ride_20260426_235959.csv', csv).durationMin).toBeCloseTo(0, 1);
    expect(summarizeCsv('ride_20260426_235959.csv', csv).km).toBeCloseTo((60 * 2) / 3600, 2); // summary rounds km to 2 dp
    expect(summarizeCsv('x.csv', '').rows).toBe(0);
  });
});
