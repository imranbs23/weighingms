---
bolt: 005-005-orgatex-integration
created: 2026-11-02T18:59:00Z
status: accepted
superseded_by: null
---

# ADR-022: The adapter's transport is not exercised by the tests

## Context

BRD IR-07 is the unit's reason for existing:

> "All OrgaTEX interaction is confined to a single adapter component, so a
> change of interface technology affects one replaceable part."

A seam is only worth having if the thing on the other side can actually be
swapped. The unit brief makes the same point about the contract itself:

> "The external contract is not confirmed. A-01 assumes SETEX provides a
> documented, licensed REST interface; Q-01 asks whether such an interface
> exists at all, and of what kind. The BRD's own endpoint list is marked
> 'assumed endpoint shape — illustrative, for FCI/SETEX to correct'."

So the adapter is a **placeholder for something that does not exist yet**,
and the question this ADR answers is: *what do the tests actually prove?*

The workbook also requires the Dummy OrgaTEX to be a **real development
artefact**, independently exercisable over `curl`:

> "The training application needs at least: GET /api/batches,
> GET /api/batches/:batchId, GET /api/batches/:batchId/recipe,
> POST /api/batches/:batchId/consumption."

Those two requirements pull in different directions. If the adapter calls
the Dummy MES over HTTP, the training artefact is exercised honestly — but
every test that reads the queue now depends on a socket, a port, a server
lifecycle and a timing window, and a flaky server is a flaky test suite.

If the adapter holds the Dummy's world **in process**, the domain rules are
testable in isolation — but the **transport is never executed**.

That trade has to be made deliberately. It cannot be made by accident,
because the alternative failure is the worst one available: a green test
suite that has never once sent a request over a socket, and a discovery at
integration time that the transport does not work.

## Decision

**The adapter is in-process. The Dummy OrgaTEX's HTTP router exists
alongside it, and the adapter's transport is explicitly NOT covered by this
bolt's tests.**

Three parts, each doing a different job:

1. **The Dummy MES's world** — the batches, recipes and accumulated
   consumption. Held in memory by a `DummyOrgatexAdapter`.
2. **The Dummy MES's HTTP router** — the training artefact, mounted
   separately, curl-able, exactly as the workbook specifies. It serves the
   **same world**.
3. **The adapter's port** — `OrgatexAdapter`. The Dummy adapter is bound to
   it. A real adapter replaces the Dummy; nothing above the port changes.

**And the consequence is stated, not buried:**

> **This bolt's tests prove the domain rules and the adapter's parsing. They
> do not prove that a request can be sent, received, timed out or retried.**

When a real adapter is written, **its transport tests are that adapter's
job**, and they are not optional. The unit's test report must carry the gap
forward until they exist.

## Rationale

### Why in-process

Because the **domain rules** are where the risk is, and a socket is a
liability when testing them.

The rules this bolt owns are exact and easy to get wrong: the `DEGRADED`
fallback and its three conditions; the age on a stale snapshot; the refusal
of a malformed payload; the eligibility derivation; the `404`-only-on-a-
successful-contact rule. Every one of them is a pure function or a single
chokepoint, and every one of them can be tested by calling it.

An HTTP round-trip adds nothing to those tests. It adds a server to start,
a port to bind, a socket to time out, and a class of failure — "the test
failed because the server had not finished binding" — that has nothing to do
with the rule under test. The project's own testing standard already
records the reasoning behind disabling Vitest's file-level parallelism:

> "Because a suite whose value is its trustworthiness must not have an
> intermittent green run, file-level parallelism is disabled rather than left
> to chance."

A suite that depends on a socket in every read test is the same failure
mode, one level up.

### Why the HTTP router still exists

Because the workbook requires it, and because it is the artefact a reviewer
actually curls to see the training world.

**The router and the adapter share one world**, so the two can never
disagree — a batch added through the router is immediately visible to the
adapter, and vice versa. That is what makes the training artefact
*coherent* rather than decorative.

### Why the gap is stated rather than left implicit

Because an unstated gap becomes a **false claim**.

The unit brief says the seam is "exercised by the test suite". If a reader
takes that to mean "the adapter's transport is tested", and it is not, then
the seam's central promise — that it can be swapped — is **unproven**, and
the reader has no way to know it.

So the gap is written into the ADR, into the design, and into the test
report. **The claim becomes "the rules are proven; the transport is not
yet"**, which is true and useful.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **The adapter calls the Dummy over HTTP** | The transport is genuinely exercised; the training artefact and the product path are the same path | Every read test depends on a socket, a port and a server lifecycle; a flaky server is a flaky suite; the domain rules get no better coverage | **Rejected.** The risk is in the rules, not the transport, and the transport can be tested once without contaminating every test |
| **In-process adapter, no HTTP router** | Simplest; one artefact instead of two | The Dummy MES is not independently exercisable over `curl`, which the workbook requires and the story requires | **Rejected.** The Dummy is a real development artefact, not a mock |
| **In-process adapter, plus the router, plus transport tests** | Everything is covered | Requires the HTTP round-trip in the test path, with all its flakiness, to gain coverage of a layer that does not exist yet | **Rejected for this bolt.** The transport belongs to the real adapter, when there is one |
| **In-process adapter, plus the router, with the transport gap stated** (adopted) | The rules are tested in isolation; the training artefact is real; the gap is explicit and carried forward | The transport is untested until a real adapter exists | **Adopted.** The gap is stated in three places so it cannot be forgotten |

## Consequences

### Positive

- The domain rules are tested **without a socket**, so they are fast and
  deterministic.
- The training artefact is **real** — a reviewer curls `/api/batches` and
  sees the same world the adapter serves.
- The **seam's shape is proven**: the port is the complete contract, and a
  consumer cannot tell whether it is talking to the Dummy or to a real
  adapter. That is the property IR-07 promises.
- The **replacement path is explicit**: a real adapter is one class, bound
  to the same port, in the same composition root.

### Negative

- **The transport is untested.** A timeout, a TLS failure, a retry storm, a
  500 with a non-JSON body — none of them are exercised.
- The **composition root's adapter binding** is the one line that changes
  when the real MES arrives, and that line is not exercised by a test that
  substitutes the Dummy.
- A reviewer who reads "the seam is exercised by the test suite" without
  reading this ADR would draw a **stronger conclusion than the evidence
  supports**.

### Risks

- **A real adapter is written and its transport never tested.** *Mitigation*:
  this ADR names the gap explicitly, the decision index's "Read when" points
  at the transport, and the unit's test report must carry it forward as an
  open item. The real adapter's own ADR should close it.
- **The Dummy's HTTP router drifts from the adapter's world.** *Mitigation*:
  they share **one** world object, so they cannot drift — there is only one
  copy to be wrong.
- **The outage control is exercised only through the router**, so the
  adapter's failure path is tested via the same switch the UI would use.
  *Mitigation*: the adapter also exposes its failure state directly, so the
  unit tests do not depend on the router to simulate an outage.
- **A future bolt adds a real HTTP client to the adapter and assumes it is
  tested because the Dummy router exists.** *Mitigation*: this ADR.

## Related

- **Stories**: 001-read-released-batch-queue, 002-read-batch-recipe
- **Requirements**: FR-1, FR-3, BRD IR-01, BRD IR-02, BRD IR-07, BRD C-13,
  BRD IR-09
- **Previous ADRs**: ADR-013 — the same "the read is open because it is
  physically visible" reasoning, applied to a different device; ADR-020
  (this bolt's session requirement) is unaffected
- **Standards**: `standards/tech-stack.md` § "API shape" and § "Service
  topology" — the Dummy OrgaTEX's endpoints are the training contract this
  ADR does not exercise through the adapter
