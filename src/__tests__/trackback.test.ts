import {
  bearingDeg,
  buildRoute,
  distM,
  locate,
  splitLines,
  targetBearing,
  type LatLon,
} from '@/nav/trackback';
import type { Sample } from '@/storage/rideTrack';

const M = 1 / 111_320; // one metre of latitude, in degrees
const base = { lat: 12, lon: 77 };
const k = Math.cos((base.lat * Math.PI) / 180);
// Point `e` metres east and `n` metres north of base.
const at = (e: number, n: number): LatLon => ({ lat: base.lat + n * M, lon: base.lon + (e * M) / k });
const sample = (p: LatLon, s = 0): Sample => ({
  s, dt: 1, rpm: 3000, speed: 40, tps: 20, eot: 90, voltage: 13.8, fuelLh: 1.5, lat: p.lat, lon: p.lon,
});
const route = (pts: LatLon[]) => buildRoute(pts.map((p, i) => sample(p, i)));

describe('buildRoute', () => {
  it('drops repeated fixes and accumulates distance', () => {
    const r = route([at(0, 0), at(0, 0), at(100, 0), at(100, 100)]);
    expect(r.pts).toHaveLength(3);
    expect(r.total).toBeCloseTo(200, 0);
    expect(r.along[1]).toBeCloseTo(100, 0);
  });
});

describe('locate', () => {
  const straight = route([at(0, 0), at(500, 0), at(1000, 0)]);

  it('snaps a nearby position and reports distance left to the start', () => {
    const p = locate(straight, at(700, 15))!;
    expect(p.onTrack).toBe(true);
    expect(p.along).toBeCloseTo(700, 0);
    expect(p.offTrackM).toBeCloseTo(15, 0);
  });

  it('reports off-track distance when far from the track', () => {
    const p = locate(straight, at(300, 200))!;
    expect(p.onTrack).toBe(false);
    expect(p.offTrackM).toBeCloseTo(200, 0);
  });

  it('widens the on-track band for poor GPS accuracy', () => {
    expect(locate(straight, at(300, 60), 80)!.onTrack).toBe(true);
  });

  it('picks the pass closest to the start where the track doubles back', () => {
    // Out 1 km east and back along the same road.
    const outAndBack = route([at(0, 0), at(1000, 0), at(0, 5)]);
    expect(locate(outAndBack, at(500, 2))!.along).toBeCloseTo(500, -1);
  });
});

describe('guidance', () => {
  const straight = route([at(0, 0), at(1000, 0)]);

  it('points back along the track toward the start', () => {
    const pos = at(600, 0);
    const b = targetBearing(straight, pos, locate(straight, pos)!);
    expect(b).toBeCloseTo(270, 0); // west
  });

  it('points at the track when off it', () => {
    const pos = at(600, 300);
    const b = targetBearing(straight, pos, locate(straight, pos)!);
    expect(b).toBeCloseTo(180, 0); // south
  });

  it('splits the line at the rider', () => {
    const p = locate(straight, at(400, 0))!;
    const { ahead, done } = splitLines(straight, p);
    expect(ahead[0]).toEqual([base.lon, base.lat]);
    expect(ahead[ahead.length - 1]).toEqual(done[0]);
    expect(distM(at(0, 0), { lon: done[0][0], lat: done[0][1] })).toBeCloseTo(400, 0);
  });

  it('computes compass bearings', () => {
    expect(bearingDeg(at(0, 0), at(0, 100))).toBeCloseTo(0, 0);
    expect(bearingDeg(at(0, 0), at(100, 0))).toBeCloseTo(90, 0);
  });
});
