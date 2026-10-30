---
last_updated: 2026-10-30T20:15:00Z
total_decisions: 7
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
