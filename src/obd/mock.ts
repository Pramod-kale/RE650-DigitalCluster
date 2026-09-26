/**
 * Synthetic data for dev without the bike. Port of _mock_values in backend/main.py.
 * 60s cycle: idle → acceleration → cruise → braking → stop.
 */
import { GEAR_RATIOS, PRIMARY_RATIO, SECONDARY_RATIO, TIRE_CIRCUM_M } from './constants';

export type MockValues = {
  rpm: number;
  speed: number;
  tps: number;
  map: number;
  iat: number;
  eot: number;
  load: number;
  voltage: number;
};

export function mockValues(elapsed: number): MockValues {
  const cycle = elapsed % 60.0;
  let throttle: number;
  let speed: number;

  if (cycle < 5.0) {
    throttle = 0.0;
    speed = 0.0;
  } else if (cycle < 20.0) {
    const t = (cycle - 5.0) / 15.0;
    throttle = 0.65 + 0.05 * Math.sin(cycle * 3);
    speed = 90.0 * t;
  } else if (cycle < 40.0) {
    throttle = 0.25 + 0.05 * Math.sin(cycle * 2);
    speed = 85.0 + 3.0 * Math.sin(cycle * 1.5);
  } else if (cycle < 55.0) {
    const t = (cycle - 40.0) / 15.0;
    throttle = 0.05;
    speed = 85.0 * (1 - t);
  } else {
    throttle = 0.0;
    speed = 0.0;
  }

  let rpm: number;
  if (speed < 3.0) {
    rpm = 950.0 + 30.0 * Math.sin(elapsed * 4);
  } else {
    let gear: number;
    if (speed < 25) gear = 2;
    else if (speed < 40) gear = 3;
    else if (speed < 60) gear = 4;
    else if (speed < 80) gear = 5;
    else gear = 6;
    const wheelRpm = (speed / 3.6 / TIRE_CIRCUM_M) * 60.0;
    rpm = wheelRpm * GEAR_RATIOS[gear] * PRIMARY_RATIO * SECONDARY_RATIO;
  }

  return {
    rpm,
    speed,
    tps: throttle * 100.0,
    map: 25.0 + throttle * 70.0,
    iat: 28.0,
    eot: Math.min(90.0, 60.0 + elapsed / 2.0),
    load: throttle * 95.0,
    voltage: 13.8 + 0.2 * Math.sin(elapsed / 5),
  };
}
