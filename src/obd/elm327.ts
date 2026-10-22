/**
 * ELM327 client over a byte transport (Wi-Fi TCP or Bluetooth). Port of
 * ELM327Client in backend/obd.py.
 */
import { TIMEOUT_MS } from './constants';
import { cleanResponse, parsePidResponse, parseVoltage } from './parse';
import { ConnectionError, type Transport } from './transport';

export { ConnectionError };

type Pending = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Elm327Client {
  private open = false;
  private rx = '';
  private pending: Pending | null = null;
  // Serializes commands: one in flight at a time (the Python client used a lock).
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly transport: Transport,
    private timeoutMs: number = TIMEOUT_MS,
  ) {}

  get connected(): boolean {
    return this.open;
  }

  async connect(): Promise<void> {
    await this.transport.open({
      data: (chunk) => {
        this.rx += chunk;
        if (this.pending && this.rx.includes('>')) this.finishPending();
      },
      close: () => {
        if (this.open) this.close();
      },
    });
    this.open = true;
    this.rx = '';
    // Handshake
    await this.send('ATZ', 1500);
    await this.send('ATE0');
    await this.send('ATL0');
    await this.send('ATH0');
    await this.send('ATS0');
    await this.send('ATSP0');
    // Protocol auto-detect runs on the first query
    await this.send('0100', 8000);
  }

  close(): void {
    this.open = false;
    this.rx = '';
    this.failPending(new ConnectionError('closed'));
    this.transport.close();
  }

  async queryPid(pid: number): Promise<Uint8Array | null> {
    const cmd = `01${pid.toString(16).toUpperCase().padStart(2, '0')}`;
    return parsePidResponse(await this.send(cmd), pid);
  }

  /** ATRV — battery voltage as seen by the dongle. */
  async queryVoltage(): Promise<number | null> {
    return parseVoltage(await this.send('ATRV'));
  }

  /**
   * Send a command and return the cleaned response. Resolves on the `>` prompt,
   * or on timeout with whatever arrived (same as socket.timeout in Python).
   */
  send(cmd: string, waitMs = 50): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        if (!this.open) {
          reject(new ConnectionError('ELM327 not connected'));
          return;
        }
        this.rx = ''; // drain: drop late bytes from previous queries
        const timer = setTimeout(() => this.finishPending(), Math.max(waitMs, 0) + this.timeoutMs);
        this.pending = {
          resolve: (raw) => resolve(cleanResponse(raw, cmd)),
          reject,
          timer,
        };
        const fail = (e: unknown) => this.failPending(new ConnectionError(String(e)));
        try {
          void Promise.resolve(this.transport.write(`${cmd}\r`)).catch(fail);
        } catch (e) {
          fail(e);
        }
      });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private finishPending(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    const raw = this.rx;
    this.rx = '';
    p.resolve(raw);
  }

  private failPending(err: Error): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(err);
  }
}
