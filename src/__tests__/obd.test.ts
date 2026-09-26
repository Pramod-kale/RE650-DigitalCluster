/**
 * Expected values were produced by running the Python originals
 * (backend/obd.py, backend/main.py::_mock_values) on the same inputs.
 */
import { calcFuelLh, decodePid, estimateGear } from '@/obd/decode';
import { mockValues } from '@/obd/mock';
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

describe('mockValues (matches main.py _mock_values)', () => {
  const cases: [number, number[]][] = [
    [0, [950.0, 0.0, 0.0, 25.0, 28.0, 60.0, 0.0]],
    [3, [933.902812459987, 0.0, 0.0, 25.0, 28.0, 61.5, 0.0]],
    [10, [1847.6834785856572, 30.0, 60.05984187953569, 67.04188931567498, 28.0, 65.0, 57.05684978555891]],
    [25, [3499.657869206618, 84.40660360109061, 23.688125731480355, 41.58168801203625, 28.0, 72.5, 22.503719444906338]],
    [45, [2906.3553978530317, 56.66666666666667, 5.0, 28.5, 28.0, 82.5, 4.75]],
    [57, [979.1786918745687, 0.0, 0.0, 25.0, 28.0, 88.5, 0.0]],
    [130.5, [2032.451826444223, 33.0, 65.41987227845874, 70.79391059492112, 28.0, 90.0, 62.1488786645358]],
  ];
  it.each(cases)('t=%p', (t, [rpm, speed, tps, map, iat, eot, load]) => {
    const v = mockValues(t);
    expect(v.rpm).toBeCloseTo(rpm, 8);
    expect(v.speed).toBeCloseTo(speed, 8);
    expect(v.tps).toBeCloseTo(tps, 8);
    expect(v.map).toBeCloseTo(map, 8);
    expect(v.iat).toBeCloseTo(iat, 8);
    expect(v.eot).toBeCloseTo(eot, 8);
    expect(v.load).toBeCloseTo(load, 8);
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
