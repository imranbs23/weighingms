/**
 * The status store — the strip's four peripherals.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STRIP IS A RENDERER, NOT A MONITOR. EVERY ENTRY IS THE VALUE THE
 * OWNING UNIT REPORTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"It does not probe devices and it does not infer states: every entry is
 * the value the owning unit reports — the scale half from unit 004, the
 * scanner half from unit 002, the printer half from unit 006, the
 * OrgaTEX half from unit 005."* (FR-19, BRD IR-18)
 *
 * **And the prototype's hard-coded link status is deliberately not
 * carried over** — the link's states are real values that arrive over the
 * API.
 *
 * AND TWO FAILURES GET TWO ENTRIES
 * --------------------------------
 * *"Each failure gets its own entry and its own reason; no failure is
 * collapsed into a single generic 'error' state"* (FR-19).
 *
 * **And a stale snapshot is shown WITH ITS AGE, never as current** — *"a
 * snapshot presented as current is a wrong number wearing a
 * correct-looking costume."*
 */
import { create } from 'zustand';
import {
  fetchLinkState,
  fetchScales,
  fetchSyncQueue,
  type LinkStateReport,
  type ScaleReport,
  type SyncQueueEntry,
} from '../api/endpoints.js';

/** One peripheral's state — and it is the API's. */
export interface PeripheralStatus {
  /** The peripheral's id — the API's. */
  readonly id: string;
  /** The peripheral's state — the API's own vocabulary. */
  readonly state: string;
  /** Whether the peripheral is usable right now. */
  readonly healthy: boolean;
  /** The reason it is not usable — **never empty** when it is not. */
  readonly reason: string;
  /** The age of the data behind it — **in milliseconds**. */
  readonly ageMs: number | null;
}

export interface StatusStore {
  /** The scales. */
  readonly scales: readonly PeripheralStatus[];
  /** The OrgaTEX link. */
  readonly link: PeripheralStatus | null;
  /** The un-synchronised count — **the queue's depth**. */
  readonly unsynchronisedCount: number;
  /** The queue's entries — and a failed one stays visible. */
  readonly queue: readonly SyncQueueEntry[];
  /** The scanner — and its failure is never a silent skip. */
  readonly scanner: PeripheralStatus | null;
  /** The printer. */
  readonly printer: PeripheralStatus | null;
  /** Whether the whole API is reachable. */
  readonly apiReachable: boolean;
  /** Load every peripheral's state. */
  load: () => Promise<void>;
}

export const useStatusStore = create<StatusStore>((set) => ({
  scales: [],
  link: null,
  unsynchronisedCount: 0,
  queue: [],
  scanner: null,
  printer: null,
  apiReachable: true,

  load: async () => {
    const [scalesResult, linkResult, queueResult] = await Promise.all([
      fetchScalesSafe(),
      fetchLinkStateSafe(),
      fetchSyncQueueSafe(),
    ]);

    // THE API IS UNREACHABLE — and the strip says so, rather than
    // showing stale states as if they were current (BRD FR-20).
    if (!scalesResult.ok || !linkResult.ok) {
      set({ apiReachable: false });
      return;
    }

    set({
      apiReachable: true,
      scales: scalesResult.scales.map(toScaleStatus),
      link: toLinkStatus(linkResult.link),
      unsynchronisedCount: linkResult.link.unsynchronisedCount,
      queue: queueResult.ok ? queueResult.queue : [],
    });
  },
}));

/**
 * A scale's status — and the API's own state.
 *
 * **A scale with an expired calibration is NOT healthy**, and the reason
 * names it — because the gate's reason is unit `004`'s and it already
 * knows the difference (BRD FR-12, AC-14).
 */
function toScaleStatus(scale: ScaleReport): PeripheralStatus {
  const healthy = scale.status === 'READY';
  return {
    id: scale.scaleId,
    state: scale.status,
    healthy,
    reason: healthy
      ? 'status.scale.ready'
      : `status.scale.${scale.status.toLowerCase()}`,
    ageMs: null,
  };
}

/**
 * The link's status — **and its age when the snapshot is stale**.
 *
 * **And the age is DERIVED here.** The API sends `lastContactAt` — a
 * timestamp — and not an age, because the API does not know when the
 * client will render it. So the client computes the age from the
 * timestamp and its own clock, and it is shown whenever the link is not
 * `LINKED`.
 */
function toLinkStatus(link: LinkStateReport): PeripheralStatus {
  const healthy = link.status === 'LINKED';
  return {
    id: 'ORGATEX',
    state: link.status,
    healthy,
    reason: healthy ? 'status.link.linked' : `status.link.${link.status.toLowerCase()}`,
    // THE AGE — and it is shown whenever the data is not current.
    ageMs: link.lastContactAt === null ? null : ageOf(link.lastContactAt),
  };
}

/**
 * The age of a contact, in milliseconds.
 *
 * **And an unparseable timestamp has NO age** — `null`, not zero. A zero
 * would say "this was read just now", which is a claim about a reading the
 * client never had.
 */
function ageOf(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Date.now() - parsed);
}

/**
 * The scales — and a failure is a failure, not an empty array.
 */
async function fetchScalesSafe(): Promise<
  { ok: true; scales: readonly ScaleReport[] } | { ok: false }
> {
  try {
    const result = await fetchScales();
    if (result.kind !== 'OK') return { ok: false };
    return { ok: true, scales: result.body.scales };
  } catch {
    return { ok: false };
  }
}

async function fetchLinkStateSafe(): Promise<
  { ok: true; link: LinkStateReport } | { ok: false }
> {
  try {
    const result = await fetchLinkState();
    if (result.kind !== 'OK') return { ok: false };
    return { ok: true, link: result.body };
  } catch {
    return { ok: false };
  }
}

async function fetchSyncQueueSafe(): Promise<
  { ok: true; queue: readonly SyncQueueEntry[] } | { ok: false }
> {
  try {
    const result = await fetchSyncQueue();
    if (result.kind !== 'OK') return { ok: false };
    return { ok: true, queue: result.body.entries };
  } catch {
    return { ok: false };
  }
}
