import {
  buildPins,
  buildTrack,
  parseRideCsv,
  rideStats,
  trackBounds,
} from '@/storage/rideTrack';

const HEADER = 'timestamp,rpm,speed,tps,map,iat,eot,load,voltage,fuel_lh,gear,lat,lon,alt,gps_acc\n';
const ts = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [h, m, sec % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
// One row per second; lat/lon may be '' for "no fix".
const row = (sec: number, speed: number, fuel: number, lat: string, lon: string, acc = '5') =>
  `${ts(36000 + sec)},3000,${speed},20,50,30,90,40,13.8,${fuel},3,${lat},${lon},900,${acc}\n`;

describe('parseRideCsv', () => {
  it('reads old rides without GPS columns', () => {
    const csv = 'timestamp,rpm,speed,tps,map,iat,eot,load,voltage,fuel_lh,gear\n10:00:00,3000,40,20,50,30,90,40,13.8,1.5,3\n';
    const [p] = parseRideCsv(csv);
    expect(p.speed).toBe(40);
    expect(p.lat).toBeNull();
  });

  it('treats empty and inaccurate fixes as missing', () => {
    const csv = HEADER + row(0, 40, 1.5, '', '') + row(1, 40, 1.5, '12.5', '77.5', '200');
    expect(parseRideCsv(csv).map((p) => p.lat)).toEqual([null, null]);
  });
});

describe('buildTrack', () => {
  it('merges runs of the same band and splits on band change', () => {
    let csv = HEADER;
    for (let i = 0; i < 5; i++) csv += row(i, 30, 1.5, (12 + i * 0.001).toFixed(6), '77.000000');
    for (let i = 5; i < 10; i++) csv += row(i, 90, 3, (12 + i * 0.001).toFixed(6), '77.000000');
    const fc = buildTrack(parseRideCsv(csv), 'speed');
    expect(fc.features.map((f) => f.properties.band)).toEqual([1, 4]);
    // Runs share their joining vertex so the line has no gap.
    const [a, b] = fc.features.map((f) => f.geometry.coordinates);
    expect(b[0]).toEqual(a[a.length - 1]);
  });

  it('does not join points across a long gap', () => {
    const csv = HEADER + row(0, 30, 1, '12.000', '77') + row(1, 30, 1, '12.001', '77') +
      row(120, 30, 1, '12.100', '77') + row(121, 30, 1, '12.101', '77');
    expect(buildTrack(parseRideCsv(csv), 'speed').features).toHaveLength(2);
  });

  it('colours coasting as best economy and stops as stopped', () => {
    const csv = HEADER + row(0, 50, 0, '12.000', '77') + row(1, 50, 0, '12.001', '77') +
      row(2, 0, 0.3, '12.001', '77.001');
    const bands = buildTrack(parseRideCsv(csv), 'economy').features.map((f) => f.properties.band);
    expect(bands).toEqual([4, -1]);
  });
});

describe('pins, bounds and stats', () => {
  const csv = HEADER + row(0, 0, 0.3, '12.000', '77.000') + row(1, 40, 1.5, '12.001', '77.001') +
    row(2, 80, 3, '12.002', '77.002') + row(3, 0, 0.3, '12.003', '77.003');
  const samples = parseRideCsv(csv);

  it('places start, end and top speed pins', () => {
    const kinds = buildPins(samples).features.map((f) => f.properties.kind);
    expect(kinds).toEqual(['vmax', 'start', 'end']);
  });

  it('computes bounds', () => {
    expect(trackBounds(samples)).toEqual([77, 12, 77.003, 12.003]);
  });

  it('splits moving and stopped time and idle fuel', () => {
    const s = rideStats(samples);
    expect(s.movingS).toBe(2);
    expect(s.stoppedS).toBe(1);
    expect(s.idleFuelL).toBeCloseTo(0.3 / 3600, 8);
    expect(s.vMax).toBe(80);
    expect(s.gpsFixes).toBe(4);
  });
});
