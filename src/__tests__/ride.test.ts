import { fixAge } from '@/engine/gps';
import { closeRide, getRideStatus, gpsTick, idleCheck, keepRide, tick } from '@/engine/ride';
import {
  clearGpsLost,
  clearNoBikeData,
  clearRidePaused,
  showGpsLost,
  showNoBikeData,
  showRidePaused,
} from '@/engine/notify';
import { recordSummary } from '@/storage/rideLog';

jest.mock('@/engine/gps', () => ({
  start: jest.fn(),
  stop: jest.fn(),
  csvFields: () => ['51.500000', '-0.120000', '', '5'],
  onFix: jest.fn(),
  fixAge: jest.fn(() => 0),
  retry: jest.fn(),
}));
jest.mock('@/engine/notify', () => ({
  showRidePaused: jest.fn(async () => {}),
  clearRidePaused: jest.fn(async () => {}),
  showGpsLost: jest.fn(async () => {}),
  clearGpsLost: jest.fn(async () => {}),
  showNoBikeData: jest.fn(async () => {}),
  clearNoBikeData: jest.fn(async () => {}),
}));
const mockRows: string[][] = [];
jest.mock('@/storage/rideLog', () => ({
  recordSummary: jest.fn(),
  RideWriter: class {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    add(fields: string[]) {
      mockRows.push(fields);
    }
    flushInternal() {}
    flushExternal() {}
    flushAll() {}
    finish() {}
    summary() {
      return { name: this.name };
    }
  },
}));

const ROW = ['10:00:00', '3000', '40', '20', '50', '30', '90', '40', '13.8', '1.5', '3'];
// Ignition on, engine off, as logged on 2026-09-28: the ECU keeps answering with rpm 0.
const OFF = ['10:00:00', '0', '1', '15.69', '91.0', '31.0', '0.0', '27.45', '12.80', '0.000', ''];
const MIN = 60_000;
const T0 = new Date(2026, 8, 28, 10, 0, 0).getTime();

beforeEach(() => {
  closeRide();
  jest.clearAllMocks();
  mockRows.length = 0;
});

describe('ride pause', () => {
  it('pauses after 2 min without data and asks the rider', () => {
    tick(ROW, false, T0);
    expect(idleCheck(T0 + 2 * MIN - 1000)).toBe(false);
    expect(getRideStatus().pausedAt).toBeNull();
    expect(idleCheck(T0 + 2 * MIN + 1000)).toBe(false);
    expect(getRideStatus().pausedAt).toBe(T0 + 2 * MIN + 1000);
    expect(showRidePaused).toHaveBeenCalledTimes(1);
  });

  it('resumes the same ride when data returns', () => {
    tick(ROW, false, T0);
    const name = getRideStatus().name;
    idleCheck(T0 + 3 * MIN);
    tick(ROW, false, T0 + 20 * MIN);
    expect(getRideStatus()).toMatchObject({ name, pausedAt: null });
    expect(clearRidePaused).toHaveBeenCalled();
    expect(recordSummary).not.toHaveBeenCalled();
  });

  it('ends by itself an hour after pausing', () => {
    tick(ROW, false, T0);
    idleCheck(T0 + 3 * MIN);
    expect(idleCheck(T0 + 62 * MIN)).toBe(false);
    expect(idleCheck(T0 + 64 * MIN)).toBe(true);
    expect(getRideStatus().name).toBeNull();
    expect(recordSummary).toHaveBeenCalledTimes(1);
  });

  it('does not start a ride with the ignition on and the engine off', () => {
    tick(OFF, false, T0);
    tick(OFF, false, T0 + MIN);
    expect(getRideStatus().name).toBeNull();
  });

  it('pauses with the ignition still on, and resumes when the engine restarts', () => {
    tick(ROW, false, T0);
    for (let s = 1; s <= 150; s++) tick(OFF, false, T0 + s * 1000);
    expect(getRideStatus().pausedAt).not.toBeNull();
    const name = getRideStatus().name;
    tick(ROW, false, T0 + 10 * MIN);
    expect(getRideStatus()).toMatchObject({ name, pausedAt: null });
  });

  it('stays open past the hour when kept', () => {
    tick(ROW, false, T0);
    idleCheck(T0 + 3 * MIN);
    keepRide();
    expect(idleCheck(T0 + 5 * 60 * MIN)).toBe(false);
    expect(getRideStatus()).toMatchObject({ kept: true });
    expect(getRideStatus().name).not.toBeNull();
  });
});

describe('riding without bike data', () => {
  const S = 1000;

  it('keeps logging the GPS route when the dongle does not come back after a stop', () => {
    tick(ROW, false, T0);
    idleCheck(T0 + 3 * MIN); // stop: no bike data, paused
    expect(getRideStatus().pausedAt).not.toBeNull();
    mockRows.length = 0;

    gpsTick(2, T0 + 20 * MIN); // walking around: still paused, nothing logged
    expect(getRideStatus().pausedAt).not.toBeNull();
    expect(mockRows).toHaveLength(0);

    gpsTick(60, T0 + 25 * MIN); // riding off, dongle silent
    expect(getRideStatus().pausedAt).toBeNull();
    expect(showNoBikeData).toHaveBeenCalledTimes(1);
    expect(mockRows).toHaveLength(1);
    const row = mockRows[0];
    expect(row).toHaveLength(15);
    expect(row[1]).toBe(''); // rpm unknown
    expect(row[2]).toBe('60'); // GPS speed
    expect(row.slice(11)).toEqual(['51.500000', '-0.120000', '', '5']);

    // Two hours of riding on GPS alone: never paused, never auto-ended.
    for (let t = T0 + 25 * MIN; t < T0 + 145 * MIN; t += 5 * S) {
      gpsTick(70, t);
      expect(idleCheck(t)).toBe(false);
    }
    expect(getRideStatus().name).not.toBeNull();
    expect(getRideStatus().pausedAt).toBeNull();
    expect(showNoBikeData).toHaveBeenCalledTimes(1);
  });

  it('does not log GPS rows while bike data is flowing, and clears the warning when it returns', () => {
    tick(ROW, false, T0);
    gpsTick(60, T0 + S);
    expect(mockRows).toHaveLength(1); // only the OBD row
    gpsTick(60, T0 + 10 * S);
    expect(showNoBikeData).toHaveBeenCalledTimes(1);
    tick(ROW, false, T0 + 11 * S);
    expect(clearNoBikeData).toHaveBeenCalled();
  });

  it('keeps logging through a short stop, then pauses once stopped for good', () => {
    tick(ROW, false, T0);
    gpsTick(50, T0 + 10 * S);
    gpsTick(0, T0 + 60 * S); // traffic light
    expect(mockRows).toHaveLength(3);
    gpsTick(0, T0 + 10 * MIN);
    expect(mockRows).toHaveLength(3);
    idleCheck(T0 + 10 * MIN);
    expect(getRideStatus().pausedAt).not.toBeNull();
  });

  it('ignores GPS for mock rides', () => {
    tick(ROW, true, T0);
    gpsTick(60, T0 + MIN);
    expect(mockRows).toHaveLength(1);
    expect(showNoBikeData).not.toHaveBeenCalled();
  });
});

describe('GPS lost', () => {
  it('warns once while riding without fixes and clears when they return', () => {
    tick(ROW, false, T0);
    jest.mocked(fixAge).mockReturnValue(45_000);
    idleCheck(T0 + 45_000);
    idleCheck(T0 + 50_000);
    expect(showGpsLost).toHaveBeenCalledTimes(1);
    jest.mocked(fixAge).mockReturnValue(500);
    idleCheck(T0 + 55_000);
    expect(clearGpsLost).toHaveBeenCalledTimes(1);
    jest.mocked(fixAge).mockReturnValue(0);
  });

  it('stays quiet while the ride is paused (indoors at a stop)', () => {
    tick(ROW, false, T0);
    idleCheck(T0 + 3 * MIN);
    jest.mocked(fixAge).mockReturnValue(10 * MIN);
    idleCheck(T0 + 13 * MIN);
    expect(showGpsLost).not.toHaveBeenCalled();
    jest.mocked(fixAge).mockReturnValue(0);
  });
});
