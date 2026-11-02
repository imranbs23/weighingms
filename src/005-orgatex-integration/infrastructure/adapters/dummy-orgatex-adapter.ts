/**
 * DummyOrgatexAdapter — the training MES, behind the IR-07 port.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS IS THE LINE THAT CHANGES WHEN FCI ANSWERS `Q-01`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * When FCI confirms the MES's protocol, this class is replaced by one that
 * speaks it. Nothing else in the product changes: the readers, the cache,
 * the eligibility rule, the controller and every consumer of unit `005`
 * keep their contracts.
 *
 * THE ADAPTER IS IN-PROCESS, AND THAT IS A DECISION (ADR-022)
 * -----------------------------------------------------------
 * The adapter does **not** call the Dummy MES's HTTP router. It holds the
 * same world directly.
 *
 * The reason is the tests: the domain rules are where the risk is, and a
 * socket in every read test is a liability with no return. The trade is
 * that **the adapter's transport is not exercised by this bolt's tests** —
 * a timeout, a TLS failure and a retry storm live in the transport, and the
 * transport is untested until a real adapter exists.
 *
 * That gap is stated in the ADR, in the design and in the test report. It
 * is not an oversight.
 *
 * NO PROTOCOL IS ASSERTED
 * -----------------------
 * The MES's interface is unconfirmed (`Q-01`), so this class asserts no
 * endpoint, no payload field and no wire format as fact. It is a training
 * device that produces the port's contract.
 */
import {
  AdapterError,
  AdapterRejection,
  type BatchStatusFilter,
  type BatchStatusToWrite,
  type OrgatexAdapter,
  type RawConsumption,
  type RawQueue,
  type RawRecipe,
} from '../../domain/ports/orgatex-adapter.js';
import type { BatchId } from '../../domain/value-objects/identifiers.js';
import { RejectionReason } from '../../domain/value-objects/rejection-reason.js';
import { DummyOrgatexWorld } from './dummy-orgatex-data.js';

export class DummyOrgatexAdapter implements OrgatexAdapter {
  constructor(
    private readonly world: DummyOrgatexWorld,
    /** The name this adapter reports as the snapshot's source. */
    readonly sourceName: string = 'DUMMY_ORGATEX',
  ) {}

  /** The world behind this adapter — for the Dummy MES's HTTP router. */
  get mes(): DummyOrgatexWorld {
    return this.world;
  }

  async readQueue(filter?: BatchStatusFilter): Promise<RawQueue> {
    this.assertReachable();
    return this.world.readQueue(filter);
  }

  async readRecipe(batchId: BatchId): Promise<RawRecipe> {
    this.assertReachable();

    const recipe = this.world.readRecipe(batchId.value);
    if (recipe === null) {
      // The MES was REACHED and it has no such batch. That is a `404`,
      // not a failure of the link (the "404 only from a successful
      // contact" rule).
      throw new AdapterError(
        'NOT_FOUND',
        `The MES has no recipe for batch ${batchId.value}`,
      );
    }

    return recipe;
  }

  /**
   * Post one consumption.
   *
   * The Dummy MES **does not deduplicate** — it accepts everything it is
   * given. That is deliberate: ADR-025 makes the **local** ledger the
   * guarantee, and no claim is made that the MES understands the key
   * (Q-02). A Dummy that deduplicated would hide the very failure the
   * ledger exists to prevent.
   */
  async postConsumption(consumption: RawConsumption): Promise<void> {
    this.assertReachable();

    if (this.world.rejectsConsumption) {
      // A DEFINITIVE refusal — the MES was reached and it said no. That
      // advances the posting's state to REJECTED, which an unreachable
      // MES never does.
      throw new AdapterRejection(
        RejectionReason.of('BATCH_NOT_POSTABLE', 'The Dummy MES was told to refuse consumptions'),
        'The Dummy OrgaTEX refused the consumption',
      );
    }

    this.world.postConsumption(consumption);
  }

  /**
   * Advance a batch's weighing status.
   *
   * Only the weighing status may be changed — the method takes a status,
   * not a batch (BRD IR-06, C-01).
   */
  async writeBatchStatus(
    batchId: BatchId,
    status: BatchStatusToWrite,
  ): Promise<void> {
    this.assertReachable();

    if (this.world.rejectsStatusWrite) {
      throw new AdapterRejection(
        RejectionReason.of('BATCH_NOT_POSTABLE', 'The Dummy MES was told to refuse status writes'),
        'The Dummy OrgaTEX refused the status write',
      );
    }

    const written = this.world.writeBatchStatus(batchId.value, status);
    if (!written) {
      throw new AdapterRejection(
        RejectionReason.of('BATCH_NOT_POSTABLE', `The Dummy MES has no batch ${batchId.value}`),
        `The Dummy OrgaTEX refused the status write for ${batchId.value}`,
      );
    }
  }

  /**
   * Refuse the read when the MES is unreachable.
   *
   * The reason is `UNREACHABLE`, which is what drives the reader's
   * `DEGRADED` fallback — and what a test flips to exercise it.
   */
  private assertReachable(): void {
    if (!this.world.isReachable) {
      throw new AdapterError(
        'UNREACHABLE',
        'The Dummy OrgaTEX is unreachable',
      );
    }
  }
}
