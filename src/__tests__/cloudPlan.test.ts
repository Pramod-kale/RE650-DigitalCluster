import { fuelChanged, fuelToUpload, planRides, type RemoteRide } from '@/cloud/plan';
import type { FuelEntry } from '@/fuel/fuelMath';
import type { RideSummary } from '@/storage/rideSummary';

const ride = (name: string, mock = false): RideSummary => ({
  name, startedAt: 0, durationMin: 1, km: 1, fuelL: 0.1, vMax: 50, rpmMax: 4000, rows: 60, mock,
});
const remote = (name: string, deletedAt: number | null = null): RemoteRide => ({
  name, deviceId: 'other', deletedAt,
});

describe('planRides', () => {
  it('uploads finished real rides the cloud lacks', () => {
    const p = planRides(
      [ride('ride_20260928_080000.csv'), ride('ride_20260928_090000_MOCK.csv', true), ride('ride_20260928_100000.csv')],
      [],
      [],
      'ride_20260928_100000.csv', // still recording
    );
    expect(p.upload).toEqual(['ride_20260928_080000.csv']);
  });

  it('downloads rides from other phones, newest first', () => {
    const p = planRides([ride('a')], [remote('ride_20260101_000000.csv'), remote('ride_20260928_000000.csv'), remote('a')], [], null);
    expect(p.download).toEqual(['ride_20260928_000000.csv', 'ride_20260101_000000.csv']);
    expect(p.upload).toEqual([]);
  });

  it('applies deletions from other phones but never to the open ride', () => {
    const p = planRides([ride('a'), ride('b')], [remote('a', 1), remote('b', 1)], [], 'b');
    expect(p.deleteLocal).toEqual(['a']);
  });

  it('sends local deletions and does not bring those rides back', () => {
    const p = planRides([], [remote('gone')], ['gone'], null);
    expect(p.tombstone).toEqual(['gone']);
    expect(p.download).toEqual([]);
  });

  it('does not download deleted rides', () => {
    expect(planRides([], [remote('x', 5)], [], null).download).toEqual([]);
  });
});

describe('fuel sync helpers', () => {
  const e = (id: string, updatedAt: number) => ({ id, updatedAt }) as FuelEntry;

  it('uploads entries the cloud is missing or has older', () => {
    const up = fuelToUpload([e('a', 1), e('b', 5), e('c', 3)], new Map([['a', 1], ['b', 2]]));
    expect(up.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('detects whether the merged log differs', () => {
    expect(fuelChanged([e('a', 1)], [e('a', 1)])).toBe(false);
    expect(fuelChanged([e('a', 1)], [e('a', 2)])).toBe(true);
    expect(fuelChanged([e('a', 1)], [e('a', 1), e('b', 1)])).toBe(true);
  });
});
