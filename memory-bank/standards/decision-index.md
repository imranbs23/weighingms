---
last_updated: 2026-10-30T23:40:00Z
total_decisions: 13
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
