/**
 * Runs the real Elm327Client against scripts/fake_elm327.py over TCP.
 * react-native-tcp-socket mirrors Node's `net` API, so we map it to `net`.
 * @jest-environment node
 */
/// <reference types="node" />
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';

import { POLL_PIDS } from '@/obd/constants';
import { decodePid } from '@/obd/decode';
import { Elm327Client } from '@/obd/elm327';

jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: {
    createConnection: (opts: { host: string; port: number }, cb: () => void) =>
      // jest.mock factories are hoisted above imports, so require is needed here.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('net').createConnection({ host: opts.host, port: opts.port }, cb),
  },
}));

const SCRIPT = path.resolve(__dirname, '../../../../scripts/fake_elm327.py');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const PORT = 35000 + Math.floor(Math.random() * 1000) + 1000;

function waitForPort(port: number, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.createConnection({ host: '127.0.0.1', port }, () => {
        s.destroy();
        resolve();
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() > until) reject(new Error('fake ELM327 did not start'));
        else setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}

(hasPython ? describe : describe.skip)('Elm327Client ↔ fake_elm327.py', () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = spawn('python3', [SCRIPT, '--host', '127.0.0.1', '--port', String(PORT)], {
      stdio: 'ignore',
    });
    await waitForPort(PORT);
  }, 10_000);

  afterAll(() => {
    server?.kill();
  });

  it('handshakes, polls every PID and reads voltage', async () => {
    const c = new Elm327Client('127.0.0.1', PORT);
    await c.connect();
    expect(c.connected).toBe(true);
    const values: Record<string, number | null> = {};
    for (const [pid, name] of POLL_PIDS) values[name] = decodePid(pid, await c.queryPid(pid));
    for (const [, name] of POLL_PIDS) expect(values[name]).not.toBeNull();
    expect(values.rpm!).toBeGreaterThan(500);
    const v = await c.queryVoltage();
    expect(v).toBeGreaterThan(10);
    expect(v).toBeLessThan(16);
    c.close();
    expect(c.connected).toBe(false);
  }, 20_000);

  it('rejects when the dongle is unreachable', async () => {
    const c = new Elm327Client('127.0.0.1', 1, 500);
    await expect(c.connect()).rejects.toThrow();
    expect(c.connected).toBe(false);
  });
});
