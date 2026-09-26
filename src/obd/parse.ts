/**
 * Pure ELM327 response parsing (no I/O) — kept separate so it is unit-testable.
 * Mirrors ELM327Client._send / query_pid / query_voltage in backend/obd.py.
 */

/** Strip echo, prompt and CRs; return non-empty trimmed lines joined by \n. */
export function cleanResponse(raw: string, cmd: string): string {
  const text = raw.split(cmd).join('').split('>').join('').replace(/\r/g, '\n');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Find the `41xx` mode-01 response for `pid` and return its data bytes. */
export function parsePidResponse(resp: string, pid: number): Uint8Array | null {
  const target = `41${pid.toString(16).toUpperCase().padStart(2, '0')}`;
  for (const line of resp.split('\n')) {
    const clean = line.replace(/ /g, '').toUpperCase();
    const idx = clean.indexOf(target);
    if (idx === -1) continue;
    let dataHex = clean.slice(idx + 4);
    dataHex = dataHex.slice(0, dataHex.length - (dataHex.length % 2));
    if (!/^[0-9A-F]*$/.test(dataHex)) continue;
    const bytes = new Uint8Array(dataHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  return null;
}

/**
 * ATRV response → volts. Strict: must end in V and be within 0-30 V, so stale
 * bytes from a previous PID are never read as a huge voltage.
 */
export function parseVoltage(resp: string): number | null {
  const raw = resp.trim();
  if (!raw.endsWith('V')) return null;
  const body = raw.slice(0, -1).trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(body)) return null;
  const v = parseFloat(body);
  return v >= 0 && v <= 30 ? v : null;
}
