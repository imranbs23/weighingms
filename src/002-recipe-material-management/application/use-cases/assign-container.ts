/**
 * AssignContainer — assign a container to a component and establish its
 * tare.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ASSIGN FIRST, THEN TARE. AND A REFUSAL CHANGES NOTHING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * **The order is the story's.** A tare without a container is a tare of
 * nothing, so the container is identified first and the tare is
 * established against it.
 *
 * **And a refusal writes NOTHING.** The tare is applied first, and the
 * assignment is recorded only after the device has accepted it. If the
 * scale refuses the tare — it is disconnected, its calibration has
 * expired, it will not respond — then no assignment is recorded and the
 * previous assignment stands (the same refusal rule unit `004` applies to
 * the device's own tare, S-14).
 *
 * **The measured tare is the SCALE's reading**, never a client's number.
 * A client-chosen tare would be a client-chosen tolerance boundary.
 *
 * **And the method and the source are DERIVED.** The method comes from the
 * request's shape (a `code` was scanned, a `containerId` was typed in), and
 * the source comes from what the station actually did — the master held a
 * tare, or the empty container was weighed (ADR-030, ADR-035).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import type { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import type { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { ContainerAssignment } from '../../domain/entities/container-assignment.js';
import type { Recipe } from '../../domain/entities/recipe.js';
import type {
  ContainerAssignmentRepository,
  ContainerMasterSource,
  ScaleTarePort,
} from '../../domain/ports/container-ports.js';
import { TareEstablishmentPolicy } from '../../domain/services/tare-establishment-policy.js';
import type { RecipeWorkingCopy } from '../../domain/services/recipe-working-copy.js';
import { ContainerId } from '../../domain/value-objects/container-id.js';
import type { AssignmentMethod } from '../../domain/value-objects/assignment-method.js';

export type AssignContainerOutcome =
  | {
      readonly kind: 'ASSIGNED';
      readonly assignment: ContainerAssignment;
    }
  | {
      /** The recipe holds no such component. */
      readonly kind: 'UNKNOWN_COMPONENT';
      readonly message: string;
    }
  | {
      /** The master holds no such container. */
      readonly kind: 'UNKNOWN_CONTAINER';
      readonly message: string;
    }
  | {
      /**
       * The scale refused the tare.
       *
       * **Nothing is written.** The component cannot proceed to dispensing
       * (BRD FR-19, BRD IR-13).
       */
      readonly kind: 'TARE_REFUSED';
      readonly reason: string;
      readonly message: string;
    }
  | {
      /** The scale produced no reading — the empty container could not be weighed. */
      readonly kind: 'SCALE_UNAVAILABLE';
      readonly message: string;
    };

export interface AssignContainerOptions {
  /** The working copy — where the recipe being worked is held. */
  readonly workingCopy: RecipeWorkingCopy;
  /** Where the master is read from. */
  readonly master: ContainerMasterSource;
  /** The tare command, bound to unit 004's registry. */
  readonly scaleTare: ScaleTarePort;
  /** Where the assignment is recorded. */
  readonly assignments: ContainerAssignmentRepository;
  /** The policy that decides the route. */
  readonly policy: TareEstablishmentPolicy;
  /** The clock — the assignment is timestamped. */
  readonly clock: () => Date;
  /** Where a failure's diagnostic goes. The detail never reaches the client. */
  readonly onError?: (detail: string) => void;
}

export class AssignContainer {
  constructor(private readonly options: AssignContainerOptions) {}

  /**
   * Assign a container to a component.
   *
   * @param componentId The recipe slot.
   * @param containerId The vessel, as identified.
   * @param method How it was identified — **derived by the caller** from the
   *   request's shape, never supplied by the client.
   * @param scaleId The device the tare is applied to.
   * @param operatorId The operator — from the session, never the body.
   */
  async execute(
    componentId: string,
    containerId: string,
    method: AssignmentMethod,
    scaleId: ScaleId,
    operatorId: OperatorId,
  ): Promise<AssignContainerOutcome> {
    const component = this.findComponent(componentId);
    if (component === null) {
      this.options.onError?.(
        `[container] the recipe has no component ${componentId}`,
      );
      return {
        kind: 'UNKNOWN_COMPONENT',
        message: `The recipe has no component ${componentId}`,
      };
    }

    let id: ContainerId;
    try {
      id = ContainerId.create(containerId);
    } catch {
      this.options.onError?.(
        `[container] "${containerId}" is not a valid container id`,
      );
      return {
        kind: 'UNKNOWN_CONTAINER',
        message: 'The container id is not valid',
      };
    }

    const lookup = await this.options.master.read(id);
    if (lookup.kind === 'NOT_FOUND') {
      this.options.onError?.(
        `[container] the master holds no container ${id.value}`,
      );
      return {
        kind: 'UNKNOWN_CONTAINER',
        message: `The master holds no container ${id.value}`,
      };
    }

    const container = lookup.container;

    // A RE-TARE always MEASURES — evidence beats a claim. And the route
    // says where the value comes from, so the source is derived rather
    // than supplied.
    const existing = await this.current(componentId);
    const route = this.options.policy.route(container, existing !== null);

    // The MEASURED tare is the SCALE's reading. When the master holds no
    // tare, the empty container must be weighed — and the device does the
    // weighing.
    let tareWeight: WeightValue;
    if (route.kind === 'FROM_MASTER') {
      tareWeight = route.tareWeight;
    } else {
      const measured = this.options.scaleTare.readEmptyContainer(scaleId);
      if (measured === null) {
        // The device produced nothing. It is **absent**, never present
        // with a reading of zero (S-1).
        this.options.onError?.(
          `[container] the scale ${scaleId.value} produced no reading for the empty container`,
        );
        return {
          kind: 'SCALE_UNAVAILABLE',
          message: 'The scale could not be read to measure the empty container',
        };
      }
      tareWeight = measured;
    }

    // THE DEVICE. Unit 004's registry does the whole device-side job — the
    // reading that proves the device is there, the gate, the conversion
    // into the device's unit, and the mechanism.
    const applied = this.options.scaleTare.applyTare(
      scaleId,
      tareWeight,
      route.source,
    );

    if (applied.kind === 'REFUSED') {
      // A REFUSAL CHANGES NOTHING. No assignment is written, and the
      // previous one stands.
      this.options.onError?.(
        `[container] the scale refused the tare for component ${component.componentId.value}: ${applied.reason}`,
      );
      return {
        kind: 'TARE_REFUSED',
        reason: applied.reason,
        message: `The scale refused the tare (${applied.reason})`,
      };
    }

    // THE RECORDED TARE IS THE DEVICE'S OWN. The device returned the state
    // it applied, so the recorded value and the device's zero reference are
    // the same object rather than two independently built copies that
    // could disagree (ADR-035).
    const assignment = new ContainerAssignment(
      component.componentId,
      id,
      container.containerType,
      applied.state.tareValue,
      applied.state.source,
      method,
      operatorId,
      Instant.of(this.options.clock()),
      scaleId,
    );

    await this.options.assignments.save(assignment);
    return { kind: 'ASSIGNED', assignment };
  }

  /**
   * The effective assignment for a component — the newest one.
   *
   * `null` when no container has been assigned yet. An unassigned
   * component is a **state**, not an error.
   */
  async current(componentId: string): Promise<ContainerAssignment | null> {
    const component = this.findComponent(componentId);
    if (component === null) return null;
    return this.options.assignments.latestFor(component.componentId);
  }

  /** The component in the recipe, or `null`. */
  private findComponent(
    componentId: string,
  ): Recipe['components'][number] | null {
    const recipe = this.options.workingCopy.current();
    if (recipe === null) return null;
    return recipe.componentById(componentId);
  }
}
