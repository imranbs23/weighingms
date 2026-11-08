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
import {
  isDemandedScaleClass,
  type DemandedScaleClass,
} from '../value-objects/demanded-scale-class.js';
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
import type { LinkContactReporter } from '../ports/link-repositories.js';
import { SyncError } from '../value-objects/sync-error.js';
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
  /**
   * Where the contact outcome is reported.
   *
   * Optional, so a reader can be built without a link reporter — which is
   * what bolt 005's own tests do. When it IS present, every contact
   * reports its outcome, so the link state reflects reality (R-08).
   */
  readonly contactReporter?: LinkContactReporter;
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
      return await this.onFailure(batchId, error);
    }

    let snapshot: RecipeSnapshot;
    try {
      snapshot = this.buildSnapshot(raw, batchId);
    } catch (error) {
      // A malformed component fails the WHOLE read (S-24).
      return await this.onFailure(
        batchId,
        new AdapterError(
          'MALFORMED',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }

    cache.rememberRecipe(snapshot);

    // The contact SUCCEEDED — the MES was reached and answered. The link
    // state service is the single writer of the observation row (R-08).
    await this.reportSuccess();

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
  private async onFailure(
    batchId: BatchId,
    error: unknown,
  ): Promise<RecipeReadOutcome> {
    const { cache, clock } = this.options;

    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof AdapterError && error.reason === 'NOT_FOUND') {
      // A `NOT_FOUND` is a SUCCESSFUL contact that produced no record — the
      // MES was reached and answered. It is a `404`, not a failure, so it
      // does not touch the link state.
      this.emit({
        type: 'RECIPE_READ_FAILED',
        batchId,
        reason: 'NOT_FOUND',
        at: clock(),
        message,
      });
      await this.reportSuccess();
      return { kind: 'NOT_FOUND', message };
    }

    const reason =
      error instanceof AdapterError &&
      (error.reason === 'UNREACHABLE' ||
        error.reason === 'MALFORMED' ||
        error.reason === 'TIMEOUT')
        ? error.reason
        : 'UNREACHABLE';

    // The contact FAILED — the MES was reached and answered unusably, or
    // could not be reached at all. The link state service is the single
    // writer of the observation row (R-08, OQ-5), so a station that only
    // READS still learns that the link is down.
    //
    // The report happens BEFORE the outcome is decided, because the
    // outcome — a stale recipe served from the cache — does not change
    // what was observed: the MES did not answer.
    await this.reportFailure(reason, message);

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
    // A MISSING class and an UNKNOWN class are different facts.
    //
    // MISSING — the MES supplied no class. That is carried through as
    // `null`, because the component is real, it simply cannot be weighed
    // yet, and the rail says so explicitly (BRD FR-06).
    //
    // UNKNOWN — the MES supplied a class the vocabulary does not contain.
    // That is refused, and the whole read fails: a component weighed on a
    // device chosen without the constraint that was supposed to apply is a
    // silent wrong answer, and dropping the constraint is quiet (S-24).
    const scaleClass = this.buildScaleClass(raw.scaleClass, raw.componentId);
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
      scaleClass,
      normaliseOptionalText(raw.name),
      normaliseOptionalText(raw.swatchColour),
    );
  }

  /**
   * The component's demanded scale class.
   *
   * @param raw The MES's value — present, absent, or unknown.
   * @param componentId The component, for the diagnostic.
   * @returns The class, or `null` when the MES supplied none.
   * @throws When the MES supplied a class the vocabulary does not contain.
   */
  private buildScaleClass(
    raw: string | null,
    componentId: string,
  ): DemandedScaleClass | null {
    // ABSENT — no class. Carried through as `null`.
    if (raw === null) return null;

    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;

    // PRESENT but unknown — refused, and the whole read fails.
    if (!isDemandedScaleClass(trimmed)) {
      throw new Error(
        `Unknown scale class "${raw}" on component ${componentId}`,
      );
    }
    return trimmed;
  }

  private emit(event: OrgatexEvent): void {
    this.options.onEvent?.(event);
  }

  /** Report a successful contact to the link state service. */
  private async reportSuccess(): Promise<void> {
    const reporter = this.options.contactReporter;
    if (reporter === undefined) return;
    await reporter.recordSuccess(Instant.of(this.options.clock()));
  }

  /** Report a failed contact to the link state service. */
  private async reportFailure(
    reason: 'UNREACHABLE' | 'MALFORMED' | 'TIMEOUT',
    message: string,
  ): Promise<void> {
    const reporter = this.options.contactReporter;
    if (reporter === undefined) return;
    await reporter.recordFailure(
      SyncError.fromAdapterReason(reason, message),
      Instant.of(this.options.clock()),
    );
  }
}

/**
 * Normalise an optional display fact.
 *
 * An absent value is `null`. An empty or whitespace-only value is **also**
 * `null` — because a blank name is the same fact as no name, and a blank
 * colour is not a colour.
 *
 * The value is **not** otherwise interpreted here. The colour's shape is
 * unit `002`'s concern — it is validated at the station's boundary, where
 * the value becomes a CSS declaration — and the seam only carries what the
 * MES gave (ADR-032).
 */
function normaliseOptionalText(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}
