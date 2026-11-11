---
step: 13
captured: 2026-11-11
backfill: true
source: memory-bank/bolts/*/bolt.md
---

# Step 13 — List the Bolts

> **Backfilled evidence.** The bolt list was produced by the Construction
> Agent at the start of construction, but no screenshot was saved then.
> This list is regenerated on 2026-11-11 from the bolts' own frontmatter by
> `node scripts/evidence-backfill.cjs 13`, so the statuses are today's.

**30 bolts**, 30 complete.

| Bolt ID | Unit | Description | Type | Depends on | Status |
|---|---|---|---|---|---|
| 001-008-operator-identity | 008-operator-identity | Establish the identity domain: the Operator, the Credential and the IdentitySession, with a local IdentityProvider behind a seam, hashed credentials and opaque session tokens. | DDD | — | complete |
| 002-008-operator-identity | 008-operator-identity | Implement the supervisor authorisation model: a different person, a fresh authentication at the point of action, a mandatory reason, and a scoped, expiring, single-use authorisation. | DDD | 001-008-operator-identity | complete |
| 003-004-scale-integration | 004-scale-integration | Own the scale device seam: a continuous live-weight stream at ≥ 10 Hz and disconnect detection within 2 s that blocks weighing rather than letting a stale reading pass for a live one. | DDD | — | complete |
| 004-004-scale-integration | 004-scale-integration | Apply the container tare and select the scale by capacity, so the reading the operator sees is the dyestuff and not the container. | DDD | 003-004-scale-integration | complete |
| 005-005-orgatex-integration | 005-orgatex-integration | Build the OrgaTEX adapter seam and the Dummy OrgaTEX MES behind it: the released batch queue and the batch recipe, read through one adapter that no other unit may bypass. | DDD | — | complete |
| 006-005-orgatex-integration | 005-orgatex-integration | Post actual consumption idempotently, using a locally generated and tracked idempotency key, so that a retry after a lost response cannot double-count a dye batch. | DDD | 005-005-orgatex-integration | complete |
| 007-005-orgatex-integration | 005-orgatex-integration | Own the link state and the deferred synchronisation queue, so that the station keeps weighing while OrgaTEX is unreachable and nothing is silently discarded. | DDD | 006-005-orgatex-integration | complete |
| 008-001-batch-management | 001-batch-management | Read the released batch queue through the OrgaTEX adapter and expose it as a station-owned projection with its receipt time. | DDD | 005-005-orgatex-integration | complete |
| 009-001-batch-management | 001-batch-management | Filter the queue by status and turn "the operator picked a batch" into a recorded selection carrying the method by which it was made. | DDD | 008-001-batch-management | complete |
| 010-002-recipe-material-management | 002-recipe-material-management | Load a batch’s recipe through the OrgaTEX adapter — components, targets, units, tolerances and scale classes — and expose it as the single cross-unit call owned by this unit. | DDD | 005-005-orgatex-integration | complete |
| 011-002-recipe-material-management | 002-recipe-material-management | Verify that the dyestuff presented matches the recipe component, by barcode scan where possible and by recorded attestation where not, and capture and validate the lot being consumed. | DDD | 010-002-recipe-material-management | complete |
| 012-002-recipe-material-management | 002-recipe-material-management | Assign the container to the component and apply its tare, from the container master or by weighing the empty container. | DDD | 011-002-recipe-material-management, 004-004-scale-integration | complete |
| 013-003-weighing-station | 003-weighing-station | Open the weighing session: select the scale automatically from the component’s requirements and consume the live weight stream into the session state. | DDD | 012-002-recipe-material-management, 004-004-scale-integration, 009-001-batch-management | complete |
| 014-003-weighing-station | 003-weighing-station | Evaluate the tolerance zone and gate confirmation on it: the zone is computed once, in one place, and confirmation is possible only while the weight is inside tolerance. | DDD | 013-003-weighing-station | complete |
| 015-003-weighing-station | 003-weighing-station | Detect the over-dose, calculate the surplus, and where it is compensable, recalculate the remaining targets proportionally and present them for acceptance. | DDD | 014-003-weighing-station | complete |
| 016-003-weighing-station | 003-weighing-station | Escalate a non-compensable over-dose to a supervisor and consume a valid authorisation from the identity unit, recording the authoriser and the reason. | DDD | 015-003-weighing-station, 002-008-operator-identity | complete |
| 017-003-weighing-station | 003-weighing-station | Advance the session to the first pending component in recipe order after a confirmation, and keep the confirmed component terminal. | DDD | 014-003-weighing-station | complete |
| 018-003-weighing-station | 003-weighing-station | Close the batch at the last component and produce the summary the ticket is rendered from, with the consumption posting handed to the adapter. | DDD | 017-003-weighing-station, 006-005-orgatex-integration | complete |
| 019-006-ticket-printing | 006-ticket-printing | Render the weighing ticket from a session’s records and print it, tracking the print job as a separate outcome from the weighing itself. | DDD | 018-003-weighing-station | complete |
| 020-006-ticket-printing | 006-ticket-printing | Permit a reprint that is marked as a reprint, carries a reason, and is distinguishable from a first print in both the stored record and the output. | DDD | 019-006-ticket-printing | complete |
| 021-006-ticket-printing | 006-ticket-printing | Own the append-only, immutable, exportable audit trail for privileged actions, retained ≥ 5 years. | DDD | 002-008-operator-identity, 016-003-weighing-station | complete |
| 022-006-ticket-printing | 006-ticket-printing | Provide a configuration store and runtime-loaded locale bundles, so that scale thresholds, tolerance overrides, the label template and the language change without a redeployment. | DDD | 019-006-ticket-printing | complete |
| 023-006-ticket-printing | 006-ticket-printing | Produce the operational report over tolerance failures, overrides and configuration changes — the record management asks questions of. | DDD | 021-006-ticket-printing, 022-006-ticket-printing | complete |
| 024-007-weighingms-ui | 007-weighingms-ui | Build the app shell, the persistent chrome and the Select-batch view, with batch selection by scan and by touch. | Simple | 009-001-batch-management, 022-006-ticket-printing | complete |
| 025-007-weighingms-ui | 007-weighingms-ui | Build the Weigh view — the recipe rail, the live readout, the tolerance band and the status line — driven entirely by the session snapshot. | Simple | 024-007-weighingms-ui, 013-003-weighing-station | complete |
| 026-007-weighingms-ui | 007-weighingms-ui | Build the action row, the confirmation, the progression, the surplus panel and the escalation prompt. | Simple | 025-007-weighingms-ui, 016-003-weighing-station | complete |
| 027-007-weighingms-ui | 007-weighingms-ui | Build the completion view, the ticket preview and the print controls, including the not-printed state a failed print produces. | Simple | 026-007-weighingms-ui, 019-006-ticket-printing | complete |
| 028-007-weighingms-ui | 007-weighingms-ui | Build the degraded states, the status strip and the locale bundle wiring, so that every peripheral failure is visible and specific. | Simple | 027-007-weighingms-ui, 007-005-orgatex-integration, 003-004-scale-integration | complete |
| 029-007-weighingms-ui | 007-weighingms-ui | Wire the five operator views into one working workflow and bring the terminal's presentation up to the supplied prototype. Appended during construction (bolt-replan → append) after the workbook's Step 28 validation found that the screens built by bolts 024–028 work in isolation but cannot be driven end to end. | Simple | 028-007-weighingms-ui | complete |
| 030-003-weighing-station | 003-weighing-station | Implement the overshoot rule the project owner decided at the workbook's Step 24 checkpoint (option C, supervisor-gated). Appended during construction (`bolt-replan` → append). | DDD | 016-003-weighing-station, 029-007-weighingms-ui | complete |

**Next executable bolt:** None — every bolt is complete.

At the start of construction the executable bolts were those with no
dependencies: `001-008-operator-identity`, `003-004-scale-integration`, `005-005-orgatex-integration`.
Construction began with `001-008-operator-identity` (Step 14).
