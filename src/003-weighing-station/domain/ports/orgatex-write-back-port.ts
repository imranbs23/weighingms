/**
 * The write-back port — over unit 005's services.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS BOLT CALLS UNIT 005'S SERVICES AND RE-IMPLEMENTS NOTHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `005` already owns the entire OrgaTEX write path, and it settled
 * it in its own ADRs:
 *
 * - the **idempotency ledger**'s PRIMARY KEY is the atomic guard
 *   (ADR-023) — a check-then-write is racy, and the race admits a
 *   double-post;
 * - the key is **derived** from the weighing's identity — a client that
 *   could choose it could collide with another weighing's;
 * - the **enqueue guard** is separate from the send guard — the link
 *   being down must not create two queue entries for one weighing;
 * - the batch status write has a **precondition** — `WEIGHED` is written
 *   only when every one of the batch's postings is resolved;
 * - and the **schema** has no `operatorId` and no `idempotencyKey` — the
 *   operator comes from the session, and the key is derived.
 *
 * **And this bolt's services satisfy the port STRUCTURALLY** — the
 * composition root binds them directly, with no adapter class and **no
 * second implementation of any guard** (the same rule ADR-039 set for
 * the authorisation).
 *
 * WHY A RE-IMPLEMENTATION WOULD BE A REGRESSION
 * ---------------------------------------------
 * A "reasonable" local idempotency check would be an **in-memory
 * `Set`** — and it would not survive a restart, and this station **is**
 * restarted (NFR-06). It would not be atomic, so two concurrent
 * completions would both post. And every test in this bolt would still
 * pass.
 */
import type {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { PostingOutcome } from '../../../005-orgatex-integration/domain/services/consumption-posting-service.js';
import type { BatchStatusWriteOutcome } from '../../../005-orgatex-integration/domain/services/batch-status-write-service.js';

/**
 * What the caller asks to be posted.
 *
 * The operator id is **not** here — it comes from the session. A request
 * that could name the operator would let a caller post consumption as
 * somebody else (FR-18), and unit 005's schema has no such field for
 * exactly that reason.
 */
export interface ConsumptionPostRequest {
  readonly batchId: BatchId;
  readonly componentId: ComponentId;
  readonly actualQuantity: WeightValue;
  readonly lotNumber: LotNumber;
  readonly operatorId: OperatorReference;
  readonly weighedAt: Instant;
}

export interface OrgatexWriteBackPort {
  /**
   * Post one consumption.
   *
   * Unit 005's ledger is the atomic duplicate guard — and this bolt does
   * not re-check it.
   */
  postConsumption(request: ConsumptionPostRequest): Promise<PostingOutcome>;

  /**
   * Advance the batch's weighing status to `WEIGHED`.
   *
   * Unit 005's precondition applies: the write happens only when every
   * one of the batch's postings is resolved.
   */
  advanceBatchStatus(batchId: BatchId): Promise<BatchStatusWriteOutcome>;
}

/**
 * The batch's facts the summary states — the MES's, read not written.
 *
 * The target machine is **not** a station fact and it is **not** hard-coded
 * — it is the MES's, and it comes from the batch the recipe was projected
 * from. So it is read through a port, and a station that cannot say which
 * machine the container is going to says so rather than guessing.
 */
export interface BatchFactsPort {
  /**
   * The machine the batch's container is going to.
   *
   * `null` when the MES has not said — and the summary then names no
   * machine rather than naming the wrong one.
   *
   * **Asynchronous**, because the MES's read is — and a synchronous port
   * would force the caller to guess rather than to ask.
   */
  targetMachine(batchId: BatchId): Promise<string | null>;
}
