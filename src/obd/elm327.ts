/**
 * ELM327 client over raw TCP (WiFi dongle). Port of ELM327Client in backend/obd.py.
 *
 * The socket is bound to the WiFi interface: the dongle's AP has no internet, and
 * without binding Android may route 192.168.0.10 over mobile data instead.
 */
import TcpSocket from 'react-native-tcp-socket';

import { DEFAULT_HOST, DEFAULT_PORT, TIMEOUT_MS } from './constants';
import { cleanResponse, parsePidResponse, parseVoltage } from './parse';

type Socket = ReturnType<typeof TcpSocket.createConnection>;

/** Raised on any transport failure; the poller reconnects on it (OSError in Python). */
export class ConnectionError extends Error {}

type Pending = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Elm327Client {
  private sock: Socket | null = null;
  private rx = '';
  private pending: Pending | null = null;
  // Serializes commands: one in flight at a time (the Python client used a lock).
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private host: string = DEFAULT_HOST,
    private port: number = DEFAULT_PORT,
    private timeoutMs: number = TIMEOUT_MS,
  ) {}

  get connected(): boolean {
    return this.sock != null;
  }

  async connect(): Promise<void> {
    await this.openSocket();
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
    const s = this.sock;
    this.sock = null;
    this.rx = '';
    this.failPending(new ConnectionError('closed'));
    if (s) {
      try {
        s.destroy();
      } catch {
        // already gone
      }
    }
  }

  async queryPid(pid: number): Promise<Uint8Array | null> {
    const cmd = `01${pid.toString(16).toUpperCase().padStart(2, '0')}`;
    return parsePidResponse(await this.send(cmd), pid);
  }

  /** ATRV — battery voltage as seen by the dongle. */
  async queryVoltage(): Promise<number | null> {
    return parseVoltage(await this.send('ATRV'));
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const sock = TcpSocket.createConnection(
        {
          host: this.host,
          port: this.port,
          interface: 'wifi',
          connectTimeout: this.timeoutMs,
        },
        () => {
          settled = true;
          this.sock = sock;
          this.rx = '';
          resolve();
        },
      );
      sock.on('data', (chunk) => {
        this.rx += typeof chunk === 'string' ? chunk : chunk.toString('latin1');
        if (this.pending && this.rx.includes('>')) this.finishPending();
      });
      sock.on('error', (err) => {
        if (!settled) {
          settled = true;
          sock.destroy();
          reject(new ConnectionError(String(err?.message ?? err)));
        } else if (this.sock === sock) {
          this.close();
        }
      });
      sock.on('close', () => {
        if (this.sock === sock) this.close();
      });
    });
  }

  /**
   * Send a command and return the cleaned response. Resolves on the `>` prompt,
   * or on timeout with whatever arrived (same as socket.timeout in Python).
   */
  send(cmd: string, waitMs = 50): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const sock = this.sock;
        if (!sock) {
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
        try {
          sock.write(`${cmd}\r`, 'ascii');
        } catch (e) {
          this.failPending(new ConnectionError(String(e)));
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
