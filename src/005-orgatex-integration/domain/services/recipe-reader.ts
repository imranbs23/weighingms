/**
 * RecipeReader — the read half of the recipe seam.
 *
 * The same shape as `BatchQueueReader`, with two differences that are not
 * incidental.
 *
 * FIRST — `NOT_FOUND` IS AN OUTCOME, NOT A FAILURE
 * ------------------------------------------------
 * A recipe read can be told *"no such batch"*. That is a **successful
 * contact** with a negative answer, and it produces a `404` — not a `503`.
 *
 * The rule is: **a 404 may only come from a successful contact.** The
 * alternative — mapping "not found" onto the same path as "unreachable" —
 * would tell an operator the MES is down when it is up, and would serve a
 * stale recipe for a batch that never existed.
 *
 * SECOND — THE RECIPE IS VALIDATED WHOLESALE
 * -------------------------------------------
 * A recipe with one malformed component fails the WHOLE read (S-24). A
 * partially valid recipe is a wrong target on the scale: the operator
 * would weigh against a target the MES never gave.
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { SnapshotCache } from './snapshot-cache.js';
import { RecipeComponent, RecipeSnapshot } from '../entities/snapshots.js';
import {
  BatchId,
  ComponentId,
  DyestuffCode,
  ShadeCode,
} from '../value-objects/identifiers.js';
import { isDemandedScaleClass } from '../value-objects/demanded-scale-class.js';
import { Tolerance } from '../value-objects/tolerance.js';
import {
  CURRENT,
  stale,
  type SnapshotFreshness,
} from '../value-objects/snapshot-freshness.js';
import {
  AdapterError,
  type OrgatexAdapter,
  type RawComponent,
  type RawRecipe,
} from '../ports/orgatex-adapter.js';
import type { OrgatexEvent } from '../events/orgatex-events.js';

/**
 * The outcome of a recipe read.
 *
 * `NOT_FOUND` is its own kind, because it is neither a success nor a
 * failure of the link — the MES was reached, and it said no.
 */
export type RecipeReadOutcome =
  | {
      readonly kind: 'SUCCEEDED';
      readonly snapshot: RecipeSnapshot;
      readonly freshness: SnapshotFreshness;
    }
  | {
      readonly kind: 'SUCCEEDED_STALE';
      readonly snapshot: RecipeSnapshot;
      readonly freshness: SnapshotFreshness;
    }
  | {
      readonly kind: 'NOT_FOUND';
      /** For the LOG, never for the client (BRD IR-09). */
      readonly message: string;
    }
  | {
      readonly kind: 'FAILED';
      readonly reason: 'UNREACHABLE' | 'MALFORMED' | 'TIMEOUT';
      /** For the LOG, never for the client (BRD IR-09). */
      readonly message: string;
    };

export interface RecipeReaderOptions {
  readonly adapter: OrgatexAdapter;
  readonly cache: SnapshotCache;
  readonly clock: () => Date;
  readonly source: string;
  /** How old a last known-good may be and still be served as stale. */
  readonly freshnessWindowMs: number;
  readonly onEvent?: (event: OrgatexEvent) => void;
}

export class RecipeReader {
  constructor(private readonly options: RecipeReaderOptions) {}

  /** Read a batch's recipe. */
  async read(batchId: BatchId): Promise<RecipeReadOutcome> {
    const { adapter, cache, clock, source } = this.options;

    let raw: RawRecipe;
    try {
      raw = await adapter.readRecipe(batchId);
    } catch (error) {
      return this.onFailure(batchId, error);
    }

    let snapshot: RecipeSnapshot;
    try {
      snapshot = this.buildSnapshot(raw, batchId);
    } catch (error) {
      // A malformed component fails the WHOLE read (S-24).
      return this.onFailure(
        batchId,
        new AdapterError(
          'MALFORMED',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }

    cache.rememberRecipe(snapshot);

    this.emit({
      type: 'RECIPE_READ',
      batchId,
      componentCount: snapshot.count,
      receivedAt: snapshot.receivedAt.toDate(),
      source,
    });

    return { kind: 'SUCCEEDED', snapshot, freshness: CURRENT };
  }

  /**
   * Handle a contact that did not produce a snapshot.
   *
   * The `NOT_FOUND` case returns EARLY, before the stale fallback is
   * consulted — because a batch the MES says does not exist must not be
   * answered with a stale recipe for a batch that did.
   */
  private onFailure(
    batchId: BatchId,
    error: unknown,
  ): RecipeReadOutcome {
    const { cache, clock } = this.options;

    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof AdapterError && error.reason === 'NOT_FOUND') {
      this.emit({
        type: 'RECIPE_READ_FAILED',
        batchId,
        reason: 'NOT_FOUND',
        at: clock(),
        message,
      });
      return { kind: 'NOT_FOUND', message };
    }

    const reason =
      error instanceof AdapterError &&
      (error.reason === 'UNREACHABLE' ||
        error.reason === 'MALFORMED' ||
        error.reason === 'TIMEOUT')
        ? error.reason
        : 'UNREACHABLE';

    this.emit({
      type: 'RECIPE_READ_FAILED',
      batchId,
      reason,
      at: clock(),
      message,
    });

    const cached = cache.recallRecipe(batchId);
    if (cached === null) {
      return { kind: 'FAILED', reason, message };
    }

    const ageMs = clock().getTime() - cached.receivedAt.toDate().getTime();
    if (ageMs > this.options.freshnessWindowMs) {
      return { kind: 'FAILED', reason, message };
    }

    return {
      kind: 'SUCCEEDED_STALE',
      snapshot: cached,
      freshness: stale(ageMs),
    };
  }

  /** Build the snapshot, refusing anything the seam does not understand. */
  private buildSnapshot(raw: RawRecipe, requested: BatchId): RecipeSnapshot {
    const { clock, source } = this.options;

    if (!Array.isArray(raw.components)) {
      throw new Error('The MES returned a recipe with no component list');
    }

    // The MES's answer must be about the batch that was ASKED for. A
    // mismatch would mean the seam answered a different question than the
    // one it was given.
    const returnedId = BatchId.create(raw.batchId);
    if (!returnedId.equals(requested)) {
      throw new Error(
        `The MES returned a recipe for ${returnedId.value} when asked for ${requested.value}`,
      );
    }

    const components = raw.components.map((component) =>
      this.buildComponent(component),
    );

    return new RecipeSnapshot(
      returnedId,
      ShadeCode.create(raw.shadeCode),
      components,
      Instant.of(clock()),
      source,
    );
  }

  /** Build one component, refusing anything the seam does not understand. */
  private buildComponent(raw: RawComponent): RecipeComponent {
    if (!isDemandedScaleClass(raw.scaleClass)) {
      throw new Error(
        `Unknown scale class "${raw.scaleClass}" on component ${raw.componentId}`,
      );
    }
    if (!Number.isInteger(raw.sequence) || raw.sequence < 0) {
      throw new Error(
        `Invalid sequence on component ${raw.componentId}`,
      );
    }

    const target = WeightValue.of(raw.target, raw.unit);

    // A tolerance is ABSENT or it is a BAND. A half-present band — a
    // minimum with no maximum — is refused rather than completed with a
    // zero or an infinity, because either would be a tolerance the MES
    // never expressed.
    let tolerance: Tolerance | null = null;
    if (raw.toleranceMin !== null || raw.toleranceMax !== null) {
      if (raw.toleranceMin === null || raw.toleranceMax === null) {
        throw new Error(
          `Component ${raw.componentId} has only one tolerance bound`,
        );
      }
      tolerance = Tolerance.of(
        WeightValue.of(raw.toleranceMin, raw.unit),
        WeightValue.of(raw.toleranceMax, raw.unit),
      );
    }

    return new RecipeComponent(
      raw.sequence,
      ComponentId.create(raw.componentId),
      DyestuffCode.create(raw.dyestuffCode),
      target,
      tolerance,
      raw.scaleClass,
    );
  }

  private emit(event: OrgatexEvent): void {
    this.options.onEvent?.(event);
  }
}
