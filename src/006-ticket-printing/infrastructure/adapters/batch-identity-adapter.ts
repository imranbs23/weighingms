/**
 * The batch identity and the configuration — the adapters.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE IDENTITY IS THE MES's. AND THE TEMPLATE IS CONFIGURATION's.
 * ══════════════════════════════════════════════════════════════════════
 *
 * **The batch's identity** — the order reference, the machine reference
 * and the shade — are the MES's facts, and they are **read** through unit
 * `005`'s released-batch queue. So the ticket carries what the MES said,
 * and the station does not invent it.
 *
 * **And the configuration** — the template id and the language — are
 * **story `005`'s** business. This bolt **records** them on the ticket and
 * does not define them.
 *
 * **AND THE TEMPLATE'S CONTENT IS NOT INVENTED HERE.** The prototype
 * itself states that label content is invented, so Q-11 and Q-12 remain
 * open, and *"no story, test or seed data may assert a specific physical
 * label layout as fact"* (BRD IR-16).
 */
import { BatchId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { BatchQueueReader } from '../../../005-orgatex-integration/domain/services/batch-queue-reader.js';
import type {
  BatchIdentityPort,
  TicketConfigurationPort,
} from '../../domain/ports/ticket-ports.js';
import type { TicketBatchIdentity } from '../../domain/entities/ticket.js';

/**
 * The batch's identity, read from the MES's released-batch queue.
 */
export class OrgatexBatchIdentityAdapter implements BatchIdentityPort {
  constructor(private readonly queueReader: BatchQueueReader) {}

  /**
   * The batch's identity — `null` when the MES has not said.
   */
  async identity(batchId: string): Promise<TicketBatchIdentity | null> {
    const outcome = await this.queueReader.read();

    if (outcome.kind === 'FAILED') {
      // The MES could not be reached. The station does not know the
      // batch's identity — and it says so rather than guessing.
      return null;
    }

    const batch = outcome.snapshot.batches.find(
      (candidate) => candidate.batchId.value === batchId,
    );
    if (batch === undefined) return null;

    const identity: TicketBatchIdentity = {
      batchId: batch.batchId.value,
      orderRef: batch.orderRef.value,
      machineRef: batch.machineRef.value,
      shadeCode: batch.shadeCode.value,
    };
    return identity;
  }
}

/**
 * The ticket's configuration — the template and the language.
 *
 * **A DEFAULT, and it is honest about it.** The configuration is story
 * `005`'s business, and this bolt runs before it. So the default is a
 * named template and the station's language — **not** an invented layout,
 * and **not** a claim that any particular label format is right.
 */
export class DefaultTicketConfiguration implements TicketConfigurationPort {
  constructor(
    private readonly templateIdValue: string = 'DEFAULT',
    private readonly languageValue: string = 'en',
  ) {}

  /** The template id to render with — **captured** on the ticket. */
  templateId(): string {
    return this.templateIdValue;
  }

  /** The language to render in — **captured** on the ticket. */
  language(): string {
    return this.languageValue;
  }
}

/**
 * The batch id's value object — for callers that hold a string.
 */
export function batchIdOf(batchId: string): BatchId {
  return BatchId.create(batchId);
}
