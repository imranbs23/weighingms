---
last_updated: 2026-11-04T16:00:00Z
total_decisions: 28
---

# Decision Index

This index tracks all Architecture Decision Records (ADRs) created during Construction bolts.
Use this to find relevant prior decisions when working on related features.

## How to Use

**For Agents**: Scan the "Read when" fields below to identify decisions relevant to your current task. Before implementing new features, check if existing ADRs constrain or guide your approach. Load the full ADR for matching entries.

**For Humans**: Browse decisions chronologically or search by keywords. Each entry links to the full ADR with complete context, alternatives considered, and consequences.

---

## Decisions

<!-- Entries are appended below in reverse chronological order (newest first) -->
<!-- Format for each entry:

### ADR-{n}: {title}
- **Status**: {proposed|accepted|deprecated|superseded}
- **Date**: {YYYY-MM-DD}
- **Bolt**: {bolt-id} ({unit-name})
- **Path**: `bolts/{bolt-id}/adr-{n}-{slug}.md`
- **Summary**: {First sentence from Context}. {First sentence from Decision}.
- **Read when**: {Agent guidance - domain keywords and scenarios when this ADR is relevant}

-->

### ADR-028: The station owns its own queue endpoint, and reads the MES only through unit 005's reader
- **Status**: accepted
- **Date**: 2026-11-04
- **Bolt**: 008-001-batch-management (001-batch-management)
- **Path**: `bolts/008-001-batch-management/adr-028-the-stations-own-queue-endpoint.md`
- **Summary**: FR-1 forbids the prototype's hard-coded queue rows, and three things could serve the read — unit 005's own endpoint, the Dummy MES's endpoint, or a second reader of the adapter — and the third would create two readers of one seam, two contacts, two caches and therefore two sources of truth for the same queue. Give unit 001 its own `GET /api/batch-queue` endpoint and read the MES only through a port unit 001 owns, bound in the composition root to unit 005's reader — in process, never over the network, and never with a cache or a table of its own — and pass unit 005's freshness decision through unchanged rather than re-deciding staleness, because the threshold that decides it is unit 005's configuration.
- **Read when**: Implementing or changing the batch queue endpoint, the queue projection or the station's view of the released work; working on the selection, the filter or the queue screen; deciding whether to call the OrgaTEX adapter or unit 005's endpoint from another unit; adding a second reader of the MES seam or a second cache for the queue; choosing a path under `/api`; working on staleness or the receipt time.

### ADR-027: The MES link state is derived, and the sync queue is the only durable record of an unlanded consumption
- **Status**: accepted
- **Date**: 2026-11-03
- **Bolt**: 007-005-orgatex-integration (005-orgatex-integration)
- **Path**: `bolts/007-005-orgatex-integration/adr-027-the-link-state-and-the-durable-sync-queue.md`
- **Summary**: The station must keep weighing while OrgaTEX is unreachable, and no failure at any boundary may produce a silently wrong number — so the MES link state is DERIVED from observed contact outcomes by one pure policy (never stored, never hard-coded, never blocking a weighing), and an undeliverable consumption is recorded in a durable queue that survives a restart and is later delivered with the same idempotency key, in order, without duplication. The queue reuses bolt 006's ledger-guarded posting path rather than writing a second send path, and the rejection disposition is consumed as configuration, never re-decided.
- **Read when**: Implementing or changing the link state, its derivation, the freshness window or the scheduled deadline; working on the sync queue, the enqueue guard, the backoff, the retry worker or the flush on recovery; deciding whether a queue entry may be deleted, pruned or re-keyed; changing the rejection disposition's effect; reviewing a proposal to add a second MES adapter, a health probe or a second implementation of the idempotency check.

### ADR-026: The rejection disposition is configuration, and defaults to RETRYABLE
- **Status**: accepted
- **Date**: 2026-11-02
- **Bolt**: 006-005-orgatex-integration (005-orgatex-integration)
- **Path**: `bolts/006-005-orgatex-integration/adr-026-the-rejection-disposition-is-configuration.md`
- **Summary**: CQ-06 asks whether a rejected posting is permanent or retryable, and the two answers lead to genuinely different product behaviour — under PERMANENT a transient rejection is never sent again, and the consumption is silently missing from the order. Make the disposition a configuration value and default it to RETRYABLE, because the failure modes are asymmetric: a permanently-dropped consumption is a silently wrong number, while a noisy retry is a visible problem. The default is explicitly NOT an answer to CQ-06, and the posting's state is REJECTED under either disposition — the disposition decides whether bolt 007 re-drives it.
- **Read when**: Implementing or changing the rejection handling, the retry machinery or the failure disposition; working on CQ-06; deciding whether a failed posting is re-sent or abandoned; changing the OrgaTEX configuration; reviewing a proposal to discard a rejected posting; setting a deployment's rejection policy.

### ADR-025: The local ledger is the guarantee, because the MES's contract is unknown
- **Status**: accepted
- **Date**: 2026-11-02
- **Bolt**: 006-005-orgatex-integration (005-orgatex-integration)
- **Path**: `bolts/006-005-orgatex-integration/adr-025-the-local-ledger-is-the-guarantee.md`
- **Summary**: A-02 and Q-02 mean the MES's write contract is unknown — and whether it deduplicates is the one property that decides whether a retry double-counts a dye batch. Assume the worst case: the MES does not deduplicate and does not read the key, and the local ledger guarantees that at most one copy of a consumption ever leaves the station. The key is still carried on the request as a second line of defence, and no claim is made that OrgaTEX understands it.
- **Read when**: Changing the posting path, the idempotency key's derivation or the adapter's write methods; working on A-02, Q-01 or Q-02; deciding whether the local ledger is still needed once the real MES is connected; changing what is sent to the MES; reviewing a proposal to drop the key from the request.

### ADR-024: The posting's content is immutable, and the state transition is the only mutation
- **Status**: accepted
- **Date**: 2026-11-02
- **Bolt**: 006-005-orgatex-integration (005-orgatex-integration)
- **Path**: `bolts/006-005-orgatex-integration/adr-024-the-postings-content-is-immutable.md`
- **Summary**: BRD DR-02 wants immutability but a posting genuinely has a lifecycle — it becomes ACCEPTED or REJECTED — so the resolution is partial: the content is written once and never again, only the outcome may change, only once, and only from QUEUED, with the repository exposing no general update and the SQL carrying a WHERE state = 'QUEUED' guard so a double-resolution affects zero rows and raises.
- **Read when**: Implementing or changing the posting repository, the state transition or the attempt history; adding a column to the postings table; reviewing a proposal for an update method, an updated_at column or a version column; working on DR-02; correcting a posted consumption; implementing the rejection reason.

### ADR-023: The ledger's primary key is the idempotency guarantee
- **Status**: accepted
- **Date**: 2026-11-02
- **Bolt**: 006-005-orgatex-integration (005-orgatex-integration)
- **Path**: `bolts/006-005-orgatex-integration/adr-023-the-ledgers-primary-key-is-the-idempotency-guarantee.md`
- **Summary**: IR-08 requires idempotent posting and the story names a concurrency case — two submissions of the same key at once, where exactly one must be admitted — so the guard has to be atomic rather than merely present. Make the idempotency ledger a table whose PRIMARY KEY is the key: the uniqueness constraint IS the guard, there is no check-then-write window, the ledger is separate from the postings so the dedup decision never reads mutable state, and there is no delete path so a consumed key is consumed forever.
- **Read when**: Designing or changing the idempotency ledger, the dedup check or the retention of consumed keys; adding an idempotency_key column to another table; implementing the duplicate refusal; working on concurrency or on DR-01 retention; reviewing a proposal to clean up or prune the ledger.

### ADR-022: The adapter's transport is not exercised by the tests
- **Status**: accepted
- **Date**: 2026-11-02
- **Bolt**: 005-005-orgatex-integration (005-orgatex-integration)
- **Path**: `bolts/005-005-orgatex-integration/adr-022-the-adapters-transport-is-not-exercised-by-the-tests.md`
- **Summary**: BRD IR-07's seam is only worth having if the other side can actually be swapped, and A-01/Q-01 mean the contract on that side does not exist yet — so what the tests prove must be stated precisely. Keep the adapter in process so the domain rules are tested without a socket, keep the Dummy MES's HTTP router alongside it so the training artefact is real and curl-able, and record explicitly that the transport is untested until a real adapter exists.
- **Read when**: Writing or reviewing a real OrgaTEX adapter or any HTTP transport in this product; deciding what a test suite has actually proven about an external integration; adding an adapter to a port; reviewing a claim that the seam is exercised end to end.

### ADR-021: The snapshots are not persisted, but the last known-good is held in memory
- **Status**: accepted
- **Date**: 2026-11-02
- **Bolt**: 005-005-orgatex-integration (005-orgatex-integration)
- **Path**: `bolts/005-005-orgatex-integration/adr-021-the-snapshots-are-not-persisted.md`
- **Summary**: FR-20 requires a `DEGRADED` read to serve the last successful snapshot marked with its age, while the unit brief says snapshots are not persisted — and both are right, because they are about different things. Hold the last known-good in a bounded, disposable in-memory cache and persist nothing, so the stale-looking-fresh path is impossible by construction rather than merely guarded against.
- **Read when**: Adding a table, repository or cache for the batch queue or a recipe; deciding whether a MES snapshot may survive a restart; working on the `DEGRADED` fallback or the freshness window; deciding what unit 002's recipe cache owns; reviewing a proposal to persist the queue "just to be safe".

### ADR-020: The OrgaTEX reads require an operator session
- **Status**: accepted
- **Date**: 2026-11-02
- **Bolt**: 005-005-orgatex-integration (005-orgatex-integration)
- **Path**: `bolts/005-005-orgatex-integration/adr-020-the-orgatex-reads-require-an-operator-session.md`
- **Summary**: ADR-013 left the scale's read endpoints open because a scale's weight is physically visible at the station and the UI needs the status strip before sign-in — and neither premise holds for the MES queue, which is OrgaTEX's production schedule and sits behind a sign-in the workflow already requires. Require an operator session, not a supervisor authorisation, and narrow ADR-013's rule to devices that are physically present at the station.
- **Read when**: Adding or changing any OrgaTEX endpoint; deciding what requires an operator session; working on the batch queue screen or the UI's boot sequence; applying ADR-013 to a new endpoint; reviewing information exposure on the MES seam.

### ADR-019: The selection threshold is configuration, and is unset until FCI answers
- **Status**: accepted
- **Date**: 2026-10-31
- **Bolt**: 004-004-scale-integration (004-scale-integration)
- **Path**: `bolts/004-004-scale-integration/adr-019-the-selection-threshold-is-configuration.md`
- **Summary**: Q-04 asks FCI production for the scale-selection threshold and the boundary behaviour, and A-06 binds the story until it is answered, yet the acceptance criteria are already fully decided by the capacity constraint alone — a target of exactly 3 kg is within the precision scale's capacity. Make the threshold a configuration parameter that is currently unset and write the rule against a set of devices, so the capacity constraint carries the rule today and answering Q-04 is a configuration change rather than a code change.
- **Read when**: Changing the scale-selection rule or its threshold; working on Q-04 or A-06; adding a third scale or changing a scale's capacity; deciding whether to hard-code the 3 kg boundary; writing the selection unit tests.

### ADR-018: "No device can weigh this" is a successful outcome, not an error
- **Status**: accepted
- **Date**: 2026-10-31
- **Bolt**: 004-004-scale-integration (004-scale-integration)
- **Path**: `bolts/004-004-scale-integration/adr-018-no-device-can-weigh-this-is-a-successful-outcome.md`
- **Summary**: The story requires an explicit "no device can weigh this" outcome carrying the target and the maximum available capacity, and a 4xx would make the caller treat a legitimate business answer as a failure — alerting on it, showing the operator an error, and retrying a deterministic answer. Return 200 with `selected: false`, and model the outcome as a discriminated union so a caller cannot read a `scaleId` without first proving one was selected.
- **Read when**: Choosing a status code for a business outcome; changing the selection endpoint's response shape; modelling the selection result in the domain; deciding whether a refusal should be logged as an error; building the operator's "cannot weigh this" message.

### ADR-017: The capacity constraint wins over the scale-class demand
- **Status**: accepted
- **Date**: 2026-10-31
- **Bolt**: 004-004-scale-integration (004-scale-integration)
- **Path**: `bolts/004-004-scale-integration/adr-017-capacity-constraint-wins-over-class-demand.md`
- **Summary**: When a component demands precision but its target is 4 kg, the two constraints cannot both hold — the class constraint is a measurement-quality preference while the capacity constraint is a physical impossibility, and honouring the class would mean the 4 kg component could never be weighed at all. Select the floor scale, and record the conflict in the selection's reason so the loss of precision stays visible in the durable record.
- **Read when**: Changing the scale-selection rule or its reason enum; handling a component whose quantity and class disagree; deciding what happens when no candidate matches the demanded class; building a consumer that must react to a coarser-than-demanded measurement.

### ADR-016: The net reading floors at zero
- **Status**: accepted
- **Date**: 2026-10-31
- **Bolt**: 004-004-scale-integration (004-scale-integration)
- **Path**: `bolts/004-004-scale-integration/adr-016-the-net-reading-floors-at-zero.md`
- **Summary**: A gross reading below the tare — an empty container removed from a scale zeroed against it — produces a net reading of −214 g, and a negative dispensed quantity is not a thing that exists. Clamp the net reading at zero at the adapter, where the tare is subtracted, so the negative number is never produced and no consumer has to remember to clamp; the tare itself is unaffected.
- **Read when**: Writing the tare subtraction or the adapter's reading pipeline; working on the below-tare or empty-container case; deciding how a reading is bounded; changing the reading's shape or its consumers.

### ADR-015: The tare is never persisted
- **Status**: accepted
- **Date**: 2026-10-31
- **Bolt**: 004-004-scale-integration (004-scale-integration)
- **Path**: `bolts/004-004-scale-integration/adr-015-the-tare-is-never-persisted.md`
- **Summary**: The unit brief says the tare is held in memory, per device, but not why — and the reason is that a stale tare read back after a restart is a wrong number, not an inconvenience: the scale would report net weight against a container that is no longer on it, and the operator would have no way to know. Persist no tare and provide no `TareRepository`, so the `scale_devices` table gains no tare column and the failure is impossible by construction.
- **Read when**: Adding a column, table or repository for the tare; designing the scale unit's persistence; working on restart, recovery or power loss; deciding what a status view shows after a restart; reviewing a proposal to "just save the current tare".

### ADR-014: The tare is applied at the device, and the reading carries it
- **Status**: accepted
- **Date**: 2026-10-31
- **Bolt**: 004-004-scale-integration (004-scale-integration)
- **Path**: `bolts/004-004-scale-integration/adr-014-the-tare-is-applied-at-the-device.md`
- **Summary**: The tare is applied once but persists into every subsequent reading, so a consumer that subtracted it from its own copy would have to know whether the device already did — and would double-subtract whenever a second consumer attached mid-session, producing a plausible wrong number with no error. Apply the tare at the device: the reading the device emits is net and carries the tare that produced it, so there is nothing left to subtract and nothing to coordinate.
- **Read when**: Changing the reading's shape or adding a consumer of readings; deciding where the tare is subtracted; working on the indicator's tare command (Q-03); implementing the adapter's tare path; reviewing a proposal to subtract the tare in a consumer or in the UI.

### ADR-013: The scale telemetry endpoints are not behind an operator session
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 003-004-scale-integration (004-scale-integration)
- **Path**: `bolts/003-004-scale-integration/adr-013-scale-telemetry-endpoints-are-not-session-authenticated.md`
- **Summary**: Every endpoint in the identity unit requires a session, but a scale's current weight and calibration state are physically visible to anyone at the station, and the UI needs the status strip before anyone signs in. Leave the read endpoints open and session-guard only the write endpoints that change device state, and make them require a session but NOT a supervisor, because they authorise nothing.
- **Read when**: Adding or changing any scale endpoint; deciding what requires an operator session; working on the peripheral status strip or the UI's boot sequence; deciding whether a training control needs supervisor authorisation; exposing the API beyond the station's own network segment.

### ADR-012: The disconnection watchdog is scheduled, not polled
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 003-004-scale-integration (004-scale-integration)
- **Path**: `bolts/003-004-scale-integration/adr-012-the-disconnection-watchdog-is-scheduled-not-polled.md`
- **Summary**: IR-13 requires disconnection detection within 2 seconds, and a polled watchdog quantises that latency to the poll interval — at the stream's 10 Hz that is 2.1 s against a 2.0 s requirement, and the three boundary test points cannot be hit exactly. Schedule the deadline from the last reading's receipt time through a scheduler port, and let a pure policy decide the answer so the timer only decides when to ask.
- **Read when**: Working on disconnection detection, the 2 s timeout, or any deadline in this product; deciding whether to poll or schedule; adding a `WatchdogScheduler` port or a timer to a domain service; testing a time boundary exactly.

### ADR-011: Link state is a separate axis from the published device status
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 003-004-scale-integration (004-scale-integration)
- **Path**: `bolts/003-004-scale-integration/adr-011-link-state-is-separate-from-device-status.md`
- **Summary**: The published vocabulary has five statuses but two of them are facts the device says about itself, `DISCONNECTED` is a fact we conclude because the device stopped talking, and a device that has never spoken fits neither rule — yet both failure modes must publish as `DISCONNECTED`. Keep the link state (`UNKNOWN`/`UP`/`DOWN`) as its own axis, publish both failure modes as `DISCONNECTED`, and preserve the difference in the gate's refusal reason.
- **Read when**: Working on device status, link state, or the disconnection gap; adding a device status value; deciding what the status strip shows; distinguishing "went silent" from "never responded"; writing a device's `startedAt`.

### ADR-010: `ZEROED` does not block weighing
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 003-004-scale-integration (004-scale-integration)
- **Path**: `bolts/003-004-scale-integration/adr-010-zeroed-does-not-block-weighing.md`
- **Summary**: The story says "only `CONNECTED` is a state in which weighing may proceed", but `ZEROED` is what a tared scale is, and tare exists to enable the weighing — read literally, the rule makes a correctly prepared station refuse its weighing. Read the rule as "only a *connected* device may proceed"; `ZEROED` is a state of readiness, not a fault, and every blocking status names its own reason.
- **Read when**: Changing the weighing gate or its block reasons; working on tare, zeroing or a container tare; adding a device status value; checking conformance against the disconnection story's wording; wondering why a zeroed scale is allowed to be weighed on.

### ADR-009: Weight readings are never persisted, and the absence of a repository is the enforcement
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 003-004-scale-integration (004-scale-integration)
- **Path**: `bolts/003-004-scale-integration/adr-009-weight-readings-are-never-persisted.md`
- **Summary**: Persisting readings is the obvious choice and it is what makes a stale reading readable as a live one — the "latest reading" query returns an hour-old value from a scale that died, with nothing in the query to say so, which is the exact confusion the disconnection rule exists to prevent. Persist no readings and provide no reading repository, so the failure is impossible by construction; the durable facts that investigation needs are the confirmed weighing record, the disconnection gap and the audit trail.
- **Read when**: Adding a table, repository or endpoint for weight readings or weight history; deciding what to persist in the scale unit; building a "weight history" screen or a trend view; working on the reading stream's hot path; investigating what evidence exists after an incident.

### ADR-008: The weight value crosses the wire as a decimal string, not a JSON number
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 003-004-scale-integration (004-scale-integration)
- **Path**: `bolts/003-004-scale-integration/adr-008-weight-value-crosses-the-wire-as-a-decimal-string.md`
- **Summary**: BRD NFR-16 forbids floating point for quantities and the domain honours it with a string-only `WeightValue` constructor, but the approved tech stack's own SSE example shows `"weight":93.42` — a JSON number, which every parser decodes to an IEEE-754 double, so the example undoes the domain guarantee in transit. Send the value as a decimal string, use the story's field names, and apply the same rule to every quantity on every boundary.
- **Read when**: Writing or changing any API that returns a quantity; working on the SSE weight frame, the status view or the weigh record; deciding whether a JSON number is acceptable for a weight; working on tolerance boundary tests or the no-floating-point rule; parsing a quantity on the client side.

### ADR-007: Record the operator an authorisation was issued for
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 002-008-operator-identity (008-operator-identity)
- **Path**: `bolts/002-008-operator-identity/adr-007-record-the-operator-the-authorisation-was-issued-for.md`
- **Summary**: ADR-003 requires a consume request to carry the live session of "the operator the authorisation was issued **for**", but the entity never recorded who it was for — so only the weaker "distinct from the supervisor" check could be applied, and an authorisation raised for operator A could be applied by operator B. Record `requestedOperatorId` on the authorisation and check it on both the consume and the read path.
- **Read when**: Implementing or changing the authorisation consume or read path; deciding how an authorisation is bound to an operator; working on credential scope, blast radius, or revocation; reviewing the weighing override flow's data model; adding a `RefusalReason` value and wondering why it is unreachable.

### ADR-006: Consumption is a separate append-only record, not a flag on the authorisation
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 002-008-operator-identity (008-operator-identity)
- **Path**: `bolts/002-008-operator-identity/adr-006-consumption-as-a-separate-append-only-record.md`
- **Summary**: A `consumed_at` column on the authorisation would mutate a record that BRD DR-02 requires to be immutable, and a boolean flag records even less. Record consumption as a separate append-only `authorisation_consumptions` row whose `UNIQUE` constraint on `authorisation_id` makes the single-use rule atomic under concurrency.
- **Read when**: Implementing or changing the authorisation consume path; deciding how single-use is enforced; working on append-only records, immutability, or retention; designing tables in the identity unit; reviewing the weighing override flow's data model.

### ADR-005: Store the authorisation reason in clear text
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 002-008-operator-identity (008-operator-identity)
- **Path**: `bolts/002-008-operator-identity/adr-005-store-authorisation-reason-in-clear-text.md`
- **Summary**: Every credential in this product is stored hashed, so storing the supervisor's reason in clear text looks like an inconsistency — but the reason is not a secret, it authorises nothing, and it must be readable by an auditor years later. Store it as given; hashing it would permanently destroy the audit record and encryption would add a key to protect non-secret data.
- **Read when**: Deciding how to store free-text justification or audit content; working on the audit trail's data model; reviewing encryption, hashing, or "no plaintext at rest" policies; handling the authorisation reason anywhere in the system.

### ADR-004: One uniform response for every authorisation refusal
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 002-008-operator-identity (008-operator-identity)
- **Path**: `bolts/002-008-operator-identity/adr-004-uniform-authorisation-refusal-response.md`
- **Summary**: There are twelve ways to refuse a privileged action, and a precise error is a map of the defences — a `SELF_AUTHORISATION` refusal confirms the credential was accepted. Return one status and one body (`403 AUTHORISATION_REFUSED`) for every refusal, and route the named reason to the audit trail instead.
- **Read when**: Designing or changing any authorisation endpoint's error responses; adding a new refusal reason; working on supervisor prompts or the escalation UI; reviewing information disclosure in the identity unit.

### ADR-003: The authorisation id is not a bearer credential
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 002-008-operator-identity (008-operator-identity)
- **Path**: `bolts/002-008-operator-identity/adr-003-authorisation-id-is-not-a-bearer-credential.md`
- **Summary**: An authorisation id must be presented at the point of use, and the question is whether it alone authorises the action or must accompany the operator's live session. Require both: the id says which approval applies, the session says who is applying it, so a leaked id authorises nothing.
- **Read when**: Implementing the authorisation consume path; designing the API between the weighing station and the identity unit; working on credential scope, blast radius, or revocation; reviewing how privileged actions are authorised.

### ADR-002: Store session tokens as a digest, not in plaintext
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 001-008-operator-identity (008-operator-identity)
- **Path**: `bolts/001-008-operator-identity/adr-002-store-session-tokens-as-digests.md`
- **Summary**: The session table holds live credentials that anyone who copies it can use verbatim, unlike a password they would first have to crack. Store only a SHA-256 digest of the session token; the raw token is returned to the client once at sign-in and never persisted.
- **Read when**: Working on authentication flows, session management, or session storage; designing any API that carries a bearer token; deciding what goes in a database table that holds credentials; working on sign-out, session expiry, or session revocation; reviewing security properties of the identity unit.

### ADR-001: Use Argon2id from Node's built-in `crypto` for credential hashing
- **Status**: accepted
- **Date**: 2026-10-30
- **Bolt**: 001-008-operator-identity (008-operator-identity)
- **Path**: `bolts/001-008-operator-identity/adr-001-argon2id-via-node-builtin-crypto.md`
- **Summary**: The tech stack requires a memory-hard KDF for the credential store but does not name one, and the choice lands on the compliance-critical path. Use Argon2id via Node's built-in `crypto.argon2Sync` (19 MiB, 2 passes, 32-byte tag, per-credential salt) so the credential path carries no third-party native code and no native build step.
- **Read when**: Working on authentication, credentials, password or PIN storage, or the `SecretHasher` port; adding a hashing dependency to the project; reviewing the security properties of the identity unit; changing the credential work factor or the credential table schema.
