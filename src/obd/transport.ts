/**
 * A byte pipe to the ELM327: TCP for the Wi-Fi dongle (tcp.ts), RFCOMM / BLE
 * for a Bluetooth one (bluetooth.ts). Elm327Client speaks the AT protocol over
 * whichever is configured.
 */

/** Raised on any transport failure; the poller reconnects on it (OSError in Python). */
export class ConnectionError extends Error {}

export type TransportEvents = {
  /** Text as it arrives (ASCII; latin1 so no byte is ever dropped). */
  data(chunk: string): void;
  /** The open link dropped by itself (not after close()). */
  close(): void;
};

export interface Transport {
  /** Shown in the connection status, e.g. "192.168.0.10:35000". */
  readonly label: string;
  /** Resolves once bytes can be written; rejects with ConnectionError. */
  open(on: TransportEvents): Promise<void>;
  /** Throws or rejects with ConnectionError when the link is gone. */
  write(text: string): void | Promise<void>;
  close(): void;
}
