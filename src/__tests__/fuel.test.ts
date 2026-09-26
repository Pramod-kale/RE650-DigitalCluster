import { kmPerL, instantKmPerL, fmtKmL } from '@/engine/units';
import { mergeEntries, sanitizeEntry, summarizeFuel, type FuelEntry } from '@/fuel/fuelMath';

let n = 0;
function entry(p: Partial<FuelEntry>): FuelEntry {
  n++;
  return {
    id: `e${n}`,
    t: n * 1000,
    litres: 10,
    cost: null,
    partial: false,
    missedBefore: false,
    km: 0,
    estL: 0,
    factor: 0.36,
    note: '',
    updatedAt: 1,
    ...p,
  };
}

describe('summarizeFuel (tank-to-tank)', () => {
  it('first full fill is only a starting point', () => {
    const s = summarizeFuel([entry({ km: 50, litres: 12 })]);
    expect(s.results[0].kmPerL).toBeNull();
    expect(s.results[0].reason).toBe('first');
    expect(s.lifetimeKmPerL).toBeNull();
  });

  it('full → full gives km / litres of the second fill', () => {
    const s = summarizeFuel([entry({ litres: 12 }), entry({ km: 300, litres: 10 })]);
    expect(s.results[0].kmPerL).toBe(30);
    expect(s.lifetimeKmPerL).toBe(30);
    expect(s.validTanks).toBe(1);
  });

  it('partial fills add their km and litres to the next full fill', () => {
    const s = summarizeFuel([
      entry({ litres: 12 }), // start
      entry({ km: 150, litres: 4, partial: true }),
      entry({ km: 150, litres: 8 }), // 300 km / 12 L
    ]);
    expect(s.results[1].reason).toBe('partial');
    expect(s.results[0].kmPerL).toBe(25);
    expect(s.results[0].segmentKm).toBe(300);
    expect(s.results[0].segmentL).toBe(12);
  });

  it('a missed fill excludes that tank but not the following ones', () => {
    const s = summarizeFuel([
      entry({ litres: 12 }),
      entry({ km: 500, litres: 10, missedBefore: true }), // excluded
      entry({ km: 280, litres: 10 }), // 28 km/L
    ]);
    expect(s.results[1].kmPerL).toBeNull();
    expect(s.results[1].reason).toBe('missed');
    expect(s.results[0].kmPerL).toBe(28);
    expect(s.lifetimeKmPerL).toBe(28);
    expect(s.lastKmPerL).toBe(28);
  });

  it('lifetime average is total km / total litres over valid tanks', () => {
    const s = summarizeFuel([
      entry({ litres: 12 }),
      entry({ km: 300, litres: 10 }), // 30
      entry({ km: 200, litres: 10 }), // 20
    ]);
    expect(s.lifetimeKmPerL).toBe(25);
    expect(s.lastKmPerL).toBe(20);
  });

  it('suggests the correction factor that matches the pump, across factor changes', () => {
    // Tank 1: estimated 5 L at factor 0.36 → raw 13.89 L; pump says 10 L.
    // Tank 2: estimated 10 L at factor 0.72 → raw 13.89 L; pump says 10 L.
    const s = summarizeFuel([
      entry({ litres: 12 }),
      entry({ km: 300, litres: 10, estL: 5, factor: 0.36 }),
      entry({ km: 300, litres: 10, estL: 10, factor: 0.72 }),
    ]);
    expect(s.suggestedFactor).toBeCloseTo(0.72, 3);
  });

  it('ignores deleted entries and sums totals', () => {
    const s = summarizeFuel([
      entry({ litres: 12, cost: 1200 }),
      entry({ km: 300, litres: 10, cost: 1000 }),
      entry({ km: 100, litres: 5, cost: 500, deleted: true }),
    ]);
    expect(s.results).toHaveLength(2);
    expect(s.totalLitres).toBe(22);
    expect(s.totalCost).toBe(2200);
  });
});

describe('mergeEntries / sanitizeEntry', () => {
  it('newest version of each id wins (incl. tombstones)', () => {
    const a = entry({ id: 'x', litres: 10, updatedAt: 1 });
    const b = { ...a, litres: 11, updatedAt: 2 };
    const gone = { ...a, deleted: true, updatedAt: 3 };
    expect(mergeEntries([a], [b])[0].litres).toBe(11);
    expect(mergeEntries([b], [a])[0].litres).toBe(11);
    expect(mergeEntries([b], [gone])[0].deleted).toBe(true);
  });
  it('rejects malformed rows', () => {
    expect(sanitizeEntry({ id: 'x' })).toBeNull();
    expect(sanitizeEntry('junk')).toBeNull();
    expect(sanitizeEntry({ id: 'x', t: 1, litres: 5 })?.partial).toBe(false);
  });
});

describe('km/L helpers', () => {
  it('average needs some distance and fuel', () => {
    expect(kmPerL(300, 10)).toBe(30);
    expect(kmPerL(0.05, 1)).toBeNull();
    expect(kmPerL(10, 0)).toBeNull();
  });
  it('instant needs motion and fuel flow; display caps runaway values', () => {
    expect(instantKmPerL(60, 2)).toBe(30);
    expect(instantKmPerL(0, 2)).toBeNull();
    expect(instantKmPerL(60, 0)).toBeNull();
    expect(fmtKmL(150)).toBe('99+');
    expect(fmtKmL(null)).toBe('—');
  });
});
