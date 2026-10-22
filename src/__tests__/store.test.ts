// The store starts a refresh interval when it loads: load it under fake timers.
jest.useFakeTimers();
let store: typeof import('@/engine/store');
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  store = require('@/engine/store');
});
afterAll(() => jest.clearAllTimers());

const T0 = new Date(2026, 9, 22, 10, 0, 0).getTime();
const S = 1000;
const sample = { rpm: 4000, speed: 72, tps: 30, map: 50, iat: 28, eot: 90, load: 30, voltage: 13.8 };

describe('mock samples', () => {
  it('count towards the session but leave the odometer and tank alone', () => {
    const before = { tank: store.getTankRaw(), km: store.toPersisted().km_total, fuel: store.toPersisted().fuel_total_l };
    const session0 = store.getSessionTotals().kmTotal;
    for (let i = 0; i <= 60; i++) store.applySample(sample, 1, T0 + i * S); // one minute at 72 km/h

    expect(store.getSessionTotals().kmTotal - session0).toBeCloseTo(1.2, 1);
    expect(store.getTankRaw()).toEqual(before.tank);
    expect(store.toPersisted().km_total).toBe(before.km);
    expect(store.toPersisted().fuel_total_l).toBe(before.fuel);
  });

  it('real bike data still adds to the odometer and tank', () => {
    const km0 = store.toPersisted().km_total;
    const tank0 = store.getTankRaw().sinceFillKm;
    const t1 = T0 + 10 * 60 * S;
    for (let i = 0; i <= 60; i++) store.applyPid('speed', 72, 1, t1 + i * S);
    expect(store.toPersisted().km_total - km0).toBeCloseTo(1.2, 1);
    expect(store.getTankRaw().sinceFillKm - tank0).toBeCloseTo(1.2, 1);
  });
});
