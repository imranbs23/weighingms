/**
 * The weigh store — the live reading, the zone, and the staleness.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SILENT SCALE SHOWS NO VALUE. NEVER `0.0`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"A silent scale shows no value — never `0.0`. This is the client-side
 * half of 'no failure may produce a silently wrong number' (B-1). A `0.0`
 * fallback would be indistinguishable from a genuinely empty scale and
 * would be the most dangerous thing the client could render."*
 *
 * **So the reading is `null` when there is none**, and the readout renders
 * an explicit empty state. And the **age** of the reading is exposed, so
 * the operator can see when the stream falls behind.
 *
 * AND THE NEWEST READING WINS — BY SEQUENCE
 * ----------------------------------------
 * *"Readings arrive out of order → the client renders the newest reading by
 * its sequence or timestamp, not the last one received."*
 *
 * **And the store is SELECTOR-BASED** — so a 10 Hz stream does not
 * re-render the whole screen (NFR-01, and the tech stack's own note).
 */
import { create } from 'zustand';
import type { ReadingFrame, StatusFrame } from '../stream/weight-stream.js';

/**
 * How old a reading may be before the readout shows **no value**.
 *
 * **And it is derived from the 200 ms budget** (NFR-01) — with room for
 * the browser's own scheduling, because a value that is 250 ms old is
 * already outside the budget the requirement states.
 */
export const STALENESS_THRESHOLD_MS = 200;

/** The live reading — and the zone the API reported. */
export interface WeighState {
  /** The newest reading — `null` when there is none, or when it is stale. */
  readonly reading: ReadingFrame | null;
  /** When the newest reading arrived — the client's clock. */
  readonly receivedAt: number | null;
  /** The zone — **the API's**, never computed here. */
  readonly zone: string | null;
  /** The device's link state — `null` until the stream says. */
  readonly linkState: 'CONNECTED' | 'DISCONNECTED' | null;
  /** The reason the device is unusable, when it is. */
  readonly detail: string | null;
  /** Accept a reading — if it is newer than the one held. */
  accept: (reading: ReadingFrame) => void;
  /** Accept a status frame. */
  setStatus: (status: StatusFrame) => void;
  /** Set the zone — the API's. */
  setZone: (zone: string | null) => void;
  /** Forget the reading — the stream stopped. */
  clear: () => void;
}

export const useWeighStore = create<WeighState>((set, get) => ({
  reading: null,
  receivedAt: null,
  zone: null,
  linkState: null,
  detail: null,

  accept: (reading) => {
    const held = get().reading;

    // THE NEWEST READING WINS — BY SEQUENCE. An out-of-order arrival does
    // not replace a newer reading.
    if (held !== null && reading.sequence <= held.sequence) {
      return;
    }

    set({ reading, receivedAt: Date.now() });
  },

  setStatus: (status) => {
    set({
      linkState:
        status.status === 'DISCONNECTED' ? 'DISCONNECTED' : 'CONNECTED',
      detail: status.detail,
    });
  },

  setZone: (zone) => set({ zone }),

  clear: () => set({ reading: null, receivedAt: null }),
}));

/**
 * The reading to display — **or `null` when it is stale**.
 *
 * **And `null` is not `0`.** The readout renders an explicit empty state
 * for it, and the confirm action is disabled with a stated reason.
 */
export function displayableReading(
  reading: ReadingFrame | null,
  receivedAt: number | null,
  now: number = Date.now(),
): ReadingFrame | null {
  if (reading === null || receivedAt === null) return null;
  if (now - receivedAt > STALENESS_THRESHOLD_MS) return null;
  return reading;
}

/**
 * The age of the stream, in milliseconds — and it is **exposed**, so the
 * operator can see when the data falls behind.
 */
export function streamAge(
  receivedAt: number | null,
  now: number = Date.now(),
): number | null {
  if (receivedAt === null) return null;
  return Math.max(0, now - receivedAt);
}
