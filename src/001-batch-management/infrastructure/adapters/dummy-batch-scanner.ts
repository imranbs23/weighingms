/**
 * DummyBatchScanner — the training scanner, behind the `BatchScanner` port.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SCANNER THAT IS OFF BY DEFAULT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The station's scanner is a device with an **unconfirmed contract**
 * (Q-03), so this class asserts no endpoint, no payload field and no wire
 * format as fact. It produces the port's contract, and nothing else.
 *
 * WHY IT IS OFF BY DEFAULT
 * ------------------------
 * A scanner that always produced a code would make every scan succeed in
 * the product's default configuration — and a product whose default
 * configuration silently produces a *different* answer depending on
 * whether a device happens to be plugged in is a product that cannot be
 * demonstrated honestly.
 *
 * So the dummy reports `NO_CODE` until something presents a code. The
 * operator then touches the row, and the selection works. The refusal is
 * visible, and the fallback is available (BRD FR-19, B-6).
 *
 * THE CODE IS THE BATCH'S OWN ID
 * ------------------------------
 * A batch's card carries the batch id. The dummy therefore reads back the
 * batch id it was given — and the domain resolves it against the MES's
 * records, so an unrecognised code is still possible (a card for a batch
 * that is not in the queue).
 */
import type {
  BatchScanner,
  ScanOutcome,
} from '../../domain/ports/batch-scanner.js';

export class DummyBatchScanner implements BatchScanner {
  /** The code the operator last presented, or `null` for "nothing". */
  private presented: string | null = null;

  /** Whether the scanner is connected at all. */
  private connected = true;

  /**
   * Present a code to the scanner.
   *
   * The device is reached through a port, so a test presents a code
   * without a device — and a real scanner replaces this class without
   * touching the domain.
   */
  present(code: string): void {
    this.presented = code;
  }

  /** Disconnect the scanner. */
  disconnect(): void {
    this.connected = false;
  }

  /** Reconnect the scanner. */
  connect(): void {
    this.connected = true;
  }

  /** Whether the scanner is connected — the status strip's entry. */
  isConnected(): boolean {
    return this.connected;
  }

  async read(): Promise<ScanOutcome> {
    if (!this.connected) {
      return {
        kind: 'NO_CODE',
        message: 'The scanner is disconnected',
      };
    }

    if (this.presented === null) {
      return {
        kind: 'NO_CODE',
        message: 'No code was presented to the scanner',
      };
    }

    const code = this.presented;
    // The code is CONSUMED: a scanner reads a card and forgets it. A
    // second scan without a second card must not re-select the first
    // batch.
    this.presented = null;

    return { kind: 'CODE_READ', code };
  }
}
