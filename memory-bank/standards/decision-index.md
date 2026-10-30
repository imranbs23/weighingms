---
last_updated: 2026-10-30T12:10:00Z
total_decisions: 2
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
