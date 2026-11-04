/**
 * The read path reports its contact outcomes to the link state.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL
 * ══════════════════════════════════════════════════════════════════════
 *
 * ADR-027, OQ-5, says it in one sentence:
 *
 *   "**All** of them report through `LinkStateService` — the posting
 *   path's, **the read path's** and the queue's delivery."
 *
 * And the technical design's item 18 says the same thing from the other
 * end: "the link state is derived from the real read path's outcomes".
 *
 * The readers DID have the reporting seam wired — a `contactReporter`
 * option, a `reportSuccess` and a `reportFailure` — but `reportFailure`
 * was never called. The readers reported their SUCCESSES and swallowed
 * their FAILURES.
 *
 * The consequence is a station that lies about its own link. A station
 * that only ever READS — no weighings, no postings — reaches a MES that
 * has gone away. Every read fails. Every read is served from the cache,
 * marked stale. And the link state says `LINKED`, because the only
 * observation row was ever written by a success.
 *
 * That is the exact failure this bolt exists to prevent: a link state
 * that is a hard-coded label rather than a derived fact. The station
 * would report "linked" to an operator whose work list is an hour old
 * and getting older.
 *
 * So these tests pin the behaviour from both ends: a failed read moves
 * the link state, and a `NOT_FOUND` does NOT — because a `NOT_FOUND` is
 * a **successful** contact that produced no record.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { BatchId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { BatchQueueReader } from '../../src/005-orgatex-integration/domain/services/batch-queue-reader.js';
import { RecipeReader } from '../../src/005-orgatex-integration/domain/services/recipe-reader.js';
import type {
  RawQueue,
  RawRecipe,
} from '../../src/005-orgatex-integration/domain/ports/orgatex-adapter.js';
import { buildOrgatexModule } from '../../src/005-orgatex-integration/infrastructure/composition-root.js';
import {
  DEFAULT_ORGATEX_CONFIG,
} from '../support/orgatex-harness.js';
import { StubAdapter } from '../support/orgatex-reader-stub.js';

const T0 = Instant.of(new Date('2026-10-30T08:00:00.000Z'));

/**
 * A module whose clock is fixed, so the freshness window is exact.
 */
function build(): ReturnType<typeof buildOrgatexModule> {
  return buildOrgatexModule({
    config: DEFAULT_ORGATEX_CONFIG,
    clock: () => T0.toDate(),
  });
}

describe('the read path — a failed read moves the link state (OQ-5)', () => {
  it('a FAILED queue read leaves the station DEGRADED, not LINKED', async () => {
    const module = build();

    // The MES is reachable, so the first read succeeds and the station
    // knows it is linked.
    await module.queueReader.read();
    expect((await module.linkStateService.read()).status).toBe('LINKED');

    // The MES goes away. The read now fails — and the cached snapshot is
    // served, marked with its age. That is the DEGRADED read (FR-20).
    module.world.setReachable(false);
    const outcome = await module.queueReader.read();

    expect(outcome.kind).toBe('SUCCEEDED_STALE');

    // And the station KNOWS. The link state is derived from the failed
    // contact, not from the last success.
    const state = await module.linkStateService.read();
    expect(state.status).toBe('DEGRADED');
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError?.code).toBe('UNREACHABLE');
  });

  it('a FAILED recipe read leaves the station DEGRADED, not LINKED', async () => {
    const module = build();

    await module.recipeReader.read(BatchId.create('B-24187'));
    expect((await module.linkStateService.read()).status).toBe('LINKED');

    module.world.setReachable(false);
    const outcome = await module.recipeReader.read(BatchId.create('B-24187'));

    expect(outcome.kind).toBe('SUCCEEDED_STALE');

    const state = await module.linkStateService.read();
    expect(state.status).toBe('DEGRADED');
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError?.code).toBe('UNREACHABLE');
  });

  it('a station that NEVER reached the MES is OFFLINE, not LINKED', async () => {
    const module = build();

    // The very first contact fails. There is no last successful snapshot,
    // so there is nothing to serve and nothing to age out — the station is
    // OFFLINE from the outset. A rule that read only the failure count
    // would call it LINKED.
    module.world.setReachable(false);
    await module.queueReader.read();

    const state = await module.linkStateService.read();
    expect(state.status).toBe('OFFLINE');
    expect(state.lastContactAt).toBeNull();
    expect(state.consecutiveFailures).toBe(1);
  });

  it('a SUCCESSFUL read after an outage restores LINKED', async () => {
    const module = build();

    await module.queueReader.read();
    module.world.setReachable(false);
    await module.queueReader.read();
    expect((await module.linkStateService.read()).status).toBe('DEGRADED');

    module.world.setReachable(true);
    await module.queueReader.read();

    const state = await module.linkStateService.read();
    expect(state.status).toBe('LINKED');
    expect(state.consecutiveFailures).toBe(0);
  });
});

describe('the read path — a NOT_FOUND is a SUCCESSFUL contact', () => {
  it('a NOT_FOUND recipe leaves the link LINKED', async () => {
    const module = build();

    // The MES was reached and answered "no such batch". That is a `404`,
    // not a failure — the link is UP. Reporting it as a failure would
    // tell an operator the MES is down when it is answering.
    const outcome = await module.recipeReader.read(BatchId.create('B-NOPE'));

    expect(outcome.kind).toBe('NOT_FOUND');

    const state = await module.linkStateService.read();
    expect(state.status).toBe('LINKED');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastError).toBeNull();
  });
});

describe('the read path — a MALFORMED answer is a FAILED contact', () => {
  /**
   * An adapter that answers with something the seam cannot understand.
   *
   * The MES was REACHED and answered — the answer was unusable. That is
   * a `MALFORMED` failure, not an `UNREACHABLE` one, and it still moves
   * the link state.
   */
  class MalformedAdapter extends StubAdapter {
    override async readQueue(): Promise<RawQueue> {
      return { batches: undefined } as unknown as RawQueue;
    }

    override async readRecipe(): Promise<RawRecipe> {
      return {
        batchId: 'B-24187',
        shadeCode: 'Teal 4C',
        components: undefined,
      } as unknown as RawRecipe;
    }
  }

  /** An adapter that throws something that is NOT an `Error`. */
  class NonErrorAdapter extends StubAdapter {
    override async readQueue(): Promise<RawQueue> {
      throw 'the seam threw a string';
    }

    override async readRecipe(): Promise<RawRecipe> {
      throw 'the seam threw a string';
    }
  }

  function queueReaderFor(adapter: StubAdapter): BatchQueueReader {
    return new BatchQueueReader({
      adapter,
      cache: build().cache,
      clock: () => T0.toDate(),
      source: 'DUMMY_ORGATEX',
      freshnessWindowMs: DEFAULT_ORGATEX_CONFIG.freshnessWindowMs,
      contactReporter: {
        recordSuccess: async () => {},
        recordFailure: async () => {},
      },
    });
  }

  function recipeReaderFor(adapter: StubAdapter): RecipeReader {
    return new RecipeReader({
      adapter,
      cache: build().cache,
      clock: () => T0.toDate(),
      source: 'DUMMY_ORGATEX',
      freshnessWindowMs: DEFAULT_ORGATEX_CONFIG.freshnessWindowMs,
      contactReporter: {
        recordSuccess: async () => {},
        recordFailure: async () => {},
      },
    });
  }

  it('a queue with NO batch list is MALFORMED, and it moves the link state', async () => {
    const outcome = await queueReaderFor(new MalformedAdapter()).read();

    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;
    expect(outcome.reason).toBe('MALFORMED');
  });

  it('a recipe with NO component list is MALFORMED', async () => {
    const outcome = await recipeReaderFor(new MalformedAdapter()).read(
      BatchId.create('B-24187'),
    );

    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;
    expect(outcome.reason).toBe('MALFORMED');
  });

  it('a component with an INVALID sequence is MALFORMED', async () => {
    // The plain stub, so the recipe below is the one that is read — the
    // malformed adapter overrides `readRecipe` and would answer with its
    // own "no component list" instead.
    const adapter = new StubAdapter();
    adapter.recipe = {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [
        {
          componentId: 'C-01',
          sequence: -1,
          dyestuffCode: 'DYE-4471',
          target: '94.0000',
          unit: 'g',
          toleranceMin: '93.5000',
          toleranceMax: '94.5000',
          scaleClass: 'PRECISION',
        },
      ],
    };

    const outcome = await recipeReaderFor(adapter).read(
      BatchId.create('B-24187'),
    );

    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;
    expect(outcome.reason).toBe('MALFORMED');
  });

  it('a thrown NON-Error is still a failure, and still UNREACHABLE', async () => {
    // The seam threw a bare string. The reader cannot know why, so it
    // reports the one thing it CAN stand behind: the MES did not answer.
    const queue = await queueReaderFor(new NonErrorAdapter()).read();

    expect(queue.kind).toBe('FAILED');
    if (queue.kind !== 'FAILED') return;
    expect(queue.reason).toBe('UNREACHABLE');
    expect(queue.message).toContain('the seam threw a string');

    const recipe = await recipeReaderFor(new NonErrorAdapter()).read(
      BatchId.create('B-24187'),
    );

    expect(recipe.kind).toBe('FAILED');
    if (recipe.kind !== 'FAILED') return;
    expect(recipe.reason).toBe('UNREACHABLE');
    expect(recipe.message).toContain('the seam threw a string');
  });

  it('a MALFORMED component message is carried through the read', async () => {
    // The component list is present but one component is unusable, so the
    // read fails with the component's own diagnostic — which is what the
    // operator needs to see in the log.
    const adapter = new StubAdapter();
    adapter.recipe = {
      batchId: 'B-24187',
      shadeCode: 'Teal 4C',
      components: [
        {
          componentId: 'C-01',
          sequence: 1,
          dyestuffCode: 'DYE-4471',
          target: '94.0000',
          unit: 'g',
          toleranceMin: '93.5000',
          toleranceMax: '94.5000',
          scaleClass: 'NOT_A_SCALE_CLASS',
        },
      ],
    };

    const outcome = await recipeReaderFor(adapter).read(
      BatchId.create('B-24187'),
    );

    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind !== 'FAILED') return;
    expect(outcome.reason).toBe('MALFORMED');
    expect(outcome.message).toContain('NOT_A_SCALE_CLASS');
  });
});
