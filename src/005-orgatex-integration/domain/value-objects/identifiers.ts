/**
 * The identifier value objects of the OrgaTEX seam.
 *
 * Every one of them is **opaque** to this unit. The seam parses the MES's
 * field names; it does not interpret what they mean. `BatchId` does not
 * parse the `B-` prefix, and `DyestuffCode` does not know what a dyestuff
 * is — that is unit `002`'s master data.
 *
 * WHY THEY ARE ALL IN ONE FILE
 * -----------------------------
 * They are one idea — "a bounded, trimmed, non-empty identifier" — and the
 * scale unit's `ComponentId` shows the alternative: a file per identifier
 * for a type with four lines of behaviour. They are grouped here so the
 * shared behaviour is shared in the code, not just in the convention.
 *
 * THE BOUND
 * ---------
 * Each identifier arrives from a request path, a query string or a MES
 * payload, and it ends up in a log line, an event payload and — in later
 * bolts — a database key. An unbounded string is an unbounded thing to carry
 * in all three. 64 characters is well past any real OrgaTEX identifier and
 * well short of anything that could be used to push a log around.
 */
import { ComponentId } from '../../../004-scale-integration/domain/value-objects/component-id.js';

export { ComponentId };

/** The maximum length of any identifier on this seam. */
const MAX_IDENTIFIER_LENGTH = 64;

/**
 * A shared, bounded identifier.
 *
 * The factory is the only way in, and it is the only place the rules live.
 */
function boundedIdentifier(raw: string, label: string): string {
  const value = raw.trim();
  if (value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${label} must not exceed ${MAX_IDENTIFIER_LENGTH} characters`);
  }
  return value;
}

/** The MES's batch identifier — `B-24187`. */
export class BatchId {
  private constructor(readonly value: string) {}

  static create(raw: string): BatchId {
    return new BatchId(boundedIdentifier(raw, 'BatchId'));
  }

  equals(other: BatchId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/** The sales or production order reference — `SO-9931`. */
export class OrderRef {
  private constructor(readonly value: string) {}

  static create(raw: string): OrderRef {
    return new OrderRef(boundedIdentifier(raw, 'OrderRef'));
  }

  equals(other: OrderRef): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/** The target machine — `JET-04`. */
export class MachineRef {
  private constructor(readonly value: string) {}

  static create(raw: string): MachineRef {
    return new MachineRef(boundedIdentifier(raw, 'MachineRef'));
  }

  equals(other: MachineRef): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/** The shade — `Teal 4C`. */
export class ShadeCode {
  private constructor(readonly value: string) {}

  static create(raw: string): ShadeCode {
    return new ShadeCode(boundedIdentifier(raw, 'ShadeCode'));
  }

  equals(other: ShadeCode): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * The dyestuff's master code — `DYE-1180`.
 *
 * NOT the same thing as `ComponentId`. The dyestuff code is *what the
 * material is*; the component id is *this slot in this recipe*. Unit
 * `002`'s identity verification compares a scanned barcode against the
 * DYESTUFF, not against the recipe slot — so the two must not collapse.
 */
export class DyestuffCode {
  private constructor(readonly value: string) {}

  static create(raw: string): DyestuffCode {
    return new DyestuffCode(boundedIdentifier(raw, 'DyestuffCode'));
  }

  equals(other: DyestuffCode): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * The dye lot the consumption came from — `L-77120`.
 *
 * Opaque — this unit does not interpret lot formats, because the MES
 * owns them.
 */
export class LotNumber {
  private constructor(readonly value: string) {}

  static create(raw: string): LotNumber {
    return new LotNumber(boundedIdentifier(raw, 'LotNumber'));
  }

  equals(other: LotNumber): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * The operator who weighed it — the badge id.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A REFERENCE, NOT A COPY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This holds the identity unit's `OperatorId` and **nothing else** — no
 * display name, no role, no session.
 *
 * A copy of the operator would be a second source of truth for who a
 * person is, and it would drift the moment the person was renamed. The
 * MES's consumption record needs to say *who* weighed it (BRD IR-10,
 * FR-18), and the badge id is what FCI's own records use.
 */
export class OperatorReference {
  private constructor(readonly value: string) {}

  static create(raw: string): OperatorReference {
    return new OperatorReference(
      boundedIdentifier(raw, 'OperatorReference'),
    );
  }

  equals(other: OperatorReference): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
