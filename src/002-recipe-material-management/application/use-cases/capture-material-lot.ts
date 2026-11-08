/**
 * CaptureMaterialLot — recording the supplier lot against a component.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THREE ROUTES, ONE OPERATION, DIFFERENT EVIDENCE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * **CQ-08 is unanswered.** Whether containers carry a lot barcode or the lot
 * is keyed in is FCI's question, and the two answers turn FR-5 into
 * different products. So all three routes are the same operation with
 * different evidence, and the question can be settled without a rewrite:
 *
 * | Route | The method | Where the value came from |
 * |---|---|---|
 * | The MES held the lot | `SOURCE` | the adapter — **no client request exists** |
 * | The operator scanned it | `SCAN` | the scanner — derived from the body's shape |
 * | The operator keyed it in | `KEYED_IN` | the request — derived from the body's shape |
 *
 * THE MES'S LOT WINS, AND IS NOT OVERWRITTEN
 * ------------------------------------------
 * The story's first edge case: *"OrgaTEX returns a lot for the component
 * but the operator believes it is wrong → the upstream value is displayed as
 * `SOURCE`; correcting a source-held lot is an upstream data matter and is
 * not silently overwritten locally."*
 *
 * So when the MES holds a lot, that lot is captured as `SOURCE` and the
 * operator's value is **not** used. The operator's disagreement is a data
 * matter for the MES's owner, and this station does not silently overrule
 * the system of record.
 *
 * AND THE OPERATOR'S PATHS REMAIN AVAILABLE DURING AN OUTAGE
 * ---------------------------------------------------------
 * The story's last edge case: *"the upstream system is unreachable and the
 * lot must be scanned → the scan or keyed-in path remains available, and the
 * capture method records that the lot was not source-held."*
 *
 * So `UNAVAILABLE` from the master is **not** a refusal. The operator's
 * value is captured, with the method `SCAN` or `KEYED_IN` — and the
 * method itself is the record that the lot was not source-held.
 *
 * A REFUSAL WRITES NOTHING
 * -----------------------
 * The refusal path returns before the repository is touched, so the history
 * contains only captures that happened (ADR-034).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import {
  DyestuffCode,
  LotNumber,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { MaterialLotCapture } from '../../domain/entities/material-lot-capture.js';
import type { Recipe } from '../../domain/entities/recipe.js';
import type { MaterialLotRepository } from '../../domain/ports/material-lot-repository.js';
import type { DyestuffMasterSource } from '../../domain/ports/dyestuff-master-source.js';
import { LotValidator } from '../../domain/services/lot-validator.js';
import { RecipeWorkingCopy } from '../../domain/services/recipe-working-copy.js';
import type { CaptureMethod } from '../../domain/value-objects/capture-method.js';

export type CaptureLotOutcome =
  | {
      readonly kind: 'CAPTURED';
      readonly capture: MaterialLotCapture;
    }
  | {
      /** The lot was empty — nothing is stored. */
      readonly kind: 'EMPTY_LOT';
      readonly message: string;
    }
  | {
      /**
       * The lot was longer than the bound — nothing is stored, and it is
       * **not** truncated.
       */
      readonly kind: 'LOT_TOO_LONG';
      readonly message: string;
      readonly maximum: number;
    }
  | {
      /**
       * The MES holds no lot for this component.
       *
       * **Not an error** — it is the normal case for the operator's paths,
       * and the caller uses it to offer the scan and keyed-in routes.
       */
      readonly kind: 'NO_SOURCE_LOT';
      readonly message: string;
    }
  | {
      /**
       * The MES could not be reached.
       *
       * Also **not an error** — the operator's paths remain available
       * (BRD FR-20), and the capture method records that the lot was not
       * source-held.
       */
      readonly kind: 'SOURCE_UNAVAILABLE';
      readonly reason: 'UNREACHABLE' | 'TIMEOUT';
      readonly message: string;
    }
  | {
      /** The recipe holds no such component. */
      readonly kind: 'UNKNOWN_COMPONENT';
      readonly message: string;
    };

export interface CaptureMaterialLotOptions {
  /** The working copy — where the recipe being worked is held. */
  readonly workingCopy: RecipeWorkingCopy;
  /** Where the MES's own lot is read from. */
  readonly master: DyestuffMasterSource;
  /** Where the capture is recorded. */
  readonly lots: MaterialLotRepository;
  /** The validator. */
  readonly validator: LotValidator;
  /** The clock — the capture is timestamped. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. The detail never reaches the client. */
  readonly onError?: (detail: string) => void;
}

export class CaptureMaterialLot {
  constructor(private readonly options: CaptureMaterialLotOptions) {}

  /**
   * Capture the lot the **MES holds** for a component.
   *
   * The method is `SOURCE`, and there is **no client shape that produces
   * it** — this is the station reading the system of record, not the client
   * asserting something.
   */
  async captureFromSource(
    componentId: string,
    operatorId: OperatorId,
  ): Promise<CaptureLotOutcome> {
    const component = this.findComponent(componentId);
    if (component === null) {
      return this.unknownComponent(componentId);
    }

    const lookup = await this.options.master.readLot(component.componentId);

    if (lookup.kind === 'UNAVAILABLE') {
      // The MES could not be reached. The operator's paths remain
      // available — this is not a refusal.
      this.options.onError?.(
        `[material-lot] the MES is unavailable (${lookup.reason}): ${lookup.message}`,
      );
      return {
        kind: 'SOURCE_UNAVAILABLE',
        reason: lookup.reason,
        message: lookup.message,
      };
    }

    if (lookup.kind === 'NO_LOT') {
      // The MES holds no lot. Not a failure — the operator's paths apply.
      this.options.onError?.(
        `[material-lot] the MES holds no lot for component ${component.componentId.value}`,
      );
      return {
        kind: 'NO_SOURCE_LOT',
        message: 'The MES holds no lot for this component',
      };
    }

    const validation = this.options.validator.validate(lookup.lotNumber);
    if (validation.kind !== 'VALID') {
      // The MES's own lot failed the presence-and-format check. That is
      // the MES's bad data, and it is refused rather than stored.
      this.options.onError?.(
        `[material-lot] the MES's lot for component ${component.componentId.value} is unusable`,
      );
      return {
        kind: 'EMPTY_LOT',
        message: 'The MES holds an unusable lot for this component',
      };
    }

    return this.record(
      component.componentId,
      component.dyestuffCode,
      validation.lotNumber.value,
      'SOURCE',
      operatorId,
    );
  }

  /**
   * Capture a lot the **operator keyed in**.
   *
   * The method is `KEYED_IN` — derived from the request's shape.
   */
  async captureKeyedIn(
    componentId: string,
    lotNumber: string,
    operatorId: OperatorId,
  ): Promise<CaptureLotOutcome> {
    return this.captureFromOperator(
      componentId,
      lotNumber,
      'KEYED_IN',
      operatorId,
    );
  }

  /**
   * Capture a lot the **operator scanned**.
   *
   * The method is `SCAN` — derived from the request's shape.
   */
  async captureScanned(
    componentId: string,
    lotNumber: string,
    operatorId: OperatorId,
  ): Promise<CaptureLotOutcome> {
    return this.captureFromOperator(
      componentId,
      lotNumber,
      'SCAN',
      operatorId,
    );
  }

  /**
   * The effective capture for a component — the newest one.
   *
   * `null` when no lot has been captured yet. An uncaptured component is a
   * **state**, not an error.
   */
  async current(componentId: string): Promise<MaterialLotCapture | null> {
    const component = this.findComponent(componentId);
    if (component === null) return null;
    return this.options.lots.latestFor(component.componentId);
  }

  /** The component in the recipe, or `null`. */
  private findComponent(
    componentId: string,
  ): Recipe['components'][number] | null {
    const recipe = this.options.workingCopy.current();
    if (recipe === null) return null;
    return recipe.componentById(componentId);
  }

  /**
   * The operator's route — the scan and the keyed-in share everything but
   * the method, which is why they are one method with a parameter.
   */
  private async captureFromOperator(
    componentId: string,
    rawLot: string,
    method: Extract<CaptureMethod, 'SCAN' | 'KEYED_IN'>,
    operatorId: OperatorId,
  ): Promise<CaptureLotOutcome> {
    const component = this.findComponent(componentId);
    if (component === null) {
      return this.unknownComponent(componentId);
    }

    const validation = this.options.validator.validate(rawLot);

    if (validation.kind === 'EMPTY') {
      this.options.onError?.(
        `[material-lot] the lot for component ${component.componentId.value} was empty`,
      );
      return {
        kind: 'EMPTY_LOT',
        message: 'A lot is required',
      };
    }

    if (validation.kind === 'TOO_LONG') {
      this.options.onError?.(
        `[material-lot] the lot for component ${component.componentId.value} is ${validation.length} characters; the maximum is ${validation.maximum}`,
      );
      return {
        kind: 'LOT_TOO_LONG',
        message: `A lot must not exceed ${validation.maximum} characters`,
        maximum: validation.maximum,
      };
    }

    return this.record(
      component.componentId,
      component.dyestuffCode,
      validation.lotNumber.value,
      method,
      operatorId,
    );
  }

  /** Write the capture. The only path that touches the repository. */
  private async record(
    componentId: Recipe['components'][number]['componentId'],
    materialCode: DyestuffCode,
    lotNumber: string,
    method: CaptureMethod,
    operatorId: OperatorId,
  ): Promise<CaptureLotOutcome> {
    const capture = new MaterialLotCapture(
      componentId,
      LotNumber.create(lotNumber),
      materialCode,
      method,
      operatorId,
      Instant.of(this.options.clock()),
    );

    await this.options.lots.save(capture);
    return { kind: 'CAPTURED', capture };
  }

  private unknownComponent(componentId: string): CaptureLotOutcome {
    this.options.onError?.(
      `[material-lot] the recipe has no component ${componentId}`,
    );
    return {
      kind: 'UNKNOWN_COMPONENT',
      message: `The recipe has no component ${componentId}`,
    };
  }
}
