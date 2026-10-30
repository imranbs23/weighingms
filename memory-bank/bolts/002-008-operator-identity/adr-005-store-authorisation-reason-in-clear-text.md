---
bolt: 002-008-operator-identity
created: 2026-10-30T18:00:00Z
status: accepted
superseded_by: null
---

# ADR-005: Store the authorisation reason in clear text

## Context

Every secret in this product is stored hashed.

- The operator's PIN is stored as an **Argon2id** digest — a memory-hard
  KDF, with a per-credential random salt, in a self-describing encoded
  string that carries its own algorithm and parameters (ADR-001).
- The session token is stored as a **SHA-256 digest** — fast, because it is
  a lookup key for a 256-bit random value with no search space to attack
  (ADR-002).

The pattern is consistent, and it is deliberate: **no plaintext secret is
ever persisted** (invariant I-1 in the identity unit's domain model).

The authorisation's `reason` breaks the pattern. A reason is free text
written by a supervisor to justify an exception: *"Customer approved
over-dose by phone, batch 4417, shade correction required."* The design
stores it in **clear text** in the `supervisor_authorisations` table.

That is an inconsistency in a system whose consistency is one of its
strengths, so it needs a reason — and the reason needs to survive the
next developer who runs a consistency sweep.

The requirement that forces it is FR-21 and BRD FR-24/FR-36: the
authorisation "carries the authorising supervisor's identity, the reason
and the time", the privileged action is "written to the audit trail", and
audit records are "immutable and exportable" (BRD NFR-13). The
authorisations are retained for **at least 5 years** on the same terms as
the audit entries they justify (BRD DR-01).

In other words: five years from now, someone must be able to read what the
supervisor actually wrote. A hash makes that impossible — by design, that
is what a hash is for.

The obvious counter-argument is that the reason might contain sensitive
information, and therefore deserves hashing. But hashing it does not make
it *unavailable to the auditor*; it makes it **permanently unreadable to
everyone**, which is a different thing and almost certainly not what is
wanted.

## Decision

**The authorisation's `reason` is stored in clear text.**

```text
supervisor_authorisations.reason  TEXT NOT NULL
```

The plaintext reason exists in exactly three places:

1. in the **request body** of the authorisation request;
2. in the **domain value object** `AuthorisationReason`, for the duration
   of the request;
3. in the **`supervisor_authorisations` row**, permanently.

It is **not** hashed, **not** encrypted, and **not** truncated to a
digest.

### What is stored is the reason as given, minus surrounding whitespace

The stored text is the supervisor's text with leading and trailing
whitespace removed. Nothing else is changed — no case folding, no
normalisation of internal whitespace, no truncation, no redaction. The
reason is a quotation of what was written, and altering it would make the
audit record a paraphrase rather than the justification itself.

### The meaningfulness check is separate from the storage decision

The reason must be **meaningful** to be accepted at all: it cannot be
empty, whitespace-only, or punctuation-only. That check is applied at the
domain boundary by the `AuthorisationReason` value object, and it is
unrelated to how the text is stored. A meaningfulness check is a
*validation* rule; hashing is a *confidentiality* measure. They do not
interact.

### The reason is not a secret, and the threat model says so

The threat a hash addresses is **disclosure of a credential**. The reason
is not a credential: it is not used to authenticate anything, it grants no
access, and knowing it authorises nothing. An attacker who reads the
`supervisor_authorisations` table learns what exceptions were released and
why — which is exactly what the table is *for*, and exactly what BRD FR-36
requires to be recorded.

The blast radius of reading the reason table is therefore: an adversary
learns the pattern of operational exceptions. That is a **confidentiality
concern about the business**, not a credential-compromise concern, and it
is handled by access control on the database and on the audit-trail
export — not by making the text unreadable to its intended readers.

### The contrast with the session token, stated explicitly

The session token **is** hashed, and the reason is **not**. The two are
not treated inconsistently; they are different kinds of thing:

| | Session token | Authorisation reason |
|---|---|---|
| **Is it a credential?** | Yes — it authenticates | No — it authorises nothing |
| **Is it used to prove identity?** | Yes | No |
| **Must it be recoverable?** | No | **Yes** — by the auditor, years later |
| **What does disclosure cost?** | Full impersonation of the operator | Knowledge of what exceptions were released |
| **Stored form** | SHA-256 digest | Clear text |

The rule that connects them is not "hash everything" but **"store a
credential in a form that cannot be replayed, and store a record in a form
that can be read."**

### What this ADR does not decide

This ADR does not decide how the audit trail stores or protects its own
copies — that is unit 006's concern, and it will have the same question.
What it decides is the form of the authorisation's own column, and the
principle that applies to it.

## Rationale

**Why clear text rather than encryption.** Encryption would satisfy both
requirements — readable by the auditor, opaque to someone who steals the
file — but it introduces a **key** into the system. That key becomes a
secret that must be stored, rotated, backed up and protected, and a
compromised key exposes every reason at once. For data whose confidentiality
is already handled by database access control, encryption buys a second
secret to protect in exchange for a protection that is not the point.

This is the same argument that ADR-002 makes about the session token
("one fewer secret at rest"), applied in the opposite direction: ADR-002
*removed* a secret from the session table by hashing it, and this ADR
*avoids adding* a secret to the authorisation table by not encrypting it.
The unifying principle is **the number of secrets at rest**.

**Why not hash it and store the reason separately in the audit trail.**
This is the alternative worth naming, because it is plausible. The
authorisation row would carry a digest, and the readable reason would live
only in unit 006's audit trail. Then the authorisation's own row holds no
clear text.

It is rejected because it splits one fact across two tables with two
owners and two retention clocks, and because the authorisation record is
specified to *carry* the reason (FR-24: "it carries the authorising
supervisor's identity, the reason and the time"). The unit brief says the
same thing: "The reason is captured at the point of authorisation and is
carried on the authorisation record itself, so the justification stays
bound to the action it permits." Splitting it breaks the binding.

**Why not store a hash *and* a truncated preview.** A preview would be
clear text, so this has the same problem as clear text with extra steps.

**Why the meaningfulness check does not justify hashing.** The check
exists to stop an empty justification being recorded as though it were
one. It is a rule about *completeness of the record*, not about
*confidentiality of the record*. The two are independent, and conflating
them leads to the wrong remedy: the answer to "the reason must not be
empty" is validation, not cryptography.

**Why this needs recording at all.** Because the codebase's own domain
model states "no plaintext secret exists anywhere in the domain model"
(I-1), and a future reader will reasonably assume the reason falls under
that rule. It does not, because it is not a secret. Without this ADR, a
consistency-minded reviewer would either report it as a defect or — worse
— "fix" it by hashing it and silently destroy the audit trail.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Hash the reason (Argon2id)** | Consistent with the credential path; no clear text at rest | The reason is permanently unreadable — the audit trail cannot show the justification; and it is a *useless* hash, since nobody ever needs to verify it, only read it | Destroys the record the requirement exists to create |
| **Hash the reason (SHA-256)** | Same consistency argument | Same defect, with a weaker algorithm | Same rejection |
| **Encrypt the reason at rest** | Readable by the auditor; opaque to a file thief | Introduces a **key** — a new secret to store, rotate, back up and protect; a compromised key exposes every reason; key management is an Operations burden for data that access control already covers | Trades one secret for another to protect non-secret data |
| **Store the reason in unit 006's audit trail only; the authorisation carries a digest** | No clear text in this unit's table | Splits one fact across two owners and two retention clocks; breaks the binding the unit brief requires ("the justification stays bound to the action it permits"); the authorisation record no longer carries the reason FR-24 requires | Breaks the requirement it appears to protect |
| **Clear text, with access control on the table (chosen)** | The auditor can read the justification years later; the record is bound to its authorisation; no new secret | The reason is visible to anyone who can read the database; it may contain commercially sensitive detail | Confidentiality of business records is an access-control and audit-export concern, not a credential concern; no new secret is introduced |

## Consequences

### Positive

- **The justification is readable for the full retention period.** A
  regulator, a customer auditor or an internal reviewer can read what the
  supervisor actually wrote, five years and more after the fact. This is
  the whole point of FR-24 and BRD FR-36.
- **The record is a quotation, not a paraphrase.** The stored text is
  what was written, minus surrounding whitespace — it can be read as the
  supervisor's own words in a dispute.
- **No new secret at rest.** The system still has exactly two stored
  secrets: the credential digests and the token digests. Adding an
  encryption key would have made three.
- **No key rotation problem.** Nothing to rotate, nothing to back up, no
  key to lose in a restore.
- **The audit export is straightforward.** The reason exports as text, with
  no decryption step in the export path — which matters because BRD
  NFR-13 requires audit records to be exportable, and an export that
  cannot decrypt is an export that cannot be produced.

### Negative

- **The reason is visible in clear text to anyone who can read the
  database.** A database file copied into a support bundle carries the
  reasons in the clear.
- **The reason may contain commercially sensitive detail.** "Over-dose
  approved for the customer's priority order" is operational information
  that the business may not want in a file that gets emailed around.
  Access control and export scoping are the mitigations, and they are
  weaker than encryption.
- **It is inconsistent with the credential path, and a reader may read
  that inconsistency as a defect.** This ADR is the remedy for that
  perception — it is recorded precisely so the next reviewer finds the
  reasoning rather than guessing.

### Risks

- **Risk: a future "let's hash everything" consistency sweep hashes the
  reason column, silently destroying the audit trail.** *Mitigation*: this
  ADR states the decision and the reason; the reason column's migration
  comment says it is clear text by decision, referencing this ADR; and the
  Stage 5 test suite asserts that a stored authorisation round-trips its
  reason exactly.
- **Risk: the reason is included in a log line by mistake.** *Mitigation*:
  the reason is not a secret under this ADR, so logging it is not a
  credential leak — but it is business-confidential, so it should still
  not be logged casually. The rule "the secret, the token and the stored
  hash are never logged" still stands; the reason is not on that list, but
  it is also not on the "safe to log" list.
- **Risk: a database backup or support bundle is handled more casually
  than the credential table, because the credential table is visibly
  hashed and the authorisation table is not.** *Mitigation*: this is
  recorded as a known consequence rather than left implicit. The
  mitigation is procedural — support bundles must be treated as
  confidential — and that is an Operations concern.
- **Risk: the domain model's blanket phrase "no plaintext secret exists
  anywhere in the domain model" is read as covering the reason.** *Mitigation*:
  this ADR distinguishes "secret" from "record" explicitly. The invariant
  is about *credentials*; the reason is neither.

## Related

- **Stories**: `002-authorise-privileged-action-as-supervisor` ·
  `004-record-and-export-audit-trail` (unit 006 — stores and exports the
  reason on the same terms)
- **Requirements**: FR-13, FR-21, AC-06 · BRD FR-24, BRD FR-36, BRD NFR-13,
  BRD DR-01, BRD DR-02
- **Standards**: `memory-bank/standards/tech-stack.md` — the Database
  section says "no plaintext secret anywhere in the database" as a property
  the session table enjoys; this ADR notes that the authorisation's reason
  column is a deliberate exception to the *credential* rule, not to the
  *secret* rule.
- **Previous ADRs**: ADR-001 (the credential path's KDF — the contrast is
  the point) and ADR-002 (the session token's digest — the same
  "number of secrets at rest" reasoning, applied in the opposite
  direction)
