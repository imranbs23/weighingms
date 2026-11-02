/**
 * Test harness — builds a real identity module against an in-memory
 * database.
 *
 * The tests deliberately exercise the REAL adapters (real Argon2id, real
 * SQLite) rather than mocks. This unit is the one the unit brief says
 * must be "exercised by an exhaustive test suite independent of the other
 * units" — a mock-based suite would test the mocks.
 *
 * The one concession is the CLOCK. Sessions expire on wall-clock time, and
 * a test that waits eight hours is not a test. The clock is therefore
 * injected — which is also how the design made session lifetime
 * configurable rather than hard-coded.
 */
import { createApp } from '../src/api/app.js';
import {
  buildIdentityModule,
  type IdentityModule,
} from '../src/008-operator-identity/infrastructure/composition-root.js';
import type { IdentityConfig } from '../src/008-operator-identity/infrastructure/config/identity-config.js';
import { OperatorId } from '../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../src/008-operator-identity/domain/value-objects/operator-role.js';
import { Operator } from '../src/008-operator-identity/domain/entities/operator.js';
import {
  buildScaleModule,
  type ScaleModule,
} from '../src/004-scale-integration/infrastructure/composition-root.js';
import type { ScaleConfig } from '../src/004-scale-integration/infrastructure/config/scale-config.js';
import { WeightValue } from '../src/004-scale-integration/domain/value-objects/weight-value.js';

/** A controllable clock. */
export class TestClock {
  private current: Date;

  constructor(start: Date = new Date('2026-10-30T08:00:00.000Z')) {
    this.current = start;
  }

  now = (): Date => new Date(this.current);

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}

export interface Harness {
  readonly identity: IdentityModule;
  readonly scales: ScaleModule;
  readonly app: ReturnType<typeof createApp>;
  readonly clock: TestClock;
  close(): void;
}

/**
 * Build an identity module on an in-memory database.
 *
 * The Argon2 cost is REDUCED for tests. The real profile (19 MiB, 2
 * passes) costs ~55 ms per verification, and the constant-work test
 * performs dozens of verifications — the suite would take minutes.
 *
 * This does NOT weaken what is being tested: the enumeration defence
 * depends on the two paths doing the SAME amount of work, not on the
 * work being expensive. The cost parameters are covered by their own
 * test against the real profile.
 */
export function createHarness(options?: {
  sessionLifetimeMs?: number;
  argon2Memory?: number;
  argon2Passes?: number;
  authorisationLifetimeMs?: number;
  disconnectTimeoutMs?: number;
  sampleIntervalMs?: number;
  /**
   * The selection threshold, or null to leave it unset.
   *
   * Null is the production default, because `Q-04` is unanswered
   * (ADR-019). A test that needs the threshold configured passes one.
   */
  selectionThreshold?: WeightValue | null;
}): Harness {
  const clock = new TestClock();

  const config: IdentityConfig = {
    databasePath: ':memory:',
    sessionLifetimeMs: options?.sessionLifetimeMs ?? 60 * 60 * 1000,
    argon2Memory: options?.argon2Memory ?? 8192,
    argon2Passes: options?.argon2Passes ?? 1,
    authorisationLifetimeMs: options?.authorisationLifetimeMs ?? 15 * 60 * 1000,
  };

  const identity = buildIdentityModule({ config, clock: clock.now });

  // The scale unit shares the identity unit's database, so the two units'
  // migrations live in one `schema_migrations` table.
  const scaleConfig: ScaleConfig = {
    databasePath: ':memory:',
    disconnectTimeoutMs: options?.disconnectTimeoutMs ?? 2000,
    sampleIntervalMs: options?.sampleIntervalMs ?? 100,
    // `Q-04` is unanswered, so the threshold is UNSET — exactly as it is
    // in production (ADR-019). A test that needs it configured passes one
    // here.
    selectionThreshold: options?.selectionThreshold ?? null,
  };
  const scales = buildScaleModule({
    config: scaleConfig,
    clock: clock.now,
    db: identity.db,
  });

  const app = createApp({ identity, scales });

  return {
    identity,
    scales,
    app,
    clock,
    close: () => {
      scales.close();
      identity.close();
    },
  };
}

/** Create an operator with a credential, in the given harness. */
export async function seedOperator(
  harness: Harness,
  id: string,
  displayName: string,
  role: 'OPERATOR' | 'SUPERVISOR',
  secret: string,
): Promise<void> {
  const operatorId = OperatorId.create(id);
  const operator = new Operator(
    operatorId,
    displayName,
    role === 'SUPERVISOR' ? OperatorRole.supervisor() : OperatorRole.operator(),
    true,
    harness.clock.now(),
  );
  await harness.identity.operatorRepository.save(operator);
  await harness.identity.credentials.create(
    operatorId,
    operator.role,
    secret,
  );
}

/** Deactivate an operator without touching their credential. */
export async function deactivateOperator(
  harness: Harness,
  id: string,
): Promise<void> {
  const operator = await harness.identity.operatorRepository.findById(
    OperatorId.create(id),
  );
  if (operator === null) throw new Error(`No such operator: ${id}`);
  await harness.identity.operatorRepository.save(operator.deactivate());
}
