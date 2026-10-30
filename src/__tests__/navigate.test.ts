import { boundsOf, decodePolyline6, etaSeconds, fmtDist, toNavRoute, toPlace } from '@/nav/navigate';
import { locate } from '@/nav/trackback';

const M = 1 / 111_320; // one metre of latitude, in degrees

// Reference encoder (Google polyline algorithm, 6 decimals).
function encode(pts: [number, number][]): string {
  let out = '';
  let plat = 0;
  let plon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? -2 * v - 1 : 2 * v;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n % 32)) + 63);
      n = Math.floor(n / 32);
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of pts) {
    const ilat = Math.round(lat * 1e6);
    const ilon = Math.round(lon * 1e6);
    enc(ilat - plat);
    enc(ilon - plon);
    plat = ilat;
    plon = ilon;
  }
  return out;
}

describe('decodePolyline6', () => {
  it('round-trips, including large and negative coordinates', () => {
    const pts: [number, number][] = [[73.856841, 18.520412], [73.786858, 18.559963], [-122.419416, 37.774929], [179.999999, -89.5]];
    const back = decodePolyline6(encode(pts));
    expect(back).toHaveLength(pts.length);
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(pts[i][0], 6);
      expect(p[1]).toBeCloseTo(pts[i][1], 6);
    });
  });
});

describe('toNavRoute', () => {
  // 1 km due north from (77, 12).
  const line = [0, 250, 500, 750, 1000].map((n) => [77, 12 + n * M]);
  const r = toNavRoute(line, 1, 120);

  it('stores the route destination-first', () => {
    expect(r.route.pts[0].lat).toBeCloseTo(12 + 1000 * M, 9);
    expect(r.route.total).toBeCloseTo(1000, 0);
  });

  it('locate() gives the distance left to the destination', () => {
    const p = locate(r.route, { lat: 12 + 300 * M, lon: 77 });
    expect(p?.onTrack).toBe(true);
    expect(p?.along).toBeCloseTo(700, 0);
  });
});

describe('etaSeconds', () => {
  const r = toNavRoute([[77, 12], [77, 12 + 1000 * M]], 1, 100);

  it("uses the router's time until enough pace is measured", () => {
    expect(etaSeconds(r, 500, { expectedS: 60, actualS: 600 })).toBeCloseTo(50, 0);
  });

  it("scales by the rider's pace, within limits", () => {
    expect(etaSeconds(r, 500, { expectedS: 200, actualS: 300 })).toBeCloseTo(75, 0);
    expect(etaSeconds(r, 500, { expectedS: 200, actualS: 5000 })).toBeCloseTo(125, 0); // capped at 2.5×
  });
});

describe('toPlace', () => {
  it('builds a name and a de-duplicated detail line', () => {
    const p = toPlace({
      properties: { name: 'Shivaji Nagar', district: 'Shivajinagar', city: 'Pune', county: 'Pune', state: 'Maharashtra' },
      geometry: { coordinates: [73.85, 18.53] },
    });
    expect(p).toEqual({ name: 'Shivaji Nagar', detail: 'Shivajinagar, Pune, Maharashtra', lat: 18.53, lon: 73.85 });
  });

  it('falls back to the street address, and drops features without one', () => {
    expect(toPlace({ properties: { housenumber: '12', street: 'MG Road' }, geometry: { coordinates: [1, 2] } })?.name).toBe(
      '12 MG Road',
    );
    expect(toPlace({ properties: {}, geometry: { coordinates: [1, 2] } })).toBeNull();
  });
});

it('boundsOf and fmtDist', () => {
  expect(boundsOf([[[1, 2], [3, 0]]], [[-1, 5]])).toEqual([-1, 0, 3, 5]);
  expect(fmtDist(347)).toBe('350 m');
  expect(fmtDist(2345)).toBe('2.3 km');
  expect(fmtDist(12_345)).toBe('12 km');
});
