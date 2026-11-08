/**
 * The queue store — Zustand.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE STATE IS THE QUEUE'S, AND NOTHING ELSE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The three states the API distinguishes, and the client must too:
 *
 * - **LOADED** — the queue arrived;
 * - **EMPTY** — the queue arrived with no rows;
 * - **DEGRADED** — the server could not be reached.
 *
 * **And the distinction is the point.** The story: *"The API is unreachable
 * when the queue view opens → the view shows a degraded state with a
 * stated reason; **it does not render a stale or empty-looking success**
 * (BRD FR-20)."*
 *
 * So the store holds the state **explicitly** — and a client that
 * rendered "whatever is under `batches`" would conflate EMPTY with
 * DEGRADED, which is exactly the failure the API goes out of its way to
 * prevent.
 */
import { create } from 'zustand';
import {
  fetchQueue,
  selectByScan,
  selectByTouch,
  type BatchQueue,
  type QueueBatch,
} from '../api/endpoints.js';

/** The queue's state — and the three are DISTINCT. */
export type QueueState =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'LOADED'; readonly queue: BatchQueue }
  | { readonly kind: 'EMPTY'; readonly queue: BatchQueue }
  | { readonly kind: 'DEGRADED'; readonly reason: string };

/** Why a selection was refused — and it is a CODE, never a sentence. */
export type RefusalReason =
  | 'UNKNOWN_BATCH'
  | 'NOT_RELEASED'
  | 'AMBIGUOUS_PREFIX'
  | 'GENERIC';

export interface QueueStore {
  readonly state: QueueState;
  /** The status filter — `null` means "All". */
  readonly filter: string | null;
  /** The refusal, when the last selection was refused. */
  readonly refusal: RefusalReason | null;
  /** Load the queue — optionally filtered. */
  load: (filter?: string | null) => Promise<void>;
  /** Select a batch by touching its row. */
  selectByTouch: (batchId: string) => Promise<void>;
  /** Select a batch by scanning it. */
  selectByScan: (code: string) => Promise<void>;
  /** Dismiss the refusal. */
  clearRefusal: () => void;
}

/**
 * The refusal codes the API can return — mapped to the client's own.
 *
 * **And the mapping is DERIVED from the codes**, so an unknown code
 * becomes the generic one rather than an untranslated string.
 */
function toRefusal(reason: string | undefined): RefusalReason {
  switch (reason) {
    case 'UNKNOWN_BATCH':
    case 'BATCH_NOT_FOUND':
      return 'UNKNOWN_BATCH';
    case 'NOT_RELEASED':
      return 'NOT_RELEASED';
    case 'AMBIGUOUS_PREFIX':
      return 'AMBIGUOUS_PREFIX';
    default:
      return 'GENERIC';
  }
}

export const useQueueStore = create<QueueStore>((set, get) => ({
  state: { kind: 'LOADING' },
  filter: null,
  refusal: null,

  load: async (filter) => {
    const active = filter === undefined ? get().filter : filter;
    set({ filter: active, state: { kind: 'LOADING' } });

    const result = await fetchQueue(active ?? undefined);

    if (result.kind === 'UNREACHABLE') {
      // THE SERVER COULD NOT BE REACHED — and that is NOT an empty queue.
      set({ state: { kind: 'DEGRADED', reason: result.message } });
      return;
    }

    if (result.kind === 'FAILED') {
      set({ state: { kind: 'DEGRADED', reason: result.error } });
      return;
    }

    const queue = result.body;
    set({
      state:
        queue.batches.length === 0
          ? { kind: 'EMPTY', queue }
          : { kind: 'LOADED', queue },
    });
  },

  selectByTouch: async (batchId) => {
    const result = await selectByTouchEndpoint(batchId);
    handleSelection(result, set);
  },

  selectByScan: async (code) => {
    const result = await selectByScanEndpoint(code);
    handleSelection(result, set);
  },

  clearRefusal: () => set({ refusal: null }),
}));

/** The two selection calls — imported so the store's own imports stay short. */
async function selectByTouchEndpoint(batchId: string) {
  return selectByTouch(batchId);
}

async function selectByScanEndpoint(code: string) {
  return selectByScan(code);
}

/** The selection's outcome — a refusal is a VALUE, not an error. */
function handleSelection(
  result:
    | { kind: 'OK'; body: unknown }
    | { kind: 'FAILED'; status: number; error: string; reason?: string }
    | { kind: 'UNREACHABLE'; message: string },
  set: (partial: Partial<QueueStore>) => void,
): void {
  if (result.kind === 'OK') {
    set({ refusal: null });
    return;
  }

  if (result.kind === 'UNREACHABLE') {
    set({ refusal: 'GENERIC' });
    return;
  }

  set({ refusal: toRefusal(result.reason) });
}

/** The rows the screen renders — and it reads the store's state, not the API. */
export function visibleBatches(state: QueueState): readonly QueueBatch[] {
  return state.kind === 'LOADED' || state.kind === 'EMPTY'
    ? state.queue.batches
    : [];
}
