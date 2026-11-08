/**
 * MaterialLotCapture — the supplier lot used against a component.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A FACT ABOUT THE PAST, AND THEREFORE IMMUTABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"At 08:15:03, operator OP-001 captured lot 2026-0387 for component
 * DYE-4471-Y by scanning the container"* is a fact about something that
 * physically happened. BRD DR-02 requires that it not be revised, and the
 * story requires that a superseded capture be **retained** rather than
 * deleted.
 *
 * So this class exposes **no mutator**, and the table is append-only. The
 * effective capture is the **newest row** (ADR-034).
 *
 * THE METHOD IS DERIVED, NEVER SUPPLIED
 * -------------------------------------
 * `SOURCE` means OrgaTEX held the lot and the station read it through the
 * adapter — and it has **no client request shape at all**. `SCAN` and
 * `KEYED_IN` are derived from the request's shape.
 *
 * THE LOT IS AN IDENTIFIER, NEVER A QUANTITY
 * -------------------------------------------
 * The story is explicit: *"the lot identifier embeds a quantity-like token,
 * it is not converted to a number and never to a float"* (BRD NFR-16). So
 * the lot is a **string**, held as text, with its source format preserved.
 * `LotNumber` is unit `005`'s bounded, trimmed identifier — reused, not
 * redefined.
 *
 * AND THE MATERIAL CODE IS COPIED
 * -------------------------------
 * The capture is against the **component**, and the material code is copied
 * alongside it — so a later read does not have to re-derive which material
 * the lot belonged to, and the record stays meaningful if the recipe has
 * moved on. The same reasoning unit `001`'s selection used for the order
 * and the machine (BRD FR-34).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type {
  ComponentId,
  DyestuffCode,
  LotNumber,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import type { CaptureMethod } from '../value-objects/capture-method.js';

export class MaterialLotCapture {
  constructor(
    /** The recipe slot this lot was captured against. */
    readonly componentId: ComponentId,
    /** The supplier's lot — an identifier, never a quantity. */
    readonly lotNumber: LotNumber,
    /** The material the lot belongs to. */
    readonly materialCode: DyestuffCode,
    /** Where the lot came from. */
    readonly captureMethod: CaptureMethod,
    /** Who captured it — from the session. */
    readonly capturedBy: OperatorId,
    /** **When the capture happened.** */
    readonly capturedAt: Instant,
  ) {}
}
