/**
 * The workflow store — which view the terminal shows, and for which batch.
 *
 * ══════════════════════════════════════════════════════════════════════
 * EVERY TRANSITION FOLLOWS AN API SUCCESS. THE CLIENT DECIDES NO RULE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The three views — queue, weigh, complete — are the prototype's. The
 * store moves between them only when the API has answered: a selection
 * that was accepted, a session the station started, a batch the station
 * completed. Which component is next, and when a batch is complete, are
 * the station's decisions (FR-14); the store renders them.
 */
import { create } from 'zustand';
import {
  completeBatch,
  fetchRecipe,
  fetchSession,
  startSession,
} from '../api/endpoints.js';

export type WorkflowView = 'QUEUE' | 'WEIGH' | 'COMPLETE';

/** Why the weigh view could not be opened — a locale key. */
export type WorkflowRefusal =
  | 'workflow.refusal.otherBatch'
  | 'workflow.refusal.noScale'
  | 'workflow.refusal.unreachable'
  | 'workflow.refusal.notComplete';

export interface WorkflowStore {
  readonly view: WorkflowView;
  /** The batch the weigh or complete view is about. */
  readonly batchId: string | null;
  readonly refusal: WorkflowRefusal | null;
  readonly busy: boolean;
  /** On sign-in: resume whatever the station's session says. */
  decide: () => Promise<void>;
  /** A batch was selected: load its recipe and start its weighing. */
  openBatch: (batchId: string) => Promise<void>;
  /** The last component was confirmed: complete the batch (write-back). */
  complete: () => Promise<void>;
  /** Leave the weigh view; the batch stays in progress. */
  quit: () => void;
  /** Back to the queue after a completed batch. */
  nextBatch: () => void;
  clearRefusal: () => void;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  view: 'QUEUE',
  batchId: null,
  refusal: null,
  busy: false,

  decide: async () => {
    const result = await fetchSession();
    if (result.kind !== 'OK' || result.body.session === null) {
      set({ view: 'QUEUE', batchId: null });
      return;
    }

    const session = result.body.session;
    if (session.state === 'COMPLETE') {
      set({ view: 'COMPLETE', batchId: session.batchId });
      return;
    }

    // An unfinished session is RESUMED (NFR-06): the recipe is loaded
    // again and the station re-binds the active component's scale.
    await get().openBatch(session.batchId);
  },

  openBatch: async (batchId) => {
    set({ busy: true, refusal: null });

    // THE RECIPE FIRST — the station reads it from its working copy.
    const recipe = await fetchRecipe(batchId);
    if (recipe.kind !== 'OK') {
      set({ busy: false, refusal: 'workflow.refusal.unreachable' });
      return;
    }

    const started = await startSession(batchId);
    if (started.kind === 'OK') {
      set({ busy: false, view: 'WEIGH', batchId });
      return;
    }

    set({
      busy: false,
      refusal:
        started.kind === 'FAILED' &&
        started.reason === 'OTHER_BATCH_IN_PROGRESS'
          ? 'workflow.refusal.otherBatch'
          : started.kind === 'FAILED'
            ? 'workflow.refusal.noScale'
            : 'workflow.refusal.unreachable',
    });
  },

  complete: async () => {
    const batchId = get().batchId;
    if (batchId === null) return;

    set({ busy: true });
    const result = await completeBatch(batchId);
    if (result.kind !== 'OK') {
      set({ busy: false, refusal: 'workflow.refusal.notComplete' });
      return;
    }
    set({ busy: false, view: 'COMPLETE' });
  },

  quit: () => set({ view: 'QUEUE', refusal: null }),

  nextBatch: () => set({ view: 'QUEUE', batchId: null, refusal: null }),

  clearRefusal: () => set({ refusal: null }),
}));
