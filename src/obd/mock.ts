/**
 * Synthetic data for dev without the bike: a smooth 3-minute ride that loops.
 * Speed follows keyframes (eased between them, with a gentle wobble while
 * moving); throttle follows acceleration, gear and RPM follow speed, and the oil
 * warms up over the first few minutes. It touches every dashboard zone: the
 * cruise sits below 80 km/h, the overtake passes 100, the hard pull goes
 * above 60 % throttle.
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

export const MOCK_CYCLE_S = 180;

// [seconds into the cycle, km/h]
const KEYS: readonly [number, number][] = [
  [0, 0],
  [8, 0], // idle at the lights
  [28, 65], // pull away
  [70, 72], // cruise
  [82, 96], // overtake…
  [92, 104], // …briefly over 100
  [108, 92],
  [125, 45], // into town
  [150, 42],
  [166, 0], // brake to a stop
  [180, 0],
];

const ease = (x: number) => x * x * (3 - 2 * x); // smoothstep

function baseSpeed(cycle: number): number {
  for (let i = 1; i < KEYS.length; i++) {
    const [t1, v1] = KEYS[i];
    if (cycle <= t1) {
      const [t0, v0] = KEYS[i - 1];
      return v0 + (v1 - v0) * ease((cycle - t0) / (t1 - t0));
    }
  }
  return 0;
}

function speedAt(elapsed: number): number {
  const cycle = ((elapsed % MOCK_CYCLE_S) + MOCK_CYCLE_S) % MOCK_CYCLE_S;
  const base = baseSpeed(cycle);
  // Real riding isn't flat: ±2 km/h wobble, faded out near a standstill.
  const wobble = 2 * Math.sin(elapsed / 6) * Math.min(1, base / 20);
  return Math.max(0, base + wobble);
}

function gearFor(speed: number): number {
  if (speed < 18) return 1;
  if (speed < 30) return 2;
  if (speed < 45) return 3;
  if (speed < 60) return 4;
  if (speed < 78) return 5;
  return 6;
}

export function mockValues(elapsed: number): MockValues {
  const speed = speedAt(elapsed);
  const accel = (speedAt(elapsed + 0.5) - speedAt(elapsed - 0.5)) / 1; // km/h per s

  let throttle: number; // 0..1
  if (speed < 1) throttle = 0;
  else if (accel < -0.6) throttle = 0.03; // rolling off / braking
  else throttle = Math.min(1, Math.max(0.05, 0.06 + speed / 450 + accel * 0.13));

  let rpm: number;
  if (speed < 3) {
    rpm = 950 + 25 * Math.sin(elapsed * 4);
  } else {
    const wheelRpm = (speed / 3.6 / TIRE_CIRCUM_M) * 60;
    rpm = wheelRpm * GEAR_RATIOS[gearFor(speed)] * PRIMARY_RATIO * SECONDARY_RATIO;
  }

  return {
    rpm,
    speed,
    tps: throttle * 100,
    map: 25 + throttle * 70,
    iat: 28 + 2 * Math.sin(elapsed / 90),
    eot: Math.min(92, 60 + elapsed / 6),
    load: throttle * 95,
    voltage: 13.8 + 0.15 * Math.sin(elapsed / 5),
  };
}
