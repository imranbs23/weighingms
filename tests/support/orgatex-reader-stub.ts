/**
 * A stub OrgaTEX adapter, shared by the reader tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE SEAM, TWO TEST FILES
 * ══════════════════════════════════════════════════════════════════════
 *
 * The readers are exercised from two places: the reader's own test file
 * (bolt 005's edge cases) and bolt 007's link-state tests (a failed read
 * has to move the link state).
 *
 * A stub that lives in one test file cannot be reached from the other —
 * and a copy is a second thing that can be wrong. So the stub lives here,
 * and both files use it.
 *
 * The stub is deliberately **dumb**: it holds a queue, a recipe and an
 * optional failure, and it does exactly what it is told. A test drives it
 * by changing what it holds.
 */
import {
  AdapterError,
  type BatchStatusFilter,
  type BatchStatusToWrite,
  type OrgatexAdapter,
  type RawBatch,
  type RawComponent,
  type RawConsumption,
  type RawQueue,
  type RawRecipe,
} from '../../src/005-orgatex-integration/domain/ports/orgatex-adapter.js';
import { BatchId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';

/** A batch, valid unless a test says otherwise. */
export function batch(overrides: Partial<RawBatch> = {}): RawBatch {
  return {
    batchId: 'B-24187',
    orderRef: 'SO-9931',
    machineRef: 'JET-04',
    fabricDescription: '100% CTN knit · 480 kg',
    shadeCode: 'Teal 4C',
    componentCount: 5,
    weighingStatus: 'RELEASED',
    ...overrides,
  };
}

/** A component, valid unless a test says otherwise. */
export function component(
  overrides: Partial<RawComponent> = {},
): RawComponent {
  return {
    sequence: 1,
    componentId: 'DYE-4471-Y',
    dyestuffCode: 'DYE-4471',
    target: '94.0000',
    unit: 'g',
    toleranceMin: '93.5000',
    toleranceMax: '94.5000',
    scaleClass: 'PRECISION',
    ...overrides,
  };
}

/** An adapter a test drives directly. */
export class StubAdapter implements OrgatexAdapter {
  queue: RawQueue = { batches: [batch()] };
  recipe: RawRecipe | null = {
    batchId: 'B-24187',
    shadeCode: 'Teal 4C',
    components: [component()],
  };
  failure: AdapterError | null = null;
  seenFilter: BatchStatusFilter | undefined;
  lastRecipeId: string | null = null;

  async readQueue(filter?: BatchStatusFilter): Promise<RawQueue> {
    this.seenFilter = filter;
    if (this.failure !== null) throw this.failure;
    return this.queue;
  }

  async readRecipe(batchId: BatchId): Promise<RawRecipe> {
    this.lastRecipeId = batchId.value;
    if (this.failure !== null) throw this.failure;
    if (this.recipe === null) {
      throw new AdapterError('NOT_FOUND', 'no such batch');
    }
    return this.recipe;
  }

  // The write path belongs to bolt `006`. These are here so the stub
  // satisfies the port — the READERS never call them.
  async postConsumption(_consumption: RawConsumption): Promise<void> {
    throw new Error('postConsumption is not exercised by the readers');
  }

  async writeBatchStatus(
    _batchId: BatchId,
    _status: BatchStatusToWrite,
  ): Promise<void> {
    throw new Error('writeBatchStatus is not exercised by the readers');
  }
}
