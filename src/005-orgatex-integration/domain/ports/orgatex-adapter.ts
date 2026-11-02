/**
 * OrgatexAdapter — THE SEAM (BRD IR-07).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS INTERFACE IS THE WHOLE CONTRACT WITH THE MES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `A-01` assumes SETEX provides a documented, licensed REST interface, and
 * `Q-01` asks whether such an interface exists at all, and of what kind.
 * The BRD's own endpoint list is marked *"assumed endpoint shape —
 * illustrative, for FCI/SETEX to correct"*.
 *
 * So nothing above this port may name an endpoint, a payload field or a
 * wire format. What crosses the boundary is a **raw** structure — the MES's
 * own fields, untyped by this domain — and the reader validates and
 * constructs the domain snapshot above it.
 *
 * WHY THE PORT RETURNS RAW RECORDS AND NOT DOMAIN ENTITIES
 * --------------------------------------------------------
 * If the adapter returned domain entities, two things would follow, and
 * both are bad.
 *
 * First, every change to this domain's model would ripple into the
 * adapter — and the adapter is the one class that is about to change when
 * FCI answers `Q-01`.
 *
 * Second, and worse, the **validation would live in the adapter** — the one
 * place whose shape is least stable. A malformed MES record must fail the
 * WHOLE read (S-24), and that rule belongs to the reader, where it can be
 * tested without a MES.
 *
 * WHY THE WRITE METHODS ARE HERE
 * ------------------------------
 * Bolt `005` was read-only, and the port said so structurally rather than by
 * convention — it carried no write method at all. Bolt `006` is the write
 * path, and the port grows `postConsumption` and `writeBatchStatus`.
 *
 * The read-only discipline was real while it lasted: a read-only port that
 * already carried a write method would have been a port whose discipline
 * rested on nobody checking.
 */
import type { BatchId } from '../value-objects/identifiers.js';
import type { BatchWeighingStatus } from '../value-objects/batch-weighing-status.js';
import type { RejectionReason } from '../value-objects/rejection-reason.js';

/**
 * The only batch status this seam writes.
 *
 * A **narrower** type than `BatchWeighingStatus`, on purpose. The MES
 * knows five statuses; this unit writes exactly one — `WEIGHED`, on
 * batch completion (BRD IR-06).
 *
 * The narrowing is the enforcement: a caller cannot pass `QUEUED` or
 * `CANCELLED` to the write method, because the type does not admit it.
 */
export type BatchStatusToWrite = Extract<BatchWeighingStatus, 'WEIGHED'>;

/** The MES's filter over the queue. */
export type BatchStatusFilter = BatchWeighingStatus;

/**
 * A batch as the MES's payload describes it.
 *
 * Every field is the MES's, not ours. `componentCount` is a number because
 * it is a **count**, not a quantity — ADR-008's rule is about weights,
 * targets and tolerances.
 */
export interface RawBatch {
  readonly batchId: string;
  readonly orderRef: string;
  readonly machineRef: string;
  readonly fabricDescription: string;
  readonly shadeCode: string;
  readonly componentCount: number;
  readonly weighingStatus: string;
}

/** The queue, as the MES's payload describes it. */
export interface RawQueue {
  readonly batches: readonly RawBatch[];
}

/** A recipe component, as the MES's payload describes it. */
export interface RawComponent {
  readonly sequence: number;
  readonly componentId: string;
  readonly dyestuffCode: string;
  /** The target as a **decimal string** — never a JSON number (ADR-008). */
  readonly target: string;
  readonly unit: string;
  /** The band's lower bound, or null when the MES gives no tolerance. */
  readonly toleranceMin: string | null;
  /** The band's upper bound, or null when the MES gives no tolerance. */
  readonly toleranceMax: string | null;
  readonly scaleClass: string;
}

/** A recipe, as the MES's payload describes it. */
export interface RawRecipe {
  readonly batchId: string;
  readonly shadeCode: string;
  readonly components: readonly RawComponent[];
}

/**
 * Why a contact with the MES did not produce a snapshot.
 *
 * A CLOSED SET, and the same set appears in the API response, in the
 * domain event and in the log — so one vocabulary, three places.
 *
 * `NOT_FOUND` is a reason but **not a failure**: the MES was reached and
 * said there is no such batch, which produces a `404` and not a `503`.
 */
export type AdapterFailureReason =
  | 'UNREACHABLE'
  | 'MALFORMED'
  | 'TIMEOUT'
  | 'NOT_FOUND';

export const ADAPTER_FAILURE_REASONS: readonly AdapterFailureReason[] = [
  'UNREACHABLE',
  'MALFORMED',
  'TIMEOUT',
  'NOT_FOUND',
];

/**
 * A contact that did not produce a snapshot — or did not land a write.
 *
 * The `message` is for the **log**, never for the client (BRD IR-09). The
 * API response carries the `reason` code and nothing else.
 */
export class AdapterError extends Error {
  constructor(
    readonly reason: AdapterFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

/**
 * A rejection by the MES.
 *
 * Distinct from `AdapterError`: the MES was **reached** and **refused**.
 * That is a definitive answer, and it advances the posting's state to
 * `REJECTED` — which an `AdapterError` does not.
 */
export class AdapterRejection extends Error {
  constructor(
    readonly reason: RejectionReason,
    message: string,
  ) {
    super(message);
    this.name = 'AdapterRejection';
  }
}

/**
 * A consumption, as the MES's payload describes it.
 *
 * Every quantity is a **decimal string** — never a JSON number
 * (ADR-008). The MES's own shape is not asserted as fact (Q-01), so
 * these are the raw fields the seam exchanges, not a claim about the
 * real interface.
 */
export interface RawConsumption {
  readonly batchId: string;
  readonly componentId: string;
  readonly actualQuantity: string;
  readonly unit: string;
  readonly lotNumber: string;
  readonly operatorId: string;
  readonly weighedAt: string;
  /** The idempotency key, carried on the request. */
  readonly idempotencyKey: string;
}

/**
 * The port.
 *
 * Every method is `async` because the real adapter will be. The Dummy
 * adapter resolves immediately, and the domain does not know the
 * difference.
 */
export interface OrgatexAdapter {
  /**
   * The released queue.
   *
   * @param filter  Optional status filter (BRD IR-01). When absent, the
   *                MES's own default applies.
   * @throws {AdapterError} with `reason: 'UNREACHABLE' | 'MALFORMED' | 'TIMEOUT'`
   */
  readQueue(filter?: BatchStatusFilter): Promise<RawQueue>;

  /**
   * A batch's recipe.
   *
   * @throws {AdapterError} with `reason: 'NOT_FOUND'` when the MES was
   *         reached and has no such batch — a `404`, not a failure.
   */
  readRecipe(batchId: BatchId): Promise<RawRecipe>;

  /**
   * Post one consumption.
   *
   * The idempotency key is carried on the request — but **no claim is
   * made that the MES understands it** (ADR-025, Q-02). The local ledger
   * is the guarantee; the MES's own deduplication, if it has any, is a
   * second line of defence.
   *
   * @throws {AdapterRejection} when the MES **reached** and **refused** —
   *         a definitive answer.
   * @throws {AdapterError} with `reason: 'UNREACHABLE' | 'TIMEOUT'` when
   *         the outcome is **unknown**.
   */
  postConsumption(consumption: RawConsumption): Promise<void>;

  /**
   * Advance a batch's weighing status.
   *
   * ══════════════════════════════════════════════════════════════════
   * THE SIGNATURE IS THE ENFORCEMENT.
   * ══════════════════════════════════════════════════════════════════
   *
   * It takes a **status**, not a batch. There is no parameter through
   * which another OrgaTEX batch field could be altered, so BRD IR-06 and
   * C-01 are expressed in a type rather than in a convention that a
   * future caller could forget.
   *
   * @throws {AdapterRejection} when the MES **reached** and **refused**.
   * @throws {AdapterError} with `reason: 'UNREACHABLE' | 'TIMEOUT'` when
   *         the outcome is **unknown**.
   */
  writeBatchStatus(batchId: BatchId, status: BatchStatusToWrite): Promise<void>;
}
