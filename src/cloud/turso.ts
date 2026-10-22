/**
 * Minimal Turso / libSQL client over the HTTP API (POST /v2/pipeline). Plain
 * fetch, no SDK: a handful of statements per sync doesn't need more.
 * https://docs.turso.tech/sdk/http/reference
 */
export type Creds = { url: string; token: string };
export type Value = null | number | string;
export type Stmt = { sql: string; args?: Value[] };
export type Row = Record<string, Value>;

const TIMEOUT_MS = 20_000;

export class TursoError extends Error {}

/** libsql://db-org.turso.io (as the CLI prints it) → https://db-org.turso.io */
export function httpUrl(url: string): string {
  return url.trim().replace(/^(libsql|turso|wss?):\/\//, 'https://').replace(/\/+$/, '');
}

function encode(v: Value) {
  if (v == null) return { type: 'null' };
  if (typeof v === 'string') return { type: 'text', value: v };
  // Hrana sends integers as strings so 64-bit values survive JSON.
  return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
}

type HranaValue = { type: string; value?: unknown; base64?: string };

function decode(v: HranaValue): Value {
  switch (v.type) {
    case 'integer':
      return Number(v.value);
    case 'float':
      return Number(v.value);
    case 'text':
      return String(v.value);
    case 'blob':
      return v.base64 ?? null;
    default:
      return null;
  }
}

type HranaResult =
  | {
      type: 'ok';
      response: {
        type: string;
        result?: { cols: { name: string | null }[]; rows: HranaValue[][] };
      };
    }
  | { type: 'error'; error: { message: string } };

/** Run statements in order on one connection; returns the rows of each. */
export async function execute(creds: Creds, stmts: Stmt[], fetchImpl = fetch): Promise<Row[][]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(`${httpUrl(creds.url)}/v2/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(creds.token ? { Authorization: `Bearer ${creds.token}` } : {}),
      },
      body: JSON.stringify({
        requests: [
          ...stmts.map((s) => ({
            type: 'execute',
            stmt: { sql: s.sql, args: (s.args ?? []).map(encode) },
          })),
          { type: 'close' },
        ],
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new TursoError(ctrl.signal.aborted ? 'timed out' : `network error: ${String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new TursoError('token rejected');
  if (!res.ok) throw new TursoError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as { results: HranaResult[] };
  return stmts.map((_, i) => {
    const r = body.results[i];
    if (!r) throw new TursoError('missing result');
    if (r.type === 'error') throw new TursoError(r.error.message);
    const result = r.response.result;
    if (!result) return [];
    const names = result.cols.map((c, j) => c.name ?? `col${j}`);
    return result.rows.map((row) =>
      Object.fromEntries(row.map((v, j) => [names[j], decode(v)])),
    );
  });
}
