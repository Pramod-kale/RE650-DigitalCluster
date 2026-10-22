/**
 * Expected values were produced by running the Python originals
 * (backend/obd.py, backend/main.py::_mock_values) on the same inputs.
 */
import { calcFuelLh, decodePid, estimateGear } from '@/obd/decode';
import { MOCK_CYCLE_S, mockValues } from '@/obd/mock';
import { cleanResponse, parsePidResponse, parseVoltage } from '@/obd/parse';

describe('decodePid (matches obd.py)', () => {
  const cases: [number, number[], number | null][] = [
    [0x0c, [0x1a, 0xf8], 1726.0],
    [0x0d, [88], 88.0],
    [0x11, [128], 50.19607843137255],
    [0x0b, [45], 45.0],
    [0x0f, [68], 28.0],
    [0x5c, [130], 90.0],
    [0x04, [200], 78.43137254901961],
    [0x0e, [140], 6.0],
    [0x42, [1], null],
  ];
  it.each(cases)('pid %i %j → %p', (pid, bytes, expected) => {
    const v = decodePid(pid, Uint8Array.from(bytes));
    if (expected == null) expect(v).toBeNull();
    else expect(v).toBeCloseTo(expected, 9);
  });
  it('null / empty data → null', () => {
    expect(decodePid(0x0c, null)).toBeNull();
    expect(decodePid(0x0c, new Uint8Array())).toBeNull();
  });
  // Phone-only: obd.py passed these through.
  it('drops 0xFF speed (sensor not ready) and reads ≤1 km/h as stopped', () => {
    expect(decodePid(0x0d, Uint8Array.from([0xff]))).toBeNull();
    expect(decodePid(0x0d, Uint8Array.from([1]))).toBe(0);
    expect(decodePid(0x0d, Uint8Array.from([2]))).toBe(2);
  });
});

describe('estimateGear (matches obd.py)', () => {
  const cases: [number, number, number | null][] = [
    [3000, 50, 3],
    [5000, 30, null],
    [1000, 3, null],
    [4000, 100, 6],
    [2500, 90, null],
    [9000, 10, null],
  ];
  it.each(cases)('%i rpm @ %i km/h → %p', (rpm, speed, gear) => {
    expect(estimateGear(rpm, speed)).toBe(gear);
  });
});

describe('calcFuelLh (matches obd.py, VE 0.85, factor 0.36)', () => {
  const cases: [number, number, number, number][] = [
    [45, 3000, 28, 0.8476676031505617],
    [90, 6000, 35, 3.3136472326956565],
    [0.5, 3000, 20, 0.0],
    [30, 50, 25, 0.0],
  ];
  it.each(cases)('map %p rpm %p iat %p', (map, rpm, iat, expected) => {
    expect(calcFuelLh(map, rpm, iat, 0.85)).toBeCloseTo(expected, 10);
  });
});

describe('mockValues', () => {
  const at = (from: number, to: number, step = 0.5) => {
    const out = [];
    for (let t = from; t <= to; t += step) out.push(mockValues(t));
    return out;
  };

  it('idles at the start with the engine running', () => {
    const v = mockValues(2);
    expect(v.speed).toBe(0);
    expect(v.tps).toBe(0);
    expect(v.rpm).toBeGreaterThan(900);
    expect(v.rpm).toBeLessThan(1000);
  });

  it('changes smoothly: no jumps in speed between half-second samples', () => {
    const vs = at(0, MOCK_CYCLE_S * 2);
    for (let i = 1; i < vs.length; i++) {
      expect(Math.abs(vs[i].speed - vs[i - 1].speed)).toBeLessThan(4);
    }
  });

  it('visits every dashboard zone in one cycle', () => {
    const vs = at(0, MOCK_CYCLE_S);
    const speeds = vs.map((v) => v.speed);
    expect(Math.max(...speeds)).toBeGreaterThan(100); // red
    expect(speeds.some((s) => s > 60 && s < 80)).toBe(true); // plain cruise
    expect(Math.max(...vs.map((v) => v.tps))).toBeGreaterThan(60); // orange throttle
    expect(Math.max(...vs.map((v) => v.rpm))).toBeLessThan(7000); // never bounces off the limiter
  });

  it('loops, and keeps values in sensor range', () => {
    // Same point of the ride one cycle later (the ±2 km/h wobble has its own period).
    expect(Math.abs(mockValues(30).speed - mockValues(30 + MOCK_CYCLE_S).speed)).toBeLessThanOrEqual(4);
    for (const v of at(0, MOCK_CYCLE_S * 3, 3)) {
      expect(v.tps).toBeGreaterThanOrEqual(0);
      expect(v.tps).toBeLessThanOrEqual(100);
      expect(v.eot).toBeLessThanOrEqual(92);
      expect(v.voltage).toBeGreaterThan(13);
    }
  });
});

describe('ELM327 response parsing', () => {
  it('strips echo, prompt and CRs', () => {
    expect(cleanResponse('010C\r41 0C 1A F8\r\r>', '010C')).toBe('41 0C 1A F8');
  });
  it('finds 41xx with spaces, SEARCHING... and leading garbage', () => {
    const resp = cleanResponse('SEARCHING...\r7E8 41 0C 1A F8\r\r>', '010C');
    expect(Array.from(parsePidResponse(resp, 0x0c)!)).toEqual([0x1a, 0xf8]);
    expect(Array.from(parsePidResponse('410D58', 0x0d)!)).toEqual([88]);
  });
  it('drops a trailing odd nibble', () => {
    expect(Array.from(parsePidResponse('410D585', 0x0d)!)).toEqual([0x58]);
  });
  it('NO DATA / other PID / non-hex → null', () => {
    expect(parsePidResponse('NO DATA', 0x0c)).toBeNull();
    expect(parsePidResponse('41 0D 58', 0x0c)).toBeNull();
    expect(parsePidResponse('410CZZ', 0x0c)).toBeNull();
  });
  it('voltage: strict …V within 0-30', () => {
    expect(parseVoltage('13.8V')).toBe(13.8);
    expect(parseVoltage(' 12.4 V ')).toBe(12.4);
    expect(parseVoltage('41 0C 1A F8')).toBeNull();
    expect(parseVoltage('410C1AF8V')).toBeNull();
    expect(parseVoltage('99.0V')).toBeNull();
  });
});
