/**
 * The OrgaTEX write-back adapter.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SHIM OVER UNIT 005'S SERVICES. AND IT ADDS NO GUARD.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `005`'s `ConsumptionPostingService` and `BatchStatusWriteService`
 * already implement the whole write path — the idempotency ledger, the
 * enqueue guard, the derived key, the status write's precondition, and
 * the failure taxonomy.
 *
 * **So this shim does exactly one thing: it maps the port's shape onto
 * unit 005's.** It adds **no** guard of its own, because a second
 * implementation of a check is the failure ADR-039 and ADR-041 both
 * describe — correct in every branch, and a compliance regression.
 *
 * AND THE BATCH'S FACTS COME FROM THE SAME PLACE
 * ----------------------------------------------
 * The target machine is the MES's, and the MES's released-batch queue is
 * where it lives — so it is read through unit `005`'s own queue reader,
 * and a batch the MES has not said about names **no** machine rather than
 * the wrong one.
 */
import { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { ConsumptionPostingService } from '../../../005-orgatex-integration/domain/services/consumption-posting-service.js';
import type { BatchStatusWriteService } from '../../../005-orgatex-integration/domain/services/batch-status-write-service.js';
import type { SyncQueueService } from '../../../005-orgatex-integration/domain/services/sync-queue-service.js';
import type { BatchQueueReader } from '../../../005-orgatex-integration/domain/services/batch-queue-reader.js';
import type {
  BatchFactsPort,
  OrgatexWriteBackPort,
} from '../../domain/ports/orgatex-write-back-port.js';

export class OrgatexWriteBackAdapter implements OrgatexWriteBackPort {
  constructor(
    private readonly postings: ConsumptionPostingService,
    private readonly statusWrites: BatchStatusWriteService,
    /**
     * Unit 005's durable sync queue. A posting the MES could not take is
     * QUEUED by the posting service, and must also be ENQUEUED here — the
     * same two steps the HTTP route takes — or the retry worker never sees
     * it and the write-back stays PENDING for ever (found by Step 30).
     */
    private readonly syncQueue?: SyncQueueService,
  ) {}

  /**
   * Post one consumption.
   *
   * **Straight through** — unit 005's ledger is the guard, and this does
   * not re-check it.
   */
  async postConsumption(
    request: Parameters<ConsumptionPostingService['post']>[0],
  ): Promise<
    Awaited<ReturnType<ConsumptionPostingService['post']>>
  > {
    const outcome = await this.postings.post(request);
    if (outcome.kind === 'QUEUED') {
      // The queue's own enqueue guard refuses a second entry for one key.
      await this.syncQueue?.enqueue(outcome.posting);
    }
    return outcome;
  }

  /**
   * Advance the batch's weighing status to `WEIGHED`.
   *
   * **Straight through** — unit 005's precondition applies unchanged.
   */
  async advanceBatchStatus(
    batchId: BatchId,
  ): Promise<
    Awaited<ReturnType<BatchStatusWriteService['advanceToWeighed']>>
  > {
    return this.statusWrites.advanceToWeighed(batchId);
  }
}

/**
 * The batch's facts, read from the MES's released-batch queue.
 */
export class OrgatexBatchFactsAdapter implements BatchFactsPort {
  constructor(private readonly queueReader: BatchQueueReader) {}

  /**
   * The machine the batch's container is going to.
   *
   * `null` when the MES has not released the batch — and the summary then
   * names no machine rather than the wrong one.
   */
  async targetMachine(batchId: BatchId): Promise<string | null> {
    const outcome = await this.queueReader.read();

    if (outcome.kind === 'FAILED') {
      // The MES could not be reached, or answered unusably. The station
      // does not know the machine — and it says so.
      return null;
    }

    // Both `SUCCEEDED` and `SUCCEEDED_STALE` carry a snapshot — and a
    // stale one is the last known-good, which is served **with its age**
    // by unit 005 (ADR-021). The machine it names is the machine the MES
    // last said, which is the best the station knows.
    const batch = outcome.snapshot.batches.find(
      (candidate) => candidate.batchId.value === batchId.value,
    );
    return batch === undefined ? null : batch.machineRef.value;
  }
}
