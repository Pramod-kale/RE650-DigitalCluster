/**
 * Cloud database schema and the statements sync runs (pure, so they can be
 * tested against a local libSQL server).
 */
import type { Stmt, Value } from './turso';

export const SCHEMA: Stmt[] = [
  {
    sql: `CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, last_sync INTEGER NOT NULL)`,
  },
  {
    // csv is NULL once deleted; the row stays as a tombstone for other phones.
    sql: `CREATE TABLE IF NOT EXISTS rides (
      name TEXT PRIMARY KEY, device_id TEXT NOT NULL, started_at INTEGER NOT NULL,
      summary TEXT NOT NULL, csv TEXT, deleted_at INTEGER)`,
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS fuel_entries (
      id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, data TEXT NOT NULL)`,
  },
  {
    // key 'state' (odometer/tank) and 'calibration' (fuel factor).
    sql: `CREATE TABLE IF NOT EXISTS bike (
      key TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, data TEXT NOT NULL)`,
  },
];

const stmt = (sql: string, ...args: Value[]): Stmt => ({ sql, args });

export const Q = {
  touchDevice: (id: string, name: string, at: number) =>
    stmt(
      `INSERT INTO devices (id, name, last_sync) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_sync = excluded.last_sync`,
      id,
      name,
      at,
    ),
  devices: () => stmt('SELECT id, name FROM devices'),
  bike: () => stmt('SELECT key, updated_at, data FROM bike'),
  fuel: () => stmt('SELECT id, updated_at, data FROM fuel_entries'),
  rides: () => stmt('SELECT name, device_id, deleted_at FROM rides'),
  rideCsv: (name: string) =>
    stmt('SELECT device_id, csv FROM rides WHERE name = ? AND deleted_at IS NULL', name),

  putBike: (key: string, at: number, data: unknown) =>
    stmt(
      `INSERT INTO bike (key, updated_at, data) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`,
      key,
      at,
      JSON.stringify(data),
    ),
  /** Only replaces an older version, so two phones can't undo each other's edits. */
  putFuel: (id: string, at: number, data: unknown) =>
    stmt(
      `INSERT INTO fuel_entries (id, updated_at, data) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data
       WHERE excluded.updated_at > fuel_entries.updated_at`,
      id,
      at,
      JSON.stringify(data),
    ),
  putRide: (name: string, deviceId: string, startedAt: number, summary: unknown, csv: string) =>
    stmt(
      `INSERT INTO rides (name, device_id, started_at, summary, csv, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT(name) DO NOTHING`,
      name,
      deviceId,
      startedAt,
      JSON.stringify(summary),
      csv,
    ),
  deleteRide: (name: string, deviceId: string, at: number) =>
    stmt(
      `INSERT INTO rides (name, device_id, started_at, summary, csv, deleted_at)
       VALUES (?, ?, 0, '{}', NULL, ?)
       ON CONFLICT(name) DO UPDATE SET csv = NULL, deleted_at = excluded.deleted_at`,
      name,
      deviceId,
      at,
    ),
};
