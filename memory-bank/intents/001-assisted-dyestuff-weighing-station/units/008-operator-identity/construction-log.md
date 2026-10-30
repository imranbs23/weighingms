---
unit: 008-operator-identity
intent: 001-assisted-dyestuff-weighing-station
created: 2026-10-30T10:00:00Z
last_updated: 2026-10-30T15:00:00Z
---

# Construction Log: 008-operator-identity

## Original Plan

**From Inception**: 2 bolts planned
**Planned Date**: 2026-10-30

| Bolt ID | Stories | Type |
|---------|---------|------|
| `001-008-operator-identity` | 001-sign-in-at-terminal | ddd |
| `002-008-operator-identity` | 002-authorise-privileged-action-as-supervisor | ddd |

## Replanning History

| Date | Action | Change | Reason | Approved |
|------|--------|--------|--------|----------|

## Current Bolt Structure

| Bolt ID | Stories | Type | Status |
|---------|---------|------|--------|
| `001-008-operator-identity` | 001-sign-in-at-terminal | ddd | in-progress (stage: test) |
| `002-008-operator-identity` | 002-authorise-privileged-action-as-supervisor | ddd | planned |

## Progress

- **2026-10-30T10:00:00Z**: `001-008-operator-identity` started - Stage 1: model
- **2026-10-30T10:30:00Z**: `001-008-operator-identity` stage-complete - model → design
- **2026-10-30T11:30:00Z**: `001-008-operator-identity` stage-complete - design → adr

**Dependency finding**: none of the runtime dependencies were installed
(only Playwright). Probed rather than assumed — `scripts/probe-runtime-deps.cjs`.
Node 26's built-in `crypto.argon2Sync` provides a memory-hard KDF with **no
native build step**, so the `argon2` npm package is not needed.
- **2026-10-30T12:10:00Z**: `001-008-operator-identity` stage-complete - adr → implement

**ADRs created**: ADR-001 (Argon2id via Node's built-in `crypto`) and ADR-002
(session tokens stored as a digest). Both accepted; `memory-bank/standards/decision-index.md`
created with `total_decisions: 2`. The tech stack's "a memory-hard KDF"
wording was a gap that ADR-001 closed — the stack now names Argon2id, the
parameters, and the token storage form.
- **2026-10-30T13:30:00Z**: `001-008-operator-identity` stage-complete - implement → test

**Dependency deviation**: `better-sqlite3` (the tech stack's original
choice) **cannot be installed** — it needs node-gyp and a Visual Studio C++
toolchain that is not present. Node 26's built-in `node:sqlite` was
probed and used instead (`scripts/probe-sqlite.cjs`,
`scripts/probe-node-sqlite-api.cjs`). Same argument as ADR-001: no build
step, no native dependency, and the stack's self-contained promise holds.
The driver also differs from better-sqlite3 in ways the adapters handle
explicitly — booleans and `undefined` cannot be bound.

**Security-relevant upgrade**: `zod` was upgraded to v4 and `vitest` to v5
after `npm audit` reported a high-severity advisory in zod (production
runtime) and a critical one in vitest (dev). `npm audit` now reports
**0 vulnerabilities**.

**Verified against a live server** (`scripts/verify-implementation.cjs`,
15 checks): failure responses byte-identical for unknown-operator and
wrong-secret; 401s identical for no-token and tampered-token;
client-supplied role ignored; sign-out idempotent and the session
authorises nothing afterwards; credential store holds only argon2id
hashes; session table holds only sha256 digests, never a raw token.
- **2026-10-30T14:30:00Z**: `001-008-operator-identity` stage-complete - test → awaiting the Stage 5 human checkpoint

**Test suite**: 224 tests across 11 files — 133 unit, 71 integration,
20 security. All passing. Coverage **96.25% statements / 90.05% branches
/ 98.58% functions / 96.75% lines**, against an 80% threshold on all
four; the gate passes.

**The initial coverage run FAILED the threshold** (75.75% statements,
70.16% branches). The gaps were real, not cosmetic: the published domain
events, the configuration parser, the credential service, the provider's
control flow and the persistence round trips were all untested. Closing
them raised coverage by more than 20 points. The point of recording this
is that a threshold that fails is the threshold doing its job.

**The constant-work guarantee is now MEASURED, not just implemented.**
The raw KDF timings, taken directly: wrong-secret median 12.25 ms,
unknown-operator median 12.42 ms — a **ratio of 1.014** against the test's
2.5 threshold. The two paths are within 1.4% of each other. The timing
test passed 10 consecutive runs.

**A harness failure was investigated rather than ignored.** The suite's
very first execution failed in all four test files with a Vitest-internal
`Cannot read properties of undefined (reading 'config')`, raised in the
reporter before any project code ran. It did not reproduce across 17
consecutive runs (including 8 cold-cache starts), and neither
`node:sqlite`, `crypto.argon2Sync` nor Express reproduced it in
isolation. The fault is in Vitest 5's parallel worker pool on this
Windows host, not in the code under test. **File-level parallelism is
now disabled** (`fileParallelism: false`) rather than hoping the
intermittent failure does not recur: a green run that might have been red
is worse than a slow one, and the suite takes about two seconds either
way. The reasoning is recorded in `vitest.config.ts`.

**Standards debt paid**: the tech stack's Database section still named
`better-sqlite3`; it now names `node:sqlite`, matching the code and the
deviation recorded above.
- **2026-10-30T14:45:00Z**: `001-008-operator-identity` **complete** — `node .specsmd/aidlc/scripts/bolt-complete.cjs 001-008-operator-identity`

The script needed `fs-extra` and `js-yaml`, which were not installed; both
were added as devDependencies (the application itself needs neither).

**A latent defect found and fixed — it would have broken every future bolt
completion.** `bolt-complete.cjs` reported `Invalid unit brief frontmatter,
skipping` and `Invalid requirements frontmatter, skipping`. The
frontmatter was not invalid: the script matches frontmatter with
`/^---\n([\s\S]+?)\n---/`, which requires **LF**, and 13 memory-bank
files — including **all 8 unit briefs** and the requirements file — had
**CRLF** endings.

The consequence was silent and would have accumulated: a unit brief's
`status` is never updated to `complete`, and the intent's status never
advances. Every future bolt completion would have reported success while
leaving the memory bank claiming the work was unfinished. The bolt file
itself was unaffected only because the script REWRITES it with LF — which
is why the problem surfaced only after that script had already run.

Two fixes, because one was not enough:

1. `scripts/normalise-line-endings.cjs` converted the 13 files to LF and
   re-verified each by parsing its frontmatter with the framework's exact
   regex and YAML loader, exiting non-zero on any failure.
2. `.gitattributes` pins `memory-bank/**` (and the source trees) to
   `eol=lf`. This host has `core.autocrlf=true`, which checks text files
   out with CRLF — so **normalising the working tree alone would have been
   undone by the next checkout**, on this host and on every other host
   with the same default. The fix was proven durable by extracting the
   tree with `git checkout-index` and re-testing the framework's regex
   against the extracted files.

Verified after the fix: **86 of 86** memory-bank files that have
frontmatter are readable by the framework's pattern; the two that have no
frontmatter at all (`standards/tech-stack.md`, `story-index.md`) are
unaffected.

**A second framework-interaction defect, found by the project's own
verifier.** `verify-frontmatter.cjs` reported the bolt file's `created`
timestamp as invalid. The framework's `yaml.dump` **quotes** a string
that looks like a date (`created: 2026-10-30T09:00:00Z`), while the
project's convention — and the verifier's rule — is unquoted. Because
`bolt-complete.cjs` rewrites the frontmatter on every completion, this
would recur at every bolt, each time reporting a problem in a file nobody
edited by hand. Fixed by unquoting all 8 timestamps in the bolt file and
the 1 in the story file, and guarded by `scripts/unquote-timestamps.cjs`,
which the standards now require after any framework script that writes
frontmatter.


---

## Bolt 002 — Supervisor Authorisation (2026-10-30)

`002-008-operator-identity` executes the second story of this unit:
`002-authorise-privileged-action-as-supervisor`.

The bolt was started with Stages 1–3 complete (domain model, technical
design, four ADRs) and stopped at the Implement stage with the tree red.
Stage 4 was finished and Stage 5 was executed here.

### Stage 4 — Implement

**The tree was red on arrival: 11 type errors and 92 failing tests.** The
causes, in order of blast radius:

1. `IdentityConfig.authorisationLifetimeMs` was added as a **required**
   field, but the test harness and one security test built a config
   without it. `undefined` reached `ConfiguredAuthorisationWindowFactory`,
   which threw — so **every** integration and security test died at
   setup. This single missing field accounted for all 92 failures.
2. Five `import type` statements were used for classes that are
   instantiated as values (`PrivilegeAuthorised`, `PrivilegeRefused`,
   `AuthorisationConsumed`, `SupervisorAuthorisation`,
   `AuthorisationConsumption`).
3. `REFUSAL_SELF_AUTHORISATION` was used but never imported.
4. Zod v4 renamed the enum's `errorMap` parameter to `error`.
5. The persistence test asserted exactly four migrations; bolt 002 added
   three, so the expectation needed updating — not the code.

**The lesson worth keeping:** the 92 failures were not 92 problems. They
were one missing configuration field, and a test suite that fails at
*setup* rather than at *assertion* is the tell. A suite that fails 92
assertions is usually 92 real problems; a suite that fails 92 times in
`beforeEach` is one.

### Stage 5 — Test

116 new tests across four files:

| File | Tests | Covers |
|------|-------|--------|
| `tests/unit/authorisation-value-objects.test.ts` | 44 | The type-level invariants |
| `tests/unit/authorisation-policy.test.ts` | 17 | The pure rules, the expiry boundary |
| `tests/integration/authorisation-service.test.ts` | 36 | The service, the repositories, append-only |
| `tests/integration/authorisation-api.test.ts` | 19 | The HTTP contract, ADR-004's uniform refusal |

**340 tests pass. Coverage 93.89% statements / 89.64% branches / 95.37%
functions / 94.09% lines** — against a threshold of 80% on all four. The
unit as a whole had fallen to 62.07% statements when bolt 002's
authorisation code arrived untested.

**Three defects were found by the tests.** The significant one is worth
reading twice, because it is the kind of bug a review does not catch:

> ADR-003 requires a consume request to present the authorisation id
> *together with* the live session of "the operator the authorisation was
> issued **for**". The implementation checked only that the applying
> operator was *distinct from the supervisor*.
>
> The consequence: an authorisation raised for operator A could be applied
> by operator B. B is not the supervisor, so the check passed. The
> exception granted to A was silently usable by anybody else at the
> terminal.

The root cause was not a missing `if`. It was that `SupervisorAuthorisation`
**never recorded who it was issued for** — the field did not exist, so the
check could not be written. `NOT_THE_REQUESTING_OPERATOR` sat in the closed
set of refusal reasons and was unreachable, which is the symptom that
pointed at the missing field.

The fix added `requestedOperatorId` to the entity, the event, the table and
the repository, plus `isIssuedFor()` and a second check on the consume path.
Migration `005` was edited in place rather than replaced with `008`, which
is safe **only** because no database had applied it — proved with
`scripts/probe-dev-db.cjs`, kept in the repo so the next bolt does not
have to assume it.

Two further defects: `GET /authorisations/:id` disclosed a supervisor's
justification text to any other operator, and `POST /authorisations`
accepted an anonymous request. Both are recorded in
`memory-bank/bolts/002-008-operator-identity/ddd-03-test-report.md`.

### The bolt is at its human checkpoint

Stages 1–5 are complete. The bolt's status is `awaiting-approval`, and
the last success criterion — *code reviewed and approved* — is the
participant's, not the agent's.
