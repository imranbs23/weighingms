/**
 * Generate the bolt plan for the WeighingMS intent.
 *
 * Why generated
 * -------------
 * The plan must satisfy several invariants that are easy to break by hand
 * and impossible to eyeball:
 *
 *   1. Every story is in exactly one bolt.
 *   2. Every bolt id is unique and the {BBB} prefix is a GLOBAL sequence.
 *   3. Every `requires_bolts` entry names a bolt that exists, and every
 *      `enables_bolts` entry is the mirror of some other bolt's
 *      `requires_bolts` — a mismatch means the execution order the
 *      construction agent reads is not the order the plan claims.
 *   4. No bolt requires a bolt that requires it back (no cycle).
 *   5. No bolt has more than 6 stories.
 *
 * Writing the plan by hand and then checking those properties by eye is how
 * a plan ends up with a stale dependency. So the plan is data, and this
 * script renders it and then proves the properties hold.
 *
 * Usage: node scripts/build-bolt-plan.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTENT = '001-assisted-dyestuff-weighing-station';
const BOLTS_DIR = path.join(ROOT, 'memory-bank', 'bolts');
const CREATED = '2026-10-30T09:00:00Z';

// ── The plan ──────────────────────────────────────────────────────────────
//
// Ordering rationale, in one place so the sequence can be argued with:
//
//   * The three leaf units (004 scale, 005 OrgaTEX, 008 identity) carry the
//     external seams and the security rules. They are built first because
//     everything else reads through them, and because their contracts are
//     the ones most exposed to the undecided external questions
//     (Q-01/Q-02 for OrgaTEX, Q-03 for the scale, Q-08 for identity).
//   * 001 batch and 002 recipe sit on top of the OrgaTEX adapter and form
//     the narrow cycle described in units.md.
//   * 003 weighing-station sits on top of both, because it is the core
//     session state machine and consumes the scale stream, the recipe and
//     the operator.
//   * 006 ticket/audit/config sits on top of 003, because it renders the
//     records 003 produces.
//   * 007 UI sits last, because it consumes every API.
//
// Story ids below are the story FILE SLUGS (without the .md), which is what
// the story files use as their `id`.

const PLAN = [
  // ── 008 operator-identity ───────────────────────────────────────────────
  {
    n: 1,
    unit: '008-operator-identity',
    type: 'ddd-construction-bolt',
    stories: ['001-sign-in-at-terminal'],
    objective:
      'Establish the identity domain: the Operator, the Credential and the ' +
      'IdentitySession, with a local IdentityProvider behind a seam, hashed ' +
      'credentials and opaque session tokens.',
    outputs: [
      'ddd-01-domain-model.md — Operator, Credential, IdentitySession, IdentityProvider',
      'ddd-02-technical-design.md — the local provider, the KDF choice and the session-token contract',
      'src/008-operator-identity/domain — the identity model',
      'src/008-operator-identity/infrastructure — SQLite operator and credential store',
      'src/008-operator-identity/presentation — sign-in / sign-out / current-operator endpoints',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 1, testing_scope: 2 },
    notes:
      'The identity SOURCE is undecided (Q-08). This bolt ships a LOCAL provider ' +
      'behind the IdentityProvider seam; if FCI supplies a directory, only this ' +
      'provider is replaced and every other unit keeps its contract.',
  },
  {
    n: 2,
    unit: '008-operator-identity',
    type: 'ddd-construction-bolt',
    stories: ['002-authorise-privileged-action-as-supervisor'],
    objective:
      'Implement the supervisor authorisation model: a different person, a ' +
      'fresh authentication at the point of action, a mandatory reason, and a ' +
      'scoped, expiring, single-use authorisation.',
    requires: [1],
    outputs: [
      'ddd-01-domain-model.md — SupervisorAuthorisation and its three invariants',
      'ddd-02-technical-design.md — the authorisation interface every call site uses',
      'src/008-operator-identity/domain — the authorisation model and refusal rules',
      'src/008-operator-identity/presentation — the supervisor authorisation endpoint',
    ],
    complexity: { avg_complexity: 3, avg_uncertainty: 1, max_dependencies: 2, testing_scope: 2 },
    notes:
      'This is the only unit where a defect is a compliance breach rather than a ' +
      'usability bug, so the checks live behind ONE interface and are exhausted ' +
      'exhaustively by tests rather than re-implemented at each call site.',
  },

  // ── 004 scale-integration ───────────────────────────────────────────────
  {
    n: 3,
    unit: '004-scale-integration',
    type: 'ddd-construction-bolt',
    stories: ['001-receive-live-weight-stream', '002-detect-disconnection-and-block-weighing'],
    objective:
      'Own the scale device seam: a continuous live-weight stream at ≥ 10 Hz ' +
      'and disconnect detection within 2 s that blocks weighing rather than ' +
      'letting a stale reading pass for a live one.',
    outputs: [
      'ddd-01-domain-model.md — ScaleReading, ScaleStatus and the LinkState value object',
      'ddd-02-technical-design.md — the SSE contract and the staleness rule',
      'src/004-scale-integration/domain — the reading and status model',
      'src/004-scale-integration/infrastructure — the dummy scale adapter',
      'src/004-scale-integration/presentation — the weight SSE endpoint and status endpoint',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 3, testing_scope: 2 },
    notes:
      'B-5 — a scale that returns only a stabilised value rather than a stream is ' +
      'the single largest design risk in the build. The dummy scale streams, and ' +
      'the seam is where a real scale would be substituted.',
  },
  {
    n: 4,
    unit: '004-scale-integration',
    type: 'ddd-construction-bolt',
    stories: ['003-tare-scale-against-container', '004-select-scale-by-capacity'],
    objective:
      'Apply the container tare and select the scale by capacity, so the ' +
      'reading the operator sees is the dyestuff and not the container.',
    requires: [3],
    outputs: [
      'ddd-01-domain-model.md — Tare and ScaleSelection',
      'ddd-02-technical-design.md — the tare sources and the capacity rule',
      'src/004-scale-integration/domain — tare and scale-selection rules',
      'src/004-scale-integration/application — the tare and selection use cases',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 2, testing_scope: 2 },
    notes:
      'CQ-04 — whether the 3 kg and 32 kg scales are one re-zeroed indicator or two ' +
      'devices is undecided. The capacity rule is written against a set of scales, ' +
      'so either answer fits.',
  },

  // ── 005 orgatex-integration ─────────────────────────────────────────────
  {
    n: 5,
    unit: '005-orgatex-integration',
    type: 'ddd-construction-bolt',
    stories: ['001-read-released-batch-queue', '002-read-batch-recipe'],
    objective:
      'Build the OrgaTEX adapter seam and the Dummy OrgaTEX MES behind it: ' +
      'the released batch queue and the batch recipe, read through one ' +
      'adapter that no other unit may bypass.',
    outputs: [
      'ddd-01-domain-model.md — BatchQueueSnapshot, RecipeSnapshot and the adapter interface',
      'ddd-02-technical-design.md — the adapter contract and the training MES contract',
      'src/005-orgatex-integration/domain — the snapshot models',
      'src/005-orgatex-integration/infrastructure — the dummy OrgaTEX MES and the adapter',
      'src/005-orgatex-integration/presentation — the queue and recipe read endpoints',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 3, max_dependencies: 3, testing_scope: 2 },
    notes:
      'A-01 and A-02 are the assumptions that could invalidate the premise: if the ' +
      'MES exposes no API, this bolt’s IMPLEMENTATION is replaced while every ' +
      'other unit keeps its contract. That is the whole purpose of the IR-07 seam.',
  },
  {
    n: 6,
    unit: '005-orgatex-integration',
    type: 'ddd-construction-bolt',
    stories: ['003-post-consumption-idempotently'],
    objective:
      'Post actual consumption idempotently, using a locally generated and ' +
      'tracked idempotency key, so that a retry after a lost response cannot ' +
      'double-count a dye batch.',
    requires: [5],
    outputs: [
      'ddd-01-domain-model.md — ConsumptionPosting and the idempotency key',
      'ddd-02-technical-design.md — the posting contract and the deduplication fallback',
      'src/005-orgatex-integration/domain — the posting model',
      'src/005-orgatex-integration/infrastructure — the idempotency ledger and the posting client',
    ],
    complexity: { avg_complexity: 3, avg_uncertainty: 2, max_dependencies: 2, testing_scope: 2 },
    notes:
      'The key is generated and tracked LOCALLY and carried on the request, because ' +
      'the BRD does not specify its shape and the MES contract is unconfirmed (Q-02). ' +
      'If the real contract has no key field, a local deduplication table gives the ' +
      'same observable behaviour.',
  },
  {
    n: 7,
    unit: '005-orgatex-integration',
    type: 'ddd-construction-bolt',
    stories: ['004-report-link-state', '005-queue-writes-offline-and-sync-on-recovery'],
    objective:
      'Own the link state and the deferred synchronisation queue, so that the ' +
      'station keeps weighing while OrgaTEX is unreachable and nothing is ' +
      'silently discarded.',
    requires: [6],
    outputs: [
      'ddd-01-domain-model.md — LinkState and SyncQueueEntry',
      'ddd-02-technical-design.md — the state machine, the retry policy and the pending semantics',
      'src/005-orgatex-integration/domain — the link-state model',
      'src/005-orgatex-integration/infrastructure — the durable sync queue and the retry worker',
    ],
    complexity: { avg_complexity: 3, avg_uncertainty: 2, max_dependencies: 2, testing_scope: 2 },
    notes:
      'The queue is durable across a restart (NFR-05); the snapshots are not. A ' +
      'snapshot can always be re-fetched — an unlanded consumption posting cannot.',
  },

  // ── 001 batch-management ────────────────────────────────────────────────
  {
    n: 8,
    unit: '001-batch-management',
    type: 'ddd-construction-bolt',
    stories: ['001-retrieve-released-batch-queue'],
    objective:
      'Read the released batch queue through the OrgaTEX adapter and expose it ' +
      'as a station-owned projection with its receipt time.',
    requires: [5],
    outputs: [
      'ddd-01-domain-model.md — BatchQueue and the selection state',
      'ddd-02-technical-design.md — the queue projection and its freshness',
      'src/001-batch-management/domain — the queue model',
      'src/001-batch-management/application — the queue read use case',
      'src/001-batch-management/presentation — the queue endpoint',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 2, testing_scope: 2 },
    notes:
      'The queue is read through the adapter, never from the MES directly (IR-07).',
  },
  {
    n: 9,
    unit: '001-batch-management',
    type: 'ddd-construction-bolt',
    stories: ['002-filter-batch-queue-by-status', '003-select-batch-and-record-identity'],
    objective:
      'Filter the queue by status and turn "the operator picked a batch" into ' +
      'a recorded selection carrying the method by which it was made.',
    requires: [8],
    outputs: [
      'ddd-01-domain-model.md — BatchFilter and BatchSelection',
      'ddd-02-technical-design.md — the filter model and the selection record',
      'src/001-batch-management/domain — the filter and selection rules',
      'src/001-batch-management/presentation — the filter and selection endpoints',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 2, testing_scope: 2 },
    notes:
      'The selection method — scan or touch — is recorded, because B-6 requires the ' +
      'fallback to be distinguishable later.',
  },

  // ── 002 recipe-material-management ──────────────────────────────────────
  {
    n: 10,
    unit: '002-recipe-material-management',
    type: 'ddd-construction-bolt',
    stories: ['001-retrieve-recipe-and-component-list'],
    objective:
      'Load a batch’s recipe through the OrgaTEX adapter — components, targets, ' +
      'units, tolerances and scale classes — and expose it as the single ' +
      'cross-unit call owned by this unit.',
    requires: [5],
    outputs: [
      'ddd-01-domain-model.md — Recipe, RecipeComponent and the quantity value object',
      'ddd-02-technical-design.md — the recipe contract and the fixed-point decimal rule',
      'src/002-recipe-material-management/domain — the recipe model',
      'src/002-recipe-material-management/application — the recipe read use case',
      'src/002-recipe-material-management/presentation — the recipe endpoint',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 2, testing_scope: 2 },
    notes:
      'This is the unit that owns the recipe load, which is how the narrow 001 ↔ 002 ' +
      'cycle in units.md is resolved — by ownership, not by splitting the data.',
  },
  {
    n: 11,
    unit: '002-recipe-material-management',
    type: 'ddd-construction-bolt',
    stories: ['002-verify-dyestuff-identity-by-scan-or-attestation', '003-capture-and-validate-dyestuff-lot'],
    objective:
      'Verify that the dyestuff presented matches the recipe component, by ' +
      'barcode scan where possible and by recorded attestation where not, and ' +
      'capture and validate the lot being consumed.',
    requires: [10],
    outputs: [
      'ddd-01-domain-model.md — DyestuffIdentity, IdentityVerificationMethod and LotCapture',
      'ddd-02-technical-design.md — the scan/attestation contract and the fallback record',
      'src/002-recipe-material-management/domain — the identity and lot rules',
      'src/002-recipe-material-management/presentation — the scan, attest and lot endpoints',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 2, testing_scope: 2 },
    notes:
      'B-6 — the scanner failure path must fall back to attestation and RECORD the ' +
      'fallback, so an unattested weighing is distinguishable in the audit trail. ' +
      'It never silently skips.',
  },
  {
    n: 12,
    unit: '002-recipe-material-management',
    type: 'ddd-construction-bolt',
    stories: ['004-assign-container-and-apply-tare'],
    objective:
      'Assign the container to the component and apply its tare, from the ' +
      'container master or by weighing the empty container.',
    requires: [11, 4],
    outputs: [
      'ddd-01-domain-model.md — Container and the TareSource',
      'ddd-02-technical-design.md — the container assignment and the tare sources',
      'src/002-recipe-material-management/domain — the container and tare rules',
      'src/002-recipe-material-management/presentation — the container and tare endpoints',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 2, testing_scope: 2 },
    notes:
      'This bolt depends on the scale bolt because weighing the empty container is ' +
      'one of the two tare sources.',
  },

  // ── 003 weighing-station ────────────────────────────────────────────────
  {
    n: 13,
    unit: '003-weighing-station',
    type: 'ddd-construction-bolt',
    stories: ['001-select-scale-automatically', '002-consume-live-weight-stream'],
    objective:
      'Open the weighing session: select the scale automatically from the ' +
      'component’s requirements and consume the live weight stream into the ' +
      'session state.',
    requires: [12, 4, 9],
    outputs: [
      'ddd-01-domain-model.md — WeighingSession, the session state machine and the WeightReading',
      'ddd-02-technical-design.md — the session API and the SSE subscription contract',
      'src/003-weighing-station/domain — the session model',
      'src/003-weighing-station/application — the session open and stream-consume use cases',
      'src/003-weighing-station/presentation — the session and snapshot endpoints',
    ],
    complexity: { avg_complexity: 3, avg_uncertainty: 2, max_dependencies: 3, testing_scope: 3 },
    notes:
      'The session snapshot is the ONE source of truth the UI reads. Everything the ' +
      'client shows is derived server-side, which is why the client never computes a zone.',
  },
  {
    n: 14,
    unit: '003-weighing-station',
    type: 'ddd-construction-bolt',
    stories: ['003-evaluate-tolerance-zone', '004-gate-confirmation-on-zone'],
    objective:
      'Evaluate the tolerance zone and gate confirmation on it: the zone is ' +
      'computed once, in one place, and confirmation is possible only while the ' +
      'weight is inside tolerance.',
    requires: [13],
    outputs: [
      'ddd-01-domain-model.md — ToleranceZone and the zone boundary rules',
      'ddd-02-technical-design.md — the zone contract and the confirm gate',
      'src/003-weighing-station/domain — the zone evaluator and the confirm gate',
      'src/003-weighing-station/application — the zone and confirm use cases',
    ],
    complexity: { avg_complexity: 3, avg_uncertainty: 1, max_dependencies: 1, testing_scope: 2 },
    notes:
      'The boundary rules are reproduced from the prototype exactly: the ok band is ' +
      'inclusive at both ends, over is strictly greater, and near begins at 90% of ' +
      'target. Two classifications of the same reading in two places is the failure ' +
      'mode this avoids.',
  },
  {
    n: 15,
    unit: '003-weighing-station',
    type: 'ddd-construction-bolt',
    stories: ['005-detect-overdose-and-calculate-surplus', '006-apply-surplus-compensation'],
    objective:
      'Detect the over-dose, calculate the surplus, and where it is compensable, ' +
      'recalculate the remaining targets proportionally and present them for ' +
      'acceptance.',
    requires: [14],
    outputs: [
      'ddd-01-domain-model.md — Surplus and the CompensationProposal',
      'ddd-02-technical-design.md — the compensability rule and the proportional recalculation',
      'src/003-weighing-station/domain — the surplus and compensation rules',
      'src/003-weighing-station/application — the surplus and compensation use cases',
    ],
    complexity: { avg_complexity: 3, avg_uncertainty: 3, max_dependencies: 1, testing_scope: 2 },
    notes:
      'A-08 / Q-06 bind this bolt. The compensability rule is ASSUMED, not specified ' +
      'by the BRD; if compensation turns out to mean only displaying the excess, this ' +
      'branch is deleted rather than rewritten. The proportional factor is ' +
      'surplus ÷ total remaining target — never a hard-coded constant.',
  },
  {
    n: 16,
    unit: '003-weighing-station',
    type: 'ddd-construction-bolt',
    stories: ['007-escalate-non-compensable-overdose'],
    objective:
      'Escalate a non-compensable over-dose to a supervisor and consume a valid ' +
      'authorisation from the identity unit, recording the authoriser and the reason.',
    requires: [15, 2],
    outputs: [
      'ddd-01-domain-model.md — the Escalation aggregate and its states',
      'ddd-02-technical-design.md — the authorisation consumption contract',
      'src/003-weighing-station/domain — the escalation rules',
      'src/003-weighing-station/presentation — the escalation and override endpoints',
    ],
    complexity: { avg_complexity: 3, avg_uncertainty: 1, max_dependencies: 3, testing_scope: 3 },
    notes:
      'The weighing written under an override records the zone in force at ' +
      'confirmation — the over-dose zone, not OK — so the exception stays visible in ' +
      'the record and in reporting.',
  },
  {
    n: 17,
    unit: '003-weighing-station',
    type: 'ddd-construction-bolt',
    stories: ['008-advance-to-next-component'],
    objective:
      'Advance the session to the first pending component in recipe order after a ' +
      'confirmation, and keep the confirmed component terminal.',
    requires: [14],
    outputs: [
      'ddd-01-domain-model.md — the component lifecycle states',
      'ddd-02-technical-design.md — the progression rule',
      'src/003-weighing-station/domain — the progression rules',
      'src/003-weighing-station/application — the advance use case',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 1, testing_scope: 2 },
    notes:
      'Progression follows recipe order, not operator preference — matching the ' +
      'prototype’s behaviour and the BRD’s own rule.',
  },
  {
    n: 18,
    unit: '003-weighing-station',
    type: 'ddd-construction-bolt',
    stories: ['009-complete-batch-and-summarise'],
    objective:
      'Close the batch at the last component and produce the summary the ticket ' +
      'is rendered from, with the consumption posting handed to the adapter.',
    requires: [17, 6],
    outputs: [
      'ddd-01-domain-model.md — BatchCompletion and the weighing record',
      'ddd-02-technical-design.md — the record schema and the completion contract',
      'src/003-weighing-station/domain — the record and completion rules',
      'src/003-weighing-station/application — the completion use case',
      'src/003-weighing-station/presentation — the completion endpoint',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 3, testing_scope: 3 },
    notes:
      'The confirmed weighing record carries the full traceability set — target, ' +
      'actual, operator, scale, lot and timestamp — because that is what the ticket ' +
      'and the audit trail are rendered from.',
  },

  // ── 006 ticket-printing ────────────────────────────────────────────────
  {
    n: 19,
    unit: '006-ticket-printing',
    type: 'ddd-construction-bolt',
    stories: ['001-generate-weighing-ticket', '002-print-ticket-and-track-job'],
    objective:
      'Render the weighing ticket from a session’s records and print it, ' +
      'tracking the print job as a separate outcome from the weighing itself.',
    requires: [18],
    outputs: [
      'ddd-01-domain-model.md — Ticket, TicketLine and PrintJob',
      'ddd-02-technical-design.md — the template contract and the printer adapter',
      'src/006-ticket-printing/domain — the ticket and print-job model',
      'src/006-ticket-printing/infrastructure — the template renderer and the dummy printer',
      'src/006-ticket-printing/presentation — the ticket and print endpoints',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 2, testing_scope: 2 },
    notes:
      'B-7 — a printer failure must not cost a weighing. Recording and printing are ' +
      'separate operations with separate outcomes, and a failed print leaves the ' +
      'weighing recorded and the job retryable.',
  },
  {
    n: 20,
    unit: '006-ticket-printing',
    type: 'ddd-construction-bolt',
    stories: ['003-reprint-ticket-with-reason'],
    objective:
      'Permit a reprint that is marked as a reprint, carries a reason, and is ' +
      'distinguishable from a first print in both the stored record and the output.',
    requires: [19],
    outputs: [
      'ddd-01-domain-model.md — the reprint marking and its reason',
      'ddd-02-technical-design.md — the reprint contract',
      'src/006-ticket-printing/domain — the reprint rules',
      'src/006-ticket-printing/presentation — the reprint endpoint',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 1, testing_scope: 2 },
    notes:
      'A reprint is a privileged action: it changes what the paper says, so it is ' +
      'audited with actor, reason and time.',
  },
  {
    n: 21,
    unit: '006-ticket-printing',
    type: 'ddd-construction-bolt',
    stories: ['004-record-and-export-audit-trail'],
    objective:
      'Own the append-only, immutable, exportable audit trail for privileged ' +
      'actions, retained ≥ 5 years.',
    requires: [2, 16],
    outputs: [
      'ddd-01-domain-model.md — AuditEntry and the append-only invariant',
      'ddd-02-technical-design.md — the append-only schema and the export format',
      'src/006-ticket-printing/domain — the audit entry model',
      'src/006-ticket-printing/infrastructure — the append-only store and the exporter',
      'src/006-ticket-printing/presentation — the audit query and export endpoints',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 2, testing_scope: 2 },
    notes:
      'The audit trail is a domain concept, not a log file: it is append-only, ' +
      'attributed and reasoned, and retained and exportable. The reason is NOT ' +
      'optional — BRD AC-06 turns on the authorisation being justified.',
  },
  {
    n: 22,
    unit: '006-ticket-printing',
    type: 'ddd-construction-bolt',
    stories: ['005-change-configuration-and-language'],
    objective:
      'Provide a configuration store and runtime-loaded locale bundles, so that ' +
      'scale thresholds, tolerance overrides, the label template and the language ' +
      'change without a redeployment.',
    requires: [19],
    outputs: [
      'ddd-01-domain-model.md — ConfigurationEntry and LocaleBundle',
      'ddd-02-technical-design.md — the versioning, the override visibility rule and the locale loading',
      'src/006-ticket-printing/domain — the configuration model',
      'src/006-ticket-printing/infrastructure — the configuration store and the locale resources',
      'src/006-ticket-printing/presentation — the configuration and locale endpoints',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 2, max_dependencies: 1, testing_scope: 2 },
    notes:
      'A configuration change is itself audited, and a setting that overrides a ' +
      'recipe value records what it overrode and why — because a tolerance override ' +
      'is a way to make an out-of-tolerance weight acceptable.',
  },
  {
    n: 23,
    unit: '006-ticket-printing',
    type: 'ddd-construction-bolt',
    stories: ['006-report-on-tolerance-failures-and-overrides'],
    objective:
      'Produce the operational report over tolerance failures, overrides and ' +
      'configuration changes — the record management asks questions of.',
    requires: [21, 22],
    outputs: [
      'ddd-01-domain-model.md — the report query model',
      'ddd-02-technical-design.md — the report scope and the export artefact',
      'src/006-ticket-printing/application — the report use cases',
      'src/006-ticket-printing/presentation — the report endpoint',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 3, max_dependencies: 2, testing_scope: 2 },
    notes:
      'CQ-07 — whether the dyehouse wants a dashboard or a BI export is undecided. ' +
      'The report is built as a retrievable artefact over data the station already ' +
      'holds, so either answer works without new outbound flow.',
  },

  // ── 007 weighingms-ui ───────────────────────────────────────────────────
  {
    n: 24,
    unit: '007-weighingms-ui',
    type: 'simple-construction-bolt',
    stories: ['001-select-batch-from-queue'],
    objective:
      'Build the app shell, the persistent chrome and the Select-batch view, ' +
      'with batch selection by scan and by touch.',
    requires: [9, 22],
    outputs: [
      'implementation-plan.md — the shell, the chrome and the queue view',
      'src/007-weighingms-ui — the app shell, the topbar crumb, the status strip and the queue view',
      'implementation-walkthrough.md',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 2, testing_scope: 2 },
    notes:
      'No hard-coded data in the client: no batch, no recipe, no component, no weight, ' +
      'no lot. The only literals permitted are the design tokens.',
  },
  {
    n: 25,
    unit: '007-weighingms-ui',
    type: 'simple-construction-bolt',
    stories: ['002-watch-live-weight-and-tolerance-zone'],
    objective:
      'Build the Weigh view — the recipe rail, the live readout, the tolerance ' +
      'band and the status line — driven entirely by the session snapshot.',
    requires: [24, 13],
    outputs: [
      'implementation-plan.md — the weigh view and its data contract',
      'src/007-weighingms-ui — the weigh view, the recipe rail, the readout, the band and the status line',
      'implementation-walkthrough.md',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 2, testing_scope: 3 },
    notes:
      'The zone is RECEIVED, never computed by the client. The disabled state of the ' +
      'confirm button is the visual half of FR-10.',
  },
  {
    n: 26,
    unit: '007-weighingms-ui',
    type: 'simple-construction-bolt',
    stories: ['003-confirm-weighing-and-advance'],
    objective:
      'Build the action row, the confirmation, the progression, the surplus ' +
      'panel and the escalation prompt.',
    requires: [25, 16],
    outputs: [
      'implementation-plan.md — the action row and the two panels',
      'src/007-weighingms-ui — the action row, the confirm flow, the surplus panel and the escalation panel',
      'implementation-walkthrough.md',
    ],
    complexity: { avg_complexity: 3, avg_uncertainty: 1, max_dependencies: 2, testing_scope: 3 },
    notes:
      'A disabled action states its reason. A silently dead button on a gloved ' +
      'terminal is a support call.',
  },
  {
    n: 27,
    unit: '007-weighingms-ui',
    type: 'simple-construction-bolt',
    stories: ['004-review-and-print-ticket'],
    objective:
      'Build the completion view, the ticket preview and the print controls, ' +
      'including the not-printed state a failed print produces.',
    requires: [26, 19],
    outputs: [
      'implementation-plan.md — the completion view and the print controls',
      'src/007-weighingms-ui — the completion view, the ticket preview and the print and reprint controls',
      'implementation-walkthrough.md',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 2, testing_scope: 3 },
    notes:
      'The client never composes the ticket — the template is configuration, so a ' +
      'template or language change needs no redeployment.',
  },
  {
    n: 28,
    unit: '007-weighingms-ui',
    type: 'simple-construction-bolt',
    stories: ['005-show-peripheral-degraded-states'],
    objective:
      'Build the degraded states, the status strip and the locale bundle wiring, ' +
      'so that every peripheral failure is visible and specific.',
    requires: [27, 7, 3],
    outputs: [
      'implementation-plan.md — the status strip, the degraded states and the locale wiring',
      'src/007-weighingms-ui — the status strip, the degraded-state views and the locale bundle client',
      'implementation-walkthrough.md',
    ],
    complexity: { avg_complexity: 2, avg_uncertainty: 1, max_dependencies: 3, testing_scope: 3 },
    notes:
      'No failure at any boundary may produce a silently wrong number. The ' +
      'hard-coded ORGATEX · LINKED of the prototype becomes a real state.',
  },
];

// ── Render ────────────────────────────────────────────────────────────────

function boltDir(b) {
  return path.join(BOLTS_DIR, `${String(b.n).padStart(3, '0')}-${b.unit}`);
}

function boltId(b) {
  return `${String(b.n).padStart(3, '0')}-${b.unit}`;
}

/** Mirror requires_bolts into enables_bolts so the two can never disagree. */
function computeEnables(plan) {
  const enables = new Map(plan.map((b) => [b.n, []]));
  for (const b of plan) {
    for (const r of b.requires || []) {
      if (!enables.has(r)) throw new Error(`bolt ${b.n} requires unknown bolt ${r}`);
      enables.get(r).push(boltId(b));
    }
  }
  return enables;
}

/** Every unit whose bolts must exist before this unit's bolts can run. */
function computeRequiresUnits(b) {
  const units = new Set();
  for (const r of b.requires || []) {
    const dep = PLAN.find((x) => x.n === r);
    if (dep && dep.unit !== b.unit) units.add(dep.unit);
  }
  return [...units].sort();
}

const ENABLES = computeEnables(PLAN);

/** The stage list, by bolt type. */
const STAGES = {
  'ddd-construction-bolt': [
    ['1. model', 'Domain Model', 'ddd-01-domain-model.md'],
    ['2. design', 'Technical Design', 'ddd-02-technical-design.md'],
    ['3. adr', 'ADR Analysis (optional)', 'adr-{n}-{slug}.md'],
    ['4. implement', 'Implement', 'source code'],
    ['5. test', 'Test', 'ddd-03-test-report.md'],
  ],
  'simple-construction-bolt': [
    ['1. plan', 'Plan', 'implementation-plan.md'],
    ['2. implement', 'Implement', 'source code + implementation-walkthrough.md'],
    ['3. test', 'Test', 'test-walkthrough.md'],
  ],
};

function renderBolt(b, enables) {
  const id = boltId(b);
  const stages = STAGES[b.type];
  const requiresUnits = computeRequiresUnits(b);

  const fm = [
    '---',
    `id: ${id}`,
    `unit: ${b.unit}`,
    `intent: ${INTENT}`,
    `type: ${b.type}`,
    'status: planned',
    'stories:',
    ...b.stories.map((s) => `  - ${s}`),
    `created: ${CREATED}`,
    'started: null',
    'completed: null',
    'current_stage: null',
    'stages_completed: []',
    '',
    '# Bolt Dependencies (for execution ordering)',
    // These MUST be emitted as a single YAML list. Emitting one
    // "requires_bolts:" key per dependency produces a document with duplicate
    // keys, and a YAML parser silently keeps only the last one — the plan
    // would then claim fewer dependencies than it has.
    ...(b.requires || []).length
      ? ['requires_bolts:', ...b.requires.map((r) => `  - ${boltId(PLAN.find((x) => x.n === r))}`)]
      : ['requires_bolts: []'],
    ...(enables.length ? ['enables_bolts:', ...enables.map((e) => `  - ${e}`)] : ['enables_bolts: []']),
    ...(requiresUnits.length
      ? ['requires_units:', ...requiresUnits.map((u) => `  - ${u}`)]
      : ['requires_units: []']),
    'blocks: false',
    '',
    '# Complexity Assessment (aggregate of included stories)',
    'complexity:',
    `  avg_complexity: ${b.complexity.avg_complexity}`,
    `  avg_uncertainty: ${b.complexity.avg_uncertainty}`,
    `  max_dependencies: ${b.complexity.max_dependencies}`,
    `  testing_scope: ${b.complexity.testing_scope}`,
    '---',
  ];

  const body = [
    '',
    `# Bolt: ${id}`,
    '',
    '## Overview',
    '',
    b.objective,
    '',
    '## Objective',
    '',
    b.objective,
    '',
    '## Stories Included',
    '',
    ...b.stories.map((s) => `- [ ] **${s}**: ${storyTitle(s)} - Priority: ${storyPriority(s)}`),
    '',
    '## Bolt Type',
    '',
    `**Type**: ${b.type}`,
    `**Definition**: \`.specsmd/aidlc/templates/construction/bolt-types/${b.type}.md\``,
    '',
    '## Stages',
    '',
    ...stages.map(
      ([n, name, artefact]) => `- [ ] **${n}**: ${name} - Pending → ${artefact}`
    ),
    '',
    '## Expected Outputs',
    '',
    ...b.outputs.map((o) => `- ${o}`),
    '',
    '## Dependencies',
    '',
    '### Requires',
    '',
    ...(b.requires || []).length
      ? b.requires.map((r) => {
          const dep = PLAN.find((x) => x.n === r);
          return `- **${boltId(dep)}** — ${dep.objective.split('.')[0]}.`;
        })
      : ['- None (first bolt)'],
    '',
    '### Unit Dependencies (cross-unit)',
    '',
    ...(requiresUnits.length
      ? requiresUnits.map((u) => `- **${u}**: must be complete before this bolt can start.`)
      : ['- None']),
    '',
    '### Enables',
    '',
    ...(enables.length ? enables.map((e) => `- ${e}`) : ['- None']),
    '',
    '## Success Criteria',
    '',
    '- [ ] All stories implemented',
    '- [ ] All acceptance criteria met',
    '- [ ] Tests passing',
    '- [ ] Code reviewed and approved',
    '',
    '## Notes',
    '',
    b.notes,
    '',
  ];

  return [...fm, ...body].join('\n');
}

// ── Story metadata lookup ────────────────────────────────────────────────
const STORY_META = {};
function loadStoryMeta() {
  const unitsDir = path.join(ROOT, 'memory-bank', 'intents', INTENT, 'units');
  for (const u of fs.readdirSync(unitsDir)) {
    const dir = path.join(unitsDir, u, 'stories');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      const slug = f.replace(/\.md$/, '');
      const pri = /^priority:\s*(\S+)/m.exec(s)?.[1] || 'must';
      const id = /^id:\s*(\S+)/m.exec(s)?.[1] || slug;
      STORY_META[id] = { priority: pri, unit: u, slug };
    }
  }
}
loadStoryMeta();

function storyTitle(slug) {
  const body = slug.replace(/^\d{3}-/, '').replace(/-/g, ' ');
  return body.charAt(0).toUpperCase() + body.slice(1);
}
function storyPriority(slug) {
  const m = STORY_META[slug];
  return m ? m.priority : 'must';
}

// ── Write ─────────────────────────────────────────────────────────────────
fs.mkdirSync(BOLTS_DIR, { recursive: true });
for (const b of PLAN) {
  const dir = boltDir(b);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bolt.md'), renderBolt(b, ENABLES.get(b.n)), 'utf8');
}

// ── Validate ──────────────────────────────────────────────────────────────
const problems = [];

// 1. every story in exactly one bolt
const assigned = new Map();
for (const b of PLAN) {
  for (const s of b.stories) {
    if (assigned.has(s)) problems.push(`story "${s}" is in two bolts`);
    assigned.set(s, b.n);
  }
}
for (const id of Object.keys(STORY_META)) {
  if (!assigned.has(id)) problems.push(`story "${id}" is not assigned to any bolt`);
}
for (const s of assigned.keys()) {
  if (!STORY_META[s]) problems.push(`bolt references unknown story "${s}"`);
}

// 2. unique ids, global sequence
const ids = PLAN.map((b) => b.n);
if (new Set(ids).size !== ids.length) problems.push('duplicate bolt numbers');
for (let i = 0; i < PLAN.length; i++) {
  if (ids[i] !== i + 1) problems.push(`bolt numbering is not a contiguous global sequence at ${i + 1}`);
}

// 3. enables mirrors requires
for (const b of PLAN) {
  const mine = new Set(ENABLES.get(b.n));
  for (const e of mine) {
    const dep = PLAN.find((x) => boltId(x) === e);
    if (!dep) problems.push(`bolt ${b.n} enables unknown bolt ${e}`);
    else if (!(dep.requires || []).includes(b.n))
      problems.push(`bolt ${b.n} enables ${e}, but ${e} does not require it`);
  }
}

// 4. no cycles
function detectCycle() {
  const seen = new Set();
  const stack = new Set();
  function visit(n) {
    if (stack.has(n)) return [n];
    if (seen.has(n)) return null;
    seen.add(n);
    stack.add(n);
    for (const r of PLAN.find((b) => b.n === n)?.requires || []) {
      const c = visit(r);
      if (c) return c;
    }
    stack.delete(n);
    return null;
  }
  for (const b of PLAN) {
    const c = visit(b.n);
    if (c) return c;
  }
  return null;
}
const cycle = detectCycle();
if (cycle) problems.push(`dependency cycle: ${cycle.join(' -> ')}`);

// 5. size limit
for (const b of PLAN) {
  if (b.stories.length > 6) problems.push(`bolt ${b.n} has ${b.stories.length} stories (max 6)`);
  if (b.stories.length === 0) problems.push(`bolt ${b.n} has no stories`);
}

// 6. cross-unit dependency declared
for (const b of PLAN) {
  const declared = new Set(computeRequiresUnits(b));
  for (const r of b.requires || []) {
    const dep = PLAN.find((x) => x.n === r);
    if (dep.unit !== b.unit && !declared.has(dep.unit))
      problems.push(`bolt ${b.n} requires ${boltId(dep)} from unit ${dep.unit} but does not declare it`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`wrote ${PLAN.length} bolt directories\n`);
for (const b of PLAN) {
  console.log(
    `  ${boltId(b)}  (${b.type === 'simple-construction-bolt' ? 'simple' : 'ddd'})  ` +
      `${b.stories.length} stor${b.stories.length === 1 ? 'y' : 'ies'}`
  );
}
console.log(`\ntotal stories covered: ${assigned.size} / ${Object.keys(STORY_META).length}`);

if (problems.length === 0) {
  console.log('\n✅ Bolt plan is valid: every story assigned once, global sequence contiguous,');
  console.log('   enables mirror requires, no cycles, no bolt over 6 stories.');
  process.exit(0);
}
console.log(`\n❌ ${problems.length} problem(s):`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
