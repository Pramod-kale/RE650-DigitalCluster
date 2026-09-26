/**
 * Fuel log math (pure, no I/O).
 *
 * Tank-to-tank method: real mileage is only known between two FULL fills.
 * Fuel burned over that stretch = litres added at every fill after the
 * previous full one, up to and including this one (partial fills included).
 * Distance = km the app measured over the same stretch.
 */

export type FuelEntry = {
  id: string;
  t: number; // epoch ms of the refuel
  litres: number; // actually added at the pump
  cost: number | null; // total paid, optional
  partial: boolean; // not filled to full
  missedBefore: boolean; // an unlogged fill happened before this one
  km: number; // app-measured km since the previous entry
  estL: number; // app-estimated litres burned since the previous entry
  factor: number; // fuel correction factor in effect while estL accumulated
  note: string;
  updatedAt: number;
  deleted?: boolean; // tombstone, so deletes survive merging storage copies
};

export type EntryResult = {
  entry: FuelEntry;
  /** km/L for the tank ending at this full fill; null if not computable. */
  kmPerL: number | null;
  /** Why there is no mileage (for the UI). */
  reason: 'first' | 'partial' | 'missed' | null;
  segmentKm: number;
  segmentL: number;
};

export type FuelSummary = {
  results: EntryResult[]; // newest first
  lifetimeKmPerL: number | null; // over all valid full-to-full stretches
  lastKmPerL: number | null;
  totalLitres: number;
  totalCost: number;
  validTanks: number;
  /** Correction factor that would have made the estimates match the pump. */
  suggestedFactor: number | null;
};

const round1 = (v: number) => Math.round(v * 10) / 10;

export function summarizeFuel(all: FuelEntry[]): FuelSummary {
  const entries = all.filter((e) => !e.deleted).sort((a, b) => a.t - b.t);
  const results: EntryResult[] = [];

  let started = false; // chain starts at the first full fill
  let seg = { km: 0, litres: 0, estRaw: 0, valid: true };
  let validKm = 0;
  let validL = 0;
  let calL = 0;
  let calEstRaw = 0;
  let validTanks = 0;
  let lastKmPerL: number | null = null;

  for (const e of entries) {
    if (!started) {
      // Unknown how full the tank was before the first full fill.
      results.push({ entry: e, kmPerL: null, reason: 'first', segmentKm: 0, segmentL: 0 });
      if (!e.partial) started = true;
      continue;
    }
    seg.km += e.km;
    seg.litres += e.litres;
    if (e.factor > 0) seg.estRaw += e.estL / e.factor;
    if (e.missedBefore) seg.valid = false;

    if (e.partial) {
      results.push({
        entry: e,
        kmPerL: null,
        reason: e.missedBefore ? 'missed' : 'partial',
        segmentKm: seg.km,
        segmentL: seg.litres,
      });
      continue;
    }

    const ok = seg.valid && seg.km > 0.1 && seg.litres > 0.05;
    const kmPerL = ok ? round1(seg.km / seg.litres) : null;
    results.push({
      entry: e,
      kmPerL,
      reason: ok ? null : 'missed',
      segmentKm: seg.km,
      segmentL: seg.litres,
    });
    if (ok) {
      validKm += seg.km;
      validL += seg.litres;
      validTanks++;
      lastKmPerL = kmPerL;
      if (seg.estRaw > 0.2) {
        calL += seg.litres;
        calEstRaw += seg.estRaw;
      }
    }
    seg = { km: 0, litres: 0, estRaw: 0, valid: true };
  }

  return {
    results: results.reverse(),
    lifetimeKmPerL: validL > 0 ? round1(validKm / validL) : null,
    lastKmPerL,
    totalLitres: entries.reduce((s, e) => s + e.litres, 0),
    totalCost: entries.reduce((s, e) => s + (e.cost ?? 0), 0),
    validTanks,
    suggestedFactor: calEstRaw > 0 ? Math.round((calL / calEstRaw) * 1000) / 1000 : null,
  };
}

/** Union of storage copies by id; the most recently updated version wins. */
export function mergeEntries(...lists: FuelEntry[][]): FuelEntry[] {
  const byId = new Map<string, FuelEntry>();
  for (const list of lists) {
    for (const e of list) {
      const cur = byId.get(e.id);
      if (!cur || e.updatedAt > cur.updatedAt) byId.set(e.id, e);
    }
  }
  return [...byId.values()].sort((a, b) => a.t - b.t);
}

/** Validate one entry from untrusted JSON. */
export function sanitizeEntry(raw: unknown): FuelEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (typeof r.id !== 'string' || n(r.t) == null || n(r.litres) == null) return null;
  return {
    id: r.id,
    t: n(r.t)!,
    litres: n(r.litres)!,
    cost: n(r.cost),
    partial: r.partial === true,
    missedBefore: r.missedBefore === true,
    km: n(r.km) ?? 0,
    estL: n(r.estL) ?? 0,
    factor: n(r.factor) ?? 0,
    note: typeof r.note === 'string' ? r.note : '',
    updatedAt: n(r.updatedAt) ?? 0,
    deleted: r.deleted === true ? true : undefined,
  };
}
