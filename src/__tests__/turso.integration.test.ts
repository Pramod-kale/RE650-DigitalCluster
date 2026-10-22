/**
 * @jest-environment node
 *
 * Runs the Turso client and the sync SQL against a local libSQL server
 * (`turso dev`). Skipped when the Turso CLI isn't installed.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { Q, SCHEMA } from '@/cloud/schema';
import { execute as run, httpUrl, TursoError, type Creds, type Stmt } from '@/cloud/turso';

// jest-expo replaces global fetch with a mock, so talk HTTP directly.
function nodeFetch(url: string, init: { method: string; headers: Record<string, string>; body: string }) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method, headers: init.headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () =>
        resolve({
          ok: (res.statusCode ?? 0) < 300,
          status: res.statusCode,
          text: async () => text,
          json: async () => JSON.parse(text),
        }),
      );
    });
    req.on('error', reject);
    req.end(init.body);
  });
}
const execute = (c: Creds, stmts: Stmt[]) => run(c, stmts, nodeFetch as unknown as typeof fetch);

const TURSO = [path.join(os.homedir(), '.turso', 'turso'), 'turso'].find(
  (bin) => spawnSync(bin, ['--version']).status === 0,
);
const PORT = 18000 + Math.floor(Math.random() * 1000);
const creds: Creds = { url: `http://127.0.0.1:${PORT}`, token: '' };

(TURSO ? describe : describe.skip)('Turso client ↔ turso dev', () => {
  let server: ChildProcess;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turso-test-'));
    server = spawn(TURSO!, ['dev', '--port', String(PORT), '--db-file', path.join(dir, 't.db')]);
    const until = Date.now() + 15_000;
    for (;;) {
      try {
        await execute(creds, [{ sql: 'SELECT 1' }]);
        break;
      } catch (e) {
        if (Date.now() > until) throw e;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }, 20_000);

  afterAll(() => {
    server?.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('converts CLI URLs to HTTPS', () => {
    expect(httpUrl('libsql://re650-me.turso.io/')).toBe('https://re650-me.turso.io');
  });

  it('round-trips integers, floats, text and null', async () => {
    const [rows] = await execute(creds, [
      { sql: 'SELECT ? AS i, ? AS f, ? AS t, ? AS n', args: [1790583611096, 2.5, 'hi', null] },
    ]);
    expect(rows).toEqual([{ i: 1790583611096, f: 2.5, t: 'hi', n: null }]);
  });

  it('reports SQL errors', async () => {
    await expect(execute(creds, [{ sql: 'SELECT * FROM nope' }])).rejects.toThrow(TursoError);
  });

  it('creates the schema idempotently', async () => {
    await execute(creds, SCHEMA);
    await execute(creds, SCHEMA);
  });

  it('keeps the newest fuel edit whichever phone writes last', async () => {
    await execute(creds, [Q.putFuel('f1', 200, { v: 'new' })]);
    await execute(creds, [Q.putFuel('f1', 100, { v: 'old' })]); // stale phone
    const [rows] = await execute(creds, [Q.fuel()]);
    expect(rows).toEqual([{ id: 'f1', updated_at: 200, data: '{"v":"new"}' }]);
  });

  it('uploads a ride once and tombstones it on delete', async () => {
    const csv = 'timestamp,rpm,speed\n10:00:00,3000,40\n';
    await execute(creds, [Q.putRide('ride_x.csv', 'dev1', 5, { km: 1 }, csv)]);
    await execute(creds, [Q.putRide('ride_x.csv', 'dev2', 5, { km: 9 }, 'other')]); // no overwrite
    let [rows] = await execute(creds, [Q.rideCsv('ride_x.csv')]);
    expect(rows).toEqual([{ device_id: 'dev1', csv }]);

    await execute(creds, [Q.deleteRide('ride_x.csv', 'dev2', 99)]);
    [rows] = await execute(creds, [Q.rideCsv('ride_x.csv')]);
    expect(rows).toEqual([]);
    const [all] = await execute(creds, [Q.rides()]);
    expect(all).toContainEqual({ name: 'ride_x.csv', device_id: 'dev1', deleted_at: 99 });
  });

  it('stores bike state and devices', async () => {
    await execute(creds, [Q.putBike('state', 1, { km_total: 9.5 }), Q.touchDevice('dev1', 'Pixel', 1)]);
    await execute(creds, [Q.putBike('state', 2, { km_total: 12 }), Q.touchDevice('dev1', 'Pixel 8', 2)]);
    const [bike, devices] = await execute(creds, [Q.bike(), Q.devices()]);
    expect(bike).toEqual([{ key: 'state', updated_at: 2, data: '{"km_total":12}' }]);
    expect(devices).toEqual([{ id: 'dev1', name: 'Pixel 8' }]);
  });
});
