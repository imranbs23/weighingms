/**
 * The OrgaTEX test harness.
 *
 * A small, shared builder for the MES seam, so a test file that mounts its
 * own Express app does not have to repeat the wiring.
 *
 * The unit's READ path persists nothing (ADR-021), so there is no database
 * for it. The WRITE path does persist — the postings, the ledger, the
 * attempts and the status writes — so this harness opens an in-memory
 * database for it.
 */
import {
  buildOrgatexModule,
  type OrgatexModule,
} from '../../src/005-orgatex-integration/infrastructure/composition-root.js';
import { DummyOrgatexWorld } from '../../src/005-orgatex-integration/infrastructure/adapters/dummy-orgatex-data.js';
import type { OrgatexConfig } from '../../src/005-orgatex-integration/infrastructure/config/orgatex-config.js';

export const DEFAULT_ORGATEX_CONFIG: OrgatexConfig = {
  databasePath: ':memory:',
  freshnessWindowMs: 5 * 60 * 1000,
  sourceName: 'DUMMY_ORGATEX',
  rejectionDisposition: 'RETRYABLE',
};

/**
 * Build an OrgaTEX module for a test.
 *
 * @param clock        A controllable clock, so a freshness test does not
 *                     have to wait five minutes.
 * @param freshnessWindowMs  How old a last known-good may be and still be
 *                     served as stale.
 * @param world        An existing world, so a test can drive it directly.
 * @param rejectionDisposition  Whether a rejected posting may be re-driven.
 */
export function createOrgatexHarness(options?: {
  readonly clock?: () => Date;
  readonly freshnessWindowMs?: number;
  readonly world?: DummyOrgatexWorld;
  readonly rejectionDisposition?: OrgatexConfig['rejectionDisposition'];
}): OrgatexModule {
  const config: OrgatexConfig = {
    ...DEFAULT_ORGATEX_CONFIG,
    freshnessWindowMs:
      options?.freshnessWindowMs ?? DEFAULT_ORGATEX_CONFIG.freshnessWindowMs,
    rejectionDisposition:
      options?.rejectionDisposition ??
      DEFAULT_ORGATEX_CONFIG.rejectionDisposition,
  };

  return buildOrgatexModule({
    config,
    ...(options?.clock === undefined ? {} : { clock: options.clock }),
    ...(options?.world === undefined ? {} : { world: options.world }),
  });
}
