/**
 * Background poll loop. Port of _poll_loop / _mock_loop in backend/main.py.
 */
import { POLL_PIDS } from '@/obd/constants';
import { decodePid } from '@/obd/decode';
import { ConnectionError, Elm327Client } from '@/obd/elm327';
import { mockValues } from '@/obd/mock';
import type { Settings } from '@/settings/settings';

import * as ride from './ride';
import * as store from './store';

// Socket alive but N cycles with no PID data → force reconnect. Typical case:
// the phone connected before the bike was on, so the ELM327 never detected
// the protocol and every query returns NO DATA.
const NO_DATA_THRESHOLD = 5;

type Hooks = { onCycle: () => void };

let runId = 0;
let client: Elm327Client | null = null;
let waitAbort: (() => void) | null = null;

const alive = (id: number) => id === runId;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waitAbort = null;
      resolve();
    }, ms);
    waitAbort = () => {
      clearTimeout(timer);
      waitAbort = null;
      resolve();
    };
  });
}

/** Start (or restart with new settings) the poll loop. */
export function start(settings: Settings, hooks: Hooks) {
  stop();
  const id = runId;
  (settings.mock ? mockLoop : obdLoop)(id, settings, hooks).catch((e) => {
    console.warn('[poller] loop crashed', e);
    store.setLink(`error: ${String(e)}`);
  });
}

export function stop() {
  runId++;
  waitAbort?.();
  client?.close();
  client = null;
  store.setConnected(false);
}

async function obdLoop(id: number, s: Settings, hooks: Hooks) {
  const c = new Elm327Client(s.host, s.port);
  client = c;
  let backoff = 1000;
  let consecutiveNoData = 0;

  while (alive(id)) {
    // Reconnect loop
    if (!c.connected) {
      try {
        store.setLink(`connecting to ${s.host}:${s.port}`);
        await c.connect();
        if (!alive(id)) break;
        store.setConnected(true);
        store.setLink('connected');
        backoff = 1000;
      } catch (e) {
        c.close();
        if (!alive(id)) break; // stopped/restarted: don't clobber the new loop's status
        store.setConnected(false);
        store.setLink(`no dongle — retry in ${Math.round(backoff / 1000)}s`);
        console.warn('[poller] connect failed', e);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
        continue;
      }
    }

    // Poll cycle: update state after each PID so RPM/speed show up ASAP
    const t0 = Date.now();
    let cycleHadData = false;
    try {
      for (const [pid, name] of POLL_PIDS) {
        const v = decodePid(pid, await c.queryPid(pid));
        if (!alive(id)) return;
        if (v != null) {
          cycleHadData = true;
          store.applyPid(name, v, s.ve, s.fuelCorrection);
        }
      }
      const volt = await c.queryVoltage();
      if (volt != null) store.setVoltage(volt);
    } catch (e) {
      if (!alive(id)) return;
      console.warn(`[poller] ${e instanceof ConnectionError ? 'socket' : 'unexpected'} error; reconnect`, e);
      c.close();
      store.setConnected(false);
      consecutiveNoData = 0;
      continue;
    }

    if (cycleHadData) {
      consecutiveNoData = 0;
      store.setLink('connected');
    } else {
      consecutiveNoData++;
      store.setLink(`dongle up, no ECU data (${consecutiveNoData}/${NO_DATA_THRESHOLD})`);
      if (consecutiveNoData >= NO_DATA_THRESHOLD) {
        // ECU was asleep during handshake; redo it now that it may be awake.
        c.close();
        store.setConnected(false);
        consecutiveNoData = 0;
        continue;
      }
    }

    // CSV row only when data is fresh — avoids the "frozen tail" of identical
    // rows after the bike turns off.
    ride.tick(store.csvRow(), false);
    hooks.onCycle();

    const elapsed = Date.now() - t0;
    if (elapsed < s.pollIntervalMs) await sleep(s.pollIntervalMs - elapsed);
  }
  c.close();
}

async function mockLoop(id: number, s: Settings, hooks: Hooks) {
  store.setLink('mock data');
  const tStart = Date.now();
  while (alive(id)) {
    const v = mockValues((Date.now() - tStart) / 1000);
    store.applySample(v, s.ve, s.fuelCorrection);
    ride.tick(store.csvRow(), true);
    hooks.onCycle();
    await sleep(s.pollIntervalMs);
  }
}
