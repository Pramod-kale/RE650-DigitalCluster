/**
 * TCP transport for the Wi-Fi ELM327.
 *
 * The socket is bound to the Wi-Fi interface: the dongle's AP has no internet, and
 * without binding Android may route 192.168.0.10 over mobile data instead.
 */
import TcpSocket from 'react-native-tcp-socket';

import { DEFAULT_HOST, DEFAULT_PORT, TIMEOUT_MS } from './constants';
import { ConnectionError, type Transport, type TransportEvents } from './transport';

type Socket = ReturnType<typeof TcpSocket.createConnection>;

export class TcpTransport implements Transport {
  private sock: Socket | null = null;

  constructor(
    private host: string = DEFAULT_HOST,
    private port: number = DEFAULT_PORT,
    private timeoutMs: number = TIMEOUT_MS,
  ) {}

  get label(): string {
    return `${this.host}:${this.port}`;
  }

  open(on: TransportEvents): Promise<void> {
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
          resolve();
        },
      );
      const dropped = () => {
        if (this.sock !== sock) return;
        this.close();
        on.close();
      };
      sock.on('data', (chunk) => {
        on.data(typeof chunk === 'string' ? chunk : chunk.toString('latin1'));
      });
      sock.on('error', (err) => {
        if (!settled) {
          settled = true;
          sock.destroy();
          reject(new ConnectionError(String(err?.message ?? err)));
        } else {
          dropped();
        }
      });
      sock.on('close', dropped);
    });
  }

  write(text: string): void {
    if (!this.sock) throw new ConnectionError('ELM327 not connected');
    this.sock.write(text, 'ascii');
  }

  close(): void {
    const s = this.sock;
    this.sock = null;
    if (s) {
      try {
        s.destroy();
      } catch {
        // already gone
      }
    }
  }
}
