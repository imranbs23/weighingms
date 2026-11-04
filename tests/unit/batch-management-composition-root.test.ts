/**
 * The batch management composition root.
 *
 * WHAT IS UNDER TEST
 * ------------------
 *   - the module wires the use case to the port it was given
 *   - the port is exposed, so the binding is discoverable
 *   - a failure's diagnostic reaches the bound error handler
 *   - the module works with NO error handler bound (the default path)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The composition root is where unit 001 and unit 005 meet (ADR-028), and
 * that meeting is the one thing in this bolt that could go wrong in a way
 * no other test would notice. So the binding is asserted directly: the
 * source the module was given IS the source the use case reads through.
 */
import { describe, it, expect } from 'vitest';
import {
  buildBatchManagementModule,
} from '../../src/001-batch-management/infrastructure/composition-root.js';
import { RetrieveBatchQueue } from '../../src/001-batch-management/application/use-cases/retrieve-batch-queue.js';
import { BatchQueueProjector } from '../../src/001-batch-management/domain/services/batch-queue-projector.js';
import type { BatchQueueSource } from '../../src/001-batch-management/domain/ports/batch-queue-source.js';
import type { BatchQueueReadOutcome } from '../../src/005-orgatex-integration/domain/services/batch-queue-reader.js';

/** A source a test drives directly. */
class StubSource implements BatchQueueSource {
  outcome: BatchQueueReadOutcome = {
    kind: 'FAILED',
    reason: 'UNREACHABLE',
    message: 'the seam is down',
  };
  reads = 0;

  async read(): Promise<BatchQueueReadOutcome> {
    this.reads += 1;
    return this.outcome;
  }
}

describe('the batch management composition root', () => {
  it('binds the use case to the source it was given', async () => {
    const source = new StubSource();
    const module = buildBatchManagementModule({ source });

    expect(module.retrieveBatchQueue).toBeInstanceOf(RetrieveBatchQueue);
    expect(module.projector).toBeInstanceOf(BatchQueueProjector);

    // The binding is the SAME source — so there is exactly one reader of
    // the seam, and a future second reader would be visible here.
    expect(module.queueSource).toBe(source);

    await module.retrieveBatchQueue.execute();
    expect(source.reads).toBe(1);
  });

  it('routes a failure\'s diagnostic to the bound error handler', async () => {
    const logged: string[] = [];
    const module = buildBatchManagementModule({
      source: new StubSource(),
      onError: (detail) => logged.push(detail),
    });

    await module.retrieveBatchQueue.execute();

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('UNREACHABLE');
    expect(logged[0]).toContain('the seam is down');
  });

  it('works with no error handler bound at all', async () => {
    const module = buildBatchManagementModule({ source: new StubSource() });

    const availability = await module.retrieveBatchQueue.execute();

    expect(availability.kind).toBe('UNAVAILABLE');
  });
});
