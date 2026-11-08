/**
 * MaterialLotRepository — the durable record of a lot capture.
 *
 * ══════════════════════════════════════════════════════════════════════
 * APPEND-ONLY. NO UPDATE, NO DELETE. AND THE LOT IS NOT DE-DUPLICATED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A lot capture is a fact about something that physically happened
 * (BRD DR-02), so there is no update path and no delete path here — and
 * the database's triggers are the second line of the same guarantee
 * (ADR-029, ADR-034).
 *
 * **THE LOT IS NOT DE-DUPLICATED.** The story is explicit: *"the same lot
 * number is captured for two different components → both captures are
 * stored; a lot may legitimately serve several components and is not
 * de-duplicated."*
 *
 * A `UNIQUE` constraint on the lot number would be the wrong shape twice
 * over: it would refuse a legitimate second capture, and it would make the
 * lot number a **key** — a claim that the lot identifies one component,
 * which is false.
 *
 * THE EFFECTIVE CAPTURE IS THE NEWEST ROW
 * -----------------------------------------
 * `captured_at DESC, id DESC` — a **total** order, so "the latest" has
 * exactly one answer. And the superseded capture is **retained**, which is
 * what the story requires.
 */
import type { MaterialLotCapture } from '../entities/material-lot-capture.js';
import type { ComponentId } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

export interface MaterialLotRepository {
  /**
   * Record a lot capture.
   *
   * INSERT ONLY. The row's identifier is the **insertion sequence**, and it
   * is what breaks a tie when two captures land in the same millisecond.
   */
  save(capture: MaterialLotCapture): Promise<void>;

  /**
   * The newest capture for a component — the effective one.
   *
   * `null` when no lot has been captured yet. An uncaptured component is a
   * **state**, not an error.
   */
  latestFor(componentId: ComponentId): Promise<MaterialLotCapture | null>;
}
