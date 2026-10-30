import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The Argon2id tests are genuinely slow — each verification costs
    // ~55 ms, and the constant-work test runs many of them. The default
    // 5 s timeout is not enough for the security suite.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The domain is pure, so unit tests can run in parallel. The
    // integration tests share a SQLite file per test file, so files run
    // sequentially — but tests within a file are isolated by their own
    // in-memory database.
    sequence: { concurrent: false },
    // File-level parallelism is DISABLED deliberately.
    //
    // On this Windows host the very first parallel run failed with a
    // Vitest-internal error — "Cannot read properties of undefined
    // (reading 'config')" — raised in the reporter for all four test
    // files at once, before any project code had executed. The suite
    // passed 17 consecutive runs afterwards, including 8 cold-cache
    // starts, and neither `node:sqlite`, `crypto.argon2Sync`, nor Express
    // reproduces it in isolation. So the fault is in Vitest 5's worker
    // pool rather than in the code under test.
    //
    // Because this is a security suite whose whole value is that it is
    // TRUSTWORTHY, an intermittently-unreproducible harness failure is
    // not acceptable — a green run that might have been red is worse than
    // a slow one. Running the files in a single worker removes the
    // class of failure entirely. The whole suite takes ~2 s, so the
    // serialisation costs nothing that matters.
    //
    // Revisit when Vitest 5.x is upgraded past this behaviour.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/api/server.ts',
        'src/**/index.ts',
        '**/*.d.ts',
        // The PORT files are TypeScript interfaces only. They contain no
        // runtime code, so the v8 provider reports them as 0% covered —
        // a measurement artefact, not a gap. Their contracts are
        // exercised through the adapters that implement them.
        'src/**/domain/ports/*.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
