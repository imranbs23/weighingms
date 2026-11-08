/**
 * The composition root — where unit 002's layers are wired.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PORTS ARE BOUND HERE, AND ONLY HERE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `RecipeReader` satisfies `RecipeSource` structurally — its
 * `read(batchId: BatchId)` is exactly the port's signature — so the
 * binding needs no adapter class and no mapping layer between the two
 * units.
 *
 * That binding is the **whole** of the coupling. Unit 002 never imports the
 * reader class, and never holds an `OrgatexAdapter`, a credential or a
 * socket. So there is exactly **one** reader of the MES seam, one contact
 * per read, and one cache (ADR-032).
 *
 * A reviewer looking for a second path to the MES will find it here: one
 * line, one port, one implementation. If a second reader is ever added, it
 * is visible in this file.
 *
 * THE SCANNER IS THE SAME INSTANCE UNIT 001 USES
 * -----------------------------------------------
 * One physical device, one state, one training artefact behind
 * `POST /api/scan` (ADR-033). Two ports — one per consumer — and **one**
 * device behind them. A second scanner adapter would be a second reader of
 * one device, and therefore two sources of truth for "what was just
 * scanned".
 *
 * AND THE RECIPE PERSISTS NOTHING — BUT THE STATION'S ACTS DO
 * -----------------------------------------------------------
 * Bolt 010's recipe is not persisted: it is a projection of somebody else's
 * truth (ADR-031). The **identity** and the **lot capture** are the
 * opposite case — they are the station's own acts, the MES has no idea they
 * happened, and they must be durable (ADR-034).
 */
import { LoadRecipe } from '../application/use-cases/load-recipe.js';
import { VerifyMaterialIdentity } from '../application/use-cases/verify-material-identity.js';
import { CaptureMaterialLot } from '../application/use-cases/capture-material-lot.js';
import { AssignContainer } from '../application/use-cases/assign-container.js';
import { RecipeProjector } from '../domain/services/recipe-projector.js';
import { RecipeWorkingCopy } from '../domain/services/recipe-working-copy.js';
import { MaterialIdentityVerifier } from '../domain/services/material-identity-verifier.js';
import { LotValidator } from '../domain/services/lot-validator.js';
import { TareEstablishmentPolicy } from '../domain/services/tare-establishment-policy.js';
import type { RecipeSource } from '../domain/ports/recipe-source.js';
import type { DyestuffScanner } from '../domain/ports/dyestuff-scanner.js';
import type { DyestuffMasterSource } from '../domain/ports/dyestuff-master-source.js';
import type { MaterialIdentityRepository } from '../domain/ports/material-identity-repository.js';
import type { MaterialLotRepository } from '../domain/ports/material-lot-repository.js';
import type {
  ContainerAssignmentRepository,
  ContainerMasterSource,
  ScaleTarePort,
} from '../domain/ports/container-ports.js';
import type { RecipeEvent } from '../domain/events/recipe-events.js';

export interface RecipeMaterialModule {
  /** The recipe load use case (bolt 010). */
  readonly loadRecipe: LoadRecipe;
  /** The identity verification use case (bolt 011). */
  readonly verifyMaterialIdentity: VerifyMaterialIdentity;
  /** The lot capture use case (bolt 011). */
  readonly captureMaterialLot: CaptureMaterialLot;
  /** The container assignment use case (bolt 012). */
  readonly assignContainer: AssignContainer;
  /** The projector, so a caller can inspect the projection itself. */
  readonly projector: RecipeProjector;
  /** The working copy — the recipe the station is working. */
  readonly workingCopy: RecipeWorkingCopy;
  /**
   * The seam this unit reads through.
   *
   * Exposed so that a test — or a future bolt — can prove the read went
   * through it, and so the binding is discoverable rather than hidden.
   */
  readonly source: RecipeSource;
  /** The scanner the scan path reads through. */
  readonly scanner: DyestuffScanner;
  /** The seam the MES's own lot is read through. */
  readonly master: DyestuffMasterSource;
  /** The repository the identity is recorded in. */
  readonly identities: MaterialIdentityRepository;
  /** The repository the lot capture is recorded in. */
  readonly lots: MaterialLotRepository;
  /** The container master — WeighingMS's own reference data. */
  readonly containers: ContainerMasterSource;
  /** The tare command, bound to unit 004's registry. */
  readonly scaleTare: ScaleTarePort;
  /** The repository the assignment is recorded in. */
  readonly assignments: ContainerAssignmentRepository;
}

export interface BuildRecipeMaterialOptions {
  /**
   * Where the recipe comes from.
   *
   * In production this is unit 005's `RecipeReader`. A test may bind a
   * controlled source that returns a specific failure.
   */
  readonly source: RecipeSource;
  /**
   * The clock — a failure is timestamped.
   *
   * Defaults to the system clock. A test injects a fixed one.
   */
  readonly clock?: () => Date;
  /**
   * Where a failure's diagnostic goes.
   *
   * Defaults to the console, because an undiagnosed MES failure is the
   * thing BRD IR-09 exists to prevent.
   */
  readonly onError?: (detail: string) => void;
  /** Where the domain events go. */
  readonly onEvent?: (event: RecipeEvent) => void;
  /**
   * The scanner the material and lot codes are read through.
   *
   * **The SAME instance unit `001` uses** — one physical device, one
   * state, one training artefact (ADR-033).
   */
  readonly scanner: DyestuffScanner;
  /** Where the MES's own lot is read from. */
  readonly master: DyestuffMasterSource;
  /** Where the identity is recorded. */
  readonly identities: MaterialIdentityRepository;
  /** Where the lot capture is recorded. */
  readonly lots: MaterialLotRepository;
  /** Where the container master is read from. */
  readonly containers: ContainerMasterSource;
  /** The tare command, bound to unit 004's registry. */
  readonly scaleTare: ScaleTarePort;
  /** Where the assignment is recorded. */
  readonly assignments: ContainerAssignmentRepository;
  /**
   * The working copy.
   *
   * Optional — one is created when it is not given. It is exposed on the
   * options because a caller may need the **same** instance elsewhere —
   * the master adapter reads the batch id from it — and two working copies
   * would be two sources of truth for the recipe being worked.
   */
  readonly workingCopy?: RecipeWorkingCopy;
}

export function buildRecipeMaterialModule(
  options: BuildRecipeMaterialOptions,
): RecipeMaterialModule {
  const projector = new RecipeProjector();
  const workingCopy = options.workingCopy ?? new RecipeWorkingCopy();
  const clock = options.clock ?? (() => new Date());

  const loadRecipe = new LoadRecipe({
    source: options.source,
    projector,
    workingCopy,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  });

  const verifyMaterialIdentity = new VerifyMaterialIdentity({
    workingCopy,
    scanner: options.scanner,
    identities: options.identities,
    verifier: new MaterialIdentityVerifier(),
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const captureMaterialLot = new CaptureMaterialLot({
    workingCopy,
    master: options.master,
    lots: options.lots,
    validator: new LotValidator(),
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const assignContainer = new AssignContainer({
    workingCopy,
    master: options.containers,
    scaleTare: options.scaleTare,
    assignments: options.assignments,
    policy: new TareEstablishmentPolicy(),
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  return {
    loadRecipe,
    verifyMaterialIdentity,
    captureMaterialLot,
    assignContainer,
    projector,
    workingCopy,
    source: options.source,
    scanner: options.scanner,
    master: options.master,
    identities: options.identities,
    lots: options.lots,
    containers: options.containers,
    scaleTare: options.scaleTare,
    assignments: options.assignments,
  };
}
