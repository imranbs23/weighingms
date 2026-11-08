/**
 * TareEstablishmentPolicy — how the tare is obtained.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE MASTER'S TARE, OR THE EMPTY CONTAINER ON THE SCALE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story names two routes, and the rule is short:
 *
 * 1. **The master holds a tare for this container** → that tare is
 *    applied, with the source `CONTAINER_MASTER`.
 * 2. **The master holds none** → the empty container must be **weighed**,
 *    with the source `WEIGHED_EMPTY_CONTAINER`.
 *
 * AND THE MASTER IS LOSABLE
 * -------------------------
 * The story's edge case: *"the container master holds a tare but the
 * operator re-tares → the measured tare replaces the master tare and the
 * displayed source changes from `MASTER` to `MEASURED`."*
 *
 * So a re-tare is not "the master again" — it is **the measured tare**,
 * and the source changes. A measured tare is **evidence** where the
 * master's is a **claim**, and evidence beats a claim.
 *
 * THE POLICY IS PURE
 * ------------------
 * It decides **which route**, and it does not touch the device. The device
 * work — the reading, the gate, the conversion, the mechanism — belongs to
 * unit `004`'s registry, and this unit asks it through a port.
 */
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { TareSource } from '../../../004-scale-integration/domain/value-objects/tare-source.js';
import type { Container } from '../entities/container.js';

/** Which route the tare is established by. */
export type TareRoute =
  | {
      readonly kind: 'FROM_MASTER';
      readonly tareWeight: WeightValue;
      readonly source: TareSource;
    }
  | {
      /**
       * The container must be **weighed empty**.
       *
       * The measured value is the **scale's** reading, not a client's
       * number — so the policy names the route, and the measurement comes
       * from the device.
       */
      readonly kind: 'MEASURE_EMPTY_CONTAINER';
      readonly source: TareSource;
    };

export class TareEstablishmentPolicy {
  /**
   * Which route does this container's tare take?
   *
   * @param container The master record.
   * @param reTare Is the operator re-taring an already-assigned container?
   *   A re-tare always **measures**, because evidence beats a claim.
   */
  route(container: Container, reTare: boolean): TareRoute {
    if (reTare) {
      return {
        kind: 'MEASURE_EMPTY_CONTAINER',
        source: 'WEIGHED_EMPTY_CONTAINER',
      };
    }

    if (container.tareWeight !== null) {
      return {
        kind: 'FROM_MASTER',
        tareWeight: container.tareWeight,
        source: 'CONTAINER_MASTER',
      };
    }

    return {
      kind: 'MEASURE_EMPTY_CONTAINER',
      source: 'WEIGHED_EMPTY_CONTAINER',
    };
  }
}
