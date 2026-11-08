/**
 * The recipe's composition root.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE BINDING IS ASSERTED DIRECTLY, BECAUSE IT IS THE ONE THING IN THIS
 * BOLT THAT COULD GO WRONG IN A WAY NO OTHER TEST WOULD NOTICE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * If a second reader of the MES seam were ever added — a second cache, a
 * second contact, a second source of truth for the recipe — every test in
 * this bolt would still pass. The recipe would still come back, with the
 * right components and the right quantities.
 *
 * So the binding is asserted here: the source the module was given **is**
 * the source the use case reads through, and the read goes through it
 * **exactly once**.
 *
 * This is the same argument unit `001` makes about its queue, and ADR-032
 * makes about the recipe.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRecipeMaterialModule,
} from '../../src/002-recipe-material-management/infrastructure/composition-root.js';
import { LoadRecipe } from '../../src/002-recipe-material-management/application/use-cases/load-recipe.js';
import { RecipeProjector } from '../../src/002-recipe-material-management/domain/services/recipe-projector.js';
import { RecipeWorkingCopy } from '../../src/002-recipe-material-management/domain/services/recipe-working-copy.js';
import type { RecipeSource } from '../../src/002-recipe-material-management/domain/ports/recipe-source.js';
import type { DyestuffScanner } from '../../src/002-recipe-material-management/domain/ports/dyestuff-scanner.js';
import type { DyestuffMasterSource } from '../../src/002-recipe-material-management/domain/ports/dyestuff-master-source.js';
import type { MaterialIdentityRepository } from '../../src/002-recipe-material-management/domain/ports/material-identity-repository.js';
import type { MaterialLotRepository } from '../../src/002-recipe-material-management/domain/ports/material-lot-repository.js';
import type {
  ContainerAssignmentRepository,
  ContainerMasterSource,
  ScaleTarePort,
} from '../../src/002-recipe-material-management/domain/ports/container-ports.js';
import type { MaterialIdentity } from '../../src/002-recipe-material-management/domain/entities/material-identity.js';
import type { MaterialLotCapture } from '../../src/002-recipe-material-management/domain/entities/material-lot-capture.js';
import type { ContainerAssignment } from '../../src/002-recipe-material-management/domain/entities/container-assignment.js';
import type { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import type { TareApplication } from '../../src/004-scale-integration/domain/value-objects/tare-application.js';
import type { ComponentId as ComponentIdType } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import type { ContainerId as ContainerIdType } from '../../src/002-recipe-material-management/domain/value-objects/container-id.js';
import { BatchId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import type { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import type { RecipeReadOutcome } from '../../src/005-orgatex-integration/domain/services/recipe-reader.js';

class StubSource implements RecipeSource {
  reads = 0;
  lastBatchId: string | null = null;

  async read(batchId: BatchId): Promise<RecipeReadOutcome> {
    this.reads += 1;
    this.lastBatchId = batchId.value;
    return {
      kind: 'FAILED',
      reason: 'UNREACHABLE',
      message: 'the seam is down',
    };
  }
}

/** A scanner that reads nothing. */
class StubScanner implements DyestuffScanner {
  async read() {
    return { kind: 'NO_CODE' as const, message: 'no code' };
  }
}

/** A master that holds no lot. */
class StubMaster implements DyestuffMasterSource {
  async readLot(_componentId: ComponentId) {
    return { kind: 'NO_LOT' as const };
  }
}

/** A repository that records nothing. */
class StubIdentities implements MaterialIdentityRepository {
  async save(_identity: MaterialIdentity): Promise<void> {}
  async latestFor(_componentId: ComponentId): Promise<MaterialIdentity | null> {
    return null;
  }
}

/** A repository that records nothing. */
class StubLots implements MaterialLotRepository {
  async save(_capture: MaterialLotCapture): Promise<void> {}
  async latestFor(_componentId: ComponentId): Promise<MaterialLotCapture | null> {
    return null;
  }
}

/** The ports bolt 011 needs. */
function ports() {
  return {
    scanner: new StubScanner(),
    master: new StubMaster(),
    identities: new StubIdentities(),
    lots: new StubLots(),
  };
}

/** A container master that holds nothing. */
class StubContainers implements ContainerMasterSource {
  async read(_containerId: ContainerIdType) {
    return { kind: 'NOT_FOUND' as const };
  }
}

/** A tare command that refuses everything. */
class StubScaleTare implements ScaleTarePort {
  applyTare(): TareApplication {
    return { kind: 'REFUSED', reason: 'SCALE_NOT_RESPONDING' };
  }
  readEmptyContainer(): WeightValue | null {
    return null;
  }
}

/** A repository that records nothing. */
class StubAssignments implements ContainerAssignmentRepository {
  async save(_assignment: ContainerAssignment): Promise<void> {}
  async latestFor(_componentId: ComponentIdType): Promise<ContainerAssignment | null> {
    return null;
  }
}

/** The ports bolt 012 needs. */
function containerPorts() {
  return {
    containers: new StubContainers(),
    scaleTare: new StubScaleTare(),
    assignments: new StubAssignments(),
  };
}

describe('the recipe composition root', () => {
  it('binds the use case to the source it was given', async () => {
    const source = new StubSource();
    const module = buildRecipeMaterialModule({ source, ...ports(), ...containerPorts() });

    expect(module.loadRecipe).toBeInstanceOf(LoadRecipe);
    expect(module.projector).toBeInstanceOf(RecipeProjector);
    expect(module.workingCopy).toBeInstanceOf(RecipeWorkingCopy);

    // The seam, and a future second reader would be visible here.
    expect(module.source).toBe(source);

    await module.loadRecipe.execute('B-24187');
    expect(source.reads).toBe(1);
    expect(source.lastBatchId).toBe('B-24187');
  });

  it('reads through the seam EXACTLY once per load', async () => {
    const source = new StubSource();
    const module = buildRecipeMaterialModule({ source, ...ports(), ...containerPorts() });

    await module.loadRecipe.execute('B-24187');

    // One contact, one cache, one source of truth (ADR-032).
    expect(source.reads).toBe(1);
  });

  it('holds the loaded recipe in the working copy', async () => {
    const source = new StubSource();
    const module = buildRecipeMaterialModule({ source, ...ports(), ...containerPorts() });

    expect(module.workingCopy.current()).toBeNull();

    // The stub fails, so nothing is held — a failed load never leaves a
    // half-written recipe behind.
    await module.loadRecipe.execute('B-24187');
    expect(module.workingCopy.current()).toBeNull();
  });

  it('routes a failure’s diagnostic to the bound error handler', async () => {
    const logged: string[] = [];
    const source = new StubSource();
    const module = buildRecipeMaterialModule({
      source,
      ...ports(), ...containerPorts(),
      onError: (detail) => logged.push(detail),
    });

    await module.loadRecipe.execute('B-24187');

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('UNREACHABLE');
    expect(logged[0]).toContain('the seam is down');
  });

  it('works with no error handler bound at all', async () => {
    const module = buildRecipeMaterialModule({ source: new StubSource(), ...ports(), ...containerPorts() });

    const outcome = await module.loadRecipe.execute('B-24187');

    expect(outcome.kind).toBe('UNAVAILABLE');
  });

  it('emits the domain events it is given a sink for', async () => {
    const events: string[] = [];
    const module = buildRecipeMaterialModule({
      source: new StubSource(),
      ...ports(), ...containerPorts(),
      onEvent: (event) => events.push(event.kind),
    });

    await module.loadRecipe.execute('B-24187');

    expect(events).toEqual(['RECIPE_LOAD_FAILED']);
  });

  it('refuses a malformed batch id WITHOUT contacting the seam', async () => {
    const source = new StubSource();
    const module = buildRecipeMaterialModule({ source, ...ports(), ...containerPorts() });

    const outcome = await module.loadRecipe.execute('   ');

    expect(outcome.kind).toBe('REJECTED');
    // A malformed id is refused before the seam is contacted — there is
    // nothing to ask the MES about.
    expect(source.reads).toBe(0);
  });
});
