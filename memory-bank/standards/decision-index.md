---
last_updated: 2026-11-11T09:00:00Z
total_decisions: 47
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

### ADR-047: OVER is confirmed only through a scoped, single-use supervisor override, and nothing is recalculated
- **Status**: accepted
- **Date**: 2026-11-11
- **Bolt**: 030-003-weighing-station (003-weighing-station)
- **Path**: `bolts/030-003-weighing-station/adr-047-over-is-confirmed-only-through-a-supervisor-override.md`
- **Summary**: The workbook's Step 24 asks for a defined overshoot rule, chosen by a human; the project owner chose option C, supervisor-gated. An OVER weighing is confirmed only through a supervisor override that is authorised for that component in that session, used once, and recorded; no recipe is recalculated, the surplus is shown for information only, and the compensation proposal is withdrawn from the operator UI until FCI answers Q25/Q26.
- **Read when**: Changing the confirmation gate, the OVER zone, the escalation, the supervisor override, the surplus panel, or the compensation proposal; working on BRD FR-18, FR-19, FR-20, FR-23, FR-24 or assumption A-08; deciding whether OVER may be confirmed, whether a recipe is recalculated after an over-dose, or how an override is marked on a record or ticket; reviewing a proposal to re-enable the compensation proposal or to let the client assert an override.

### ADR-046: The report READS the recorded zone and MUTATES NOTHING — including its own audit trail
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 023-006-ticket-printing (006-ticket-printing)
- **Path**: `bolts/023-006-ticket-printing/adr-046-the-report-reads-and-mutates-nothing.md`
- **Summary**: The operational report over a period makes two demands that are both about what it must **not** do. It **never re-derives**: the tolerance outcome is the record's `zoneAtConfirm`, read, never recomputed from today's recipe and today's tolerance — because bolt `022` just made the configuration versioned, so a recomputing report would **silently re-judge every historical weighing** after a tolerance change, turning a period with failures into a period with none, with the same confidence either way. And it **mutates nothing**: not the records, not the trail, not the configuration, and not a *"report generated"* audit entry — because a report is read often and decided rarely, and a trail full of "report requested" entries drowns the overrides and refusals that matter. The absence is **structural**: the report's collaborators are the read sides only and there is no `record` call in its path, and it publishes no event because a subscriber would write. A **zero period is a VALID report** — the absence of a failure is itself reportable, and a supervisor must be able to distinguish a quiet period from a broken query. An override row **joins** the audit entry to the weighing, because the entry alone cannot say *what* was authorised; and two overrides on one subject stay **two rows**, because the report reports what happened and tidying is an interpretation.
- **Read when**: Implementing or changing the tolerance report, the report's period, the shift resolution, the override rows, the failure rows, or the batch progress; working on FR-21, FR-23, FR-18, FR-22, DR-02, or BR-22; deciding whether the tolerance is recomputed, whether the report writes an audit entry, whether a zero period is an error, or whether overrides are grouped; reviewing a proposal to recompute the tolerance, to log the report request, to publish a report event, or to merge duplicate overrides.

### ADR-045: The configuration is VERSIONED, and an override is APPENDED to the weighing record — never substituted into it
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 022-006-ticket-printing (006-ticket-printing)
- **Path**: `bolts/022-006-ticket-printing/adr-045-the-configuration-is-versioned.md`
- **Summary**: A configuration value is not a setting — it is a statement about what a weighing **meant** — and a mutable key-value row would erase the history of every statement the station has made, leaving a shade failure six weeks old unsettleable. So the **history is the truth** (append-only) and the effective value is a **projection** of it, with an `effective_from` making the effective value a function of **time** — so a weighing is always evaluated against the configuration in force when it was taken. The version is **per key** and assigned **atomically** by a `UNIQUE (key, version)` constraint, so two concurrent changes get distinct versions, the later wins the effective value, and **both** are audited — because a last-write-wins trail would lose a supervisor's change *and their reason with it*. The version write and its audit entry are in **one transaction**, so they always agree. And the override is **APPENDED** to the weighing record as a single nullable field — the quantity, zone and timestamp untouched — because a record must not be a function of when you read it, and the append preserves BRD DR-02 while making an override visible to a reader of the weighing itself. The locale bundle is a **file read at runtime**, and the fallback is **per key** to a defined default locale, so a missing string never fails a request.
- **Read when**: Implementing or changing the configuration store, the versions, the effective value, the locale bundles, the fallback, or the override's visibility on a weighing record; working on FR-18, FR-21, FR-22, FR-36, FR-37, NFR-11, NFR-14, NFR-7, or IR-16; deciding how the effective value is stored, how versions are numbered, whether a change may be applied to a scope that does not exist, or how a missing string is handled; reviewing a proposal to make the configuration mutable, to read it at render time, to audit outside the version's transaction, or to fall back to a whole bundle.

### ADR-044: The export is STREAMED line by line, and reading the trail requires a SUPERVISOR
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 021-006-ticket-printing (006-ticket-printing)
- **Path**: `bolts/021-006-ticket-printing/adr-044-the-export-is-streamed-and-the-trail-is-supervisors.md`
- **Summary**: The audit trail's export is produced by **iteration** — the repository yields the matching entries one at a time and the writer writes each as it arrives, so the peak memory is **one entry** whatever the range, because the story requires it be produced *"without loading every entry into memory in one buffer"*. That requirement is also **why the format is `JSONL`**: a JSON array would have to be assembled before it could be written, so the line-orientation is what makes the requirement satisfiable — and the format is a **value**, not a literal, because the requirements deliberately do not settle it. The export carries **exactly** the matching entries with **all their fields intact**, using the **same filter** as the query, so the two agree. Reading the trail requires a **SUPERVISOR**, checked from the session's operator: the reprint touches **one** ticket and needs attribution and a reason, while the trail holds **every** privileged action with its actors and reasons — which is not the operator's business. The two stories' apparent contradiction is resolved by the **scope of what is disclosed**, and the reprint is deliberately *not* supervisor-gated because BRD FR-35 does not name reprints.
- **Read when**: Implementing or changing the audit query, the audit export, the audit trail's read endpoints, the stream repository, or the privileged-action set; working on FR-21, FR-36, NFR-13, NFR-05, DR-01, DR-02, or FR-35; deciding who may read the trail, how the export is produced, what format it uses, or whether a refusal is distinguishable; reviewing a proposal to build the export from `filter`, to let an operator read the trail, or to record a refusal as a successful action.

### ADR-043: The reprint marking is DERIVED from the reason, and the audit trail is an append-only API with a database-assigned sequence
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 020-006-ticket-printing (006-ticket-printing)
- **Path**: `bolts/020-006-ticket-printing/adr-043-the-reprint-marking-is-derived.md`
- **Summary**: The reprint's marking says three things — *this is a reprint*, *of this ticket*, *for this reason* — and all three are facts the station already knows, so all three are **derived**: `isReprint` from the reason's presence, `reprintOf` from the path, the actor and their role from the session. The request body has **exactly one field**: the reason. A client-supplied marking would be a client's claim about the truth, and could assert a reprint without a reason — which the story forbids. The reason is **mandatory** and refused at the **boundary** with **no print job created**, because a job recording `reason: ''` would put a privileged action with no justification into the trail, and that is what FR-21 exists to prevent. The audit entry's **sequence comes from the database** — `INTEGER PRIMARY KEY AUTOINCREMENT` — because an application-side counter is racy and two concurrent privileged actions would be recorded as a **tie**; `AUTOINCREMENT` rather than a plain rowid because the story requires the trail never to rewind across a restore. The repository has **no update and no delete path**, with the triggers as the second line. And the audit entry is written **whether the print succeeded or failed** — the privileged action is the *request*, and a requested second copy that did not arrive is the case an auditor most needs to see.
- **Read when**: Implementing or changing the reprint, the marking, the reason, the audit entry, the audit repository, or the print job's creation; working on FR-17, FR-18, FR-21, FR-28, FR-36, NFR-13, DR-01, DR-02, or B-7; deciding how the marking is established, where the sequence comes from, whether the entry is written on a failed print, or whether a reason may be blank; reviewing a proposal to add an `isReprint` field, to number the entries from the application, or to record the entry only on success.

### ADR-042: The print path has no repository for the weighing record, and the job's state is committed before the printer is called
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 019-006-ticket-printing (006-ticket-printing)
- **Path**: `bolts/019-006-ticket-printing/adr-042-the-print-path-cannot-cost-a-weighing.md`
- **Summary**: A printer failure must never cost a weighing (B-7) — and the story forbids "being careful" by forbidding the transaction that would couple them. So the guarantee is **structural**: the print path reads the ticket, writes the print job and calls the printer, and it has **no weighing-record repository at all** — so there is no path from the printer's failure to the record. The job's state moves `QUEUED → PRINTING → DONE|FAILED` with **`PRINTING` committed before the printer is called**, because that is the only evidence that an attempt was in flight: a crash that leaves a `QUEUED` job cannot be told apart from one that never started, and an automated reconciler reading that would not reprint. A printer failure is the **job's state, not the response's** — a `201` with a `FAILED` job carrying the error, because the operator needs the job to reprint. The ticket's lines carry the records' **own quantity strings**, each keeping **its own unit**: a *total* is a derived fact and gets a unit of its own (ADR-041), but a *line* is a reproduction of one weighing, and converting it would make the ticket disagree with the record.
- **Read when**: Implementing or changing the ticket, the ticket lines, the print job, the print adapter, or the generation; working on FR-17, FR-18, FR-19, FR-22, FR-27, FR-28, IR-16, NFR-2, NFR-3, NFR-5, DR-01, DR-02, or B-7; deciding the order of the state transitions, what happens when the printer fails, whether to read a record on demand, or whether to convert the lines' units; reviewing a proposal to wrap the weighing and the print in one transaction, to add a record repository to the print path, or to commit `DONE` before the printer answers.

### ADR-041: The total is summed in kilograms, and the write-back's outcome does not gate the completion
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 018-003-weighing-station (003-weighing-station)
- **Path**: `bolts/018-003-weighing-station/adr-041-the-total-is-summed-in-kilograms.md`
- **Summary**: The recipe mixes grams (the dyestuffs) and kilograms (the auxiliaries), so the total is a sum across two units — and the story names the wrong ways to do it: *"never by concatenating display strings"*. Every quantity is therefore **converted into kilograms before it is summed**, in fixed-point decimal and exactly — `0.5 kg` is `500 g`, never `499.9999999 g` — because converting before the sum is what makes the result independent of the order. The unit is kilograms because the story's own worked example reports them (`500.0 g` + `24.000 kg` = `24.500 kg`) and the auxiliaries dominate the mass. Separately, the **write-back's outcome never gates the completion**: the material is weighed and in the container whether or not the MES heard about it, unit 005's queue delivers a pending posting when the link returns, and unit 005's own status write already refuses `WEIGHED` while a posting is unresolved — so the station already knows the right answer. The write path itself is **unit 005's**, called through a structurally-satisfied port, because a re-implemented idempotency guard would be an in-memory `Set` that does not survive the restart this product requires.
- **Read when**: Implementing or changing the batch summary, the total dispensed, the tolerance verdict, the elapsed time, the write-back, or the batch completion; working on FR-15, FR-16, FR-26, FR-29, FR-30, FR-31, AC-08, IR-08, IR-09, NFR-03, NFR-16, C-11, C-13, C-14; deciding the total's unit, whether to gate the completion on the write-back, whether to re-implement the idempotency guard, or whether to store the summary; reviewing a proposal to concatenate quantities, to sum across units, or to hold the batch open until the MES confirms.

### ADR-040: The record is written before the progression, and the duplicate is refused by a constraint
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 017-003-weighing-station (003-weighing-station)
- **Path**: `bolts/017-003-weighing-station/adr-040-the-record-is-written-before-the-progression.md`
- **Summary**: Confirming a weighing does two things — it records the weighing and it advances the session — and the story insists they are **one** transition, because either write order on its own leaves an inconsistency. The record goes **first**: a crash between the two writes then leaves the component `ACTIVE` and unwritten, so the operator re-confirms and the duplicate is refused, whereas the reverse order loses a confirmed weighing silently — and a missing record for a weighing that happened is exactly the failure BRD BR-14 and DR-01 exist to prevent. The duplicate is refused by a `UNIQUE` constraint rather than a check, because a check-then-write is racy and the race is the case the story names. The progression itself lives on the aggregate, so the invariants are rules rather than conventions, and it follows the **recipe's** order, which is the MES's and is never modified.
- **Read when**: Implementing or changing the confirmation, the progression, the component advance, the session's `DONE` transition, or the duplicate check; working on FR-14, FR-18, FR-19, NFR-5, NFR-6, C-01, C-08, or the batch completion handoff; deciding whether the record or the session is written first, whether the duplicate is a check or a constraint, or whether a client may choose the next component; reviewing a proposal to reorder the writes or to add an existence check.

### ADR-040: The record is written before the progression, and the duplicate is refused by a constraint
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 017-003-weighing-station (003-weighing-station)
- **Path**: `bolts/017-003-weighing-station/adr-040-the-record-is-written-before-the-progression.md`
- **Summary**: Confirming a weighing does two things — it records the weighing and it advances the session — and the story insists they are **one** transition, because either write order on its own leaves an inconsistency. The record goes **first**: a crash between the two writes then leaves the component `ACTIVE` and unwritten, so the operator re-confirms and the duplicate is refused, whereas the reverse order loses a confirmed weighing silently — and a missing record for a weighing that happened is exactly the failure BRD BR-14 and DR-01 exist to prevent. The duplicate is refused by a `UNIQUE` constraint rather than a check, because a check-then-write is racy and the race is the case the story names. The progression itself lives on the aggregate, so the invariants are rules rather than conventions, and it follows the **recipe's** order, which is the MES's and is never modified.
- **Read when**: Implementing or changing the confirmation, the progression, the component advance, the session's `DONE` transition, or the duplicate check; working on FR-14, FR-18, FR-19, NFR-5, NFR-6, C-01, C-08, or the batch completion handoff; deciding whether the record or the session is written first, whether the duplicate is a check or a constraint, or whether a client may choose the next component; reviewing a proposal to reorder the writes or to add an existence check.

### ADR-039: This bolt implements no authorisation mechanism — it consumes unit 008's, and re-checks nothing
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 016-003-weighing-station (003-weighing-station)
- **Path**: `bolts/016-003-weighing-station/adr-039-this-bolt-implements-no-authorisation-mechanism.md`
- **Summary**: Unit `008` already owns the entire privileged-action surface, and its five ADRs are a record of every way such a check can silently go wrong — a second credential path breaks the constant-work timing defence, a mutated `consumed_at` admits a double-spend, and a precise refusal reason is a map of the defences. So this bolt calls unit `008`'s `AuthorisationService.consume` and **re-checks nothing**: a "reasonable" re-implementation would be correct in every branch and still a compliance regression, because it would carry a different refusal vocabulary, a different expiry boundary, no `UNIQUE` constraint and no audit event — and every test in this bolt would still pass. The scope is **derived** from the session's own ids rather than supplied, so the scope check is correct by construction, and the `403` body stays **uniform** with no reason added, the reason going to the audit trail where an auditor needs it and an attacker cannot reach it.
- **Read when**: Implementing or changing the escalation, the override, the override record, or any check on an authorisation in this unit; working on FR-13, FR-21, FR-23, FR-24, FR-35, FR-36, AC-06, NFR-12, NFR-13; deciding whether to add a check, a distinctness test, an expiry test, a spent test, or a reason to the refusal body; reviewing a proposal for a second authorisation mechanism, a second credential path, or a client-supplied authorisation subject.

### ADR-038: The compensation factor is computed from this surplus and this remaining total, and the applied factor is stored
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 015-003-weighing-station (003-weighing-station)
- **Path**: `bolts/015-003-weighing-station/adr-038-the-compensation-factor-is-computed-and-stored.md`
- **Summary**: A-08 is the BRD's own highest-risk misunderstanding, and the prototype's `1.026` is its worked example rather than a rule — using it on a surplus of `2.4000 g` against a remaining total of `188.0000 g` would distribute `4.888 g` when only `2.4000 g` was over-dosed, and the error would be invisible because the numbers still add up. So the factor is **computed** (`surplus ÷ totalRemainingTarget`, in fixed-point decimal), the compensability decision and the proposal generation **share one implementation** so they cannot disagree, the revised targets sum to the original total plus the surplus exactly, and the **applied factor is stored** on the proposal — because Q-06 is still unanswered, so a stored factor is the evidence of which rule produced each revision.
- **Read when**: Implementing or changing the compensation, the surplus, the overshoot, the factor, the compensability decision, or the surplus proposal; working on FR-20, FR-21, FR-22, FR-24, A-08, Q-06, or BRD R-03; deciding whether a constant factor may be used, whether the compensability check may be implemented separately from the proposal, or whether the factor needs to be stored; reviewing a change to the revised targets' arithmetic or rounding.

### ADR-037: The zone's boundaries are exclusive and inclusive as written, and the near threshold is computed once in fixed-point
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 014-003-weighing-station (003-weighing-station)
- **Path**: `bolts/014-003-weighing-station/adr-037-the-zone-boundaries-and-the-fixed-point-threshold.md`
- **Summary**: Every line of the four-zone rule has a boundary a wrong implementation gets wrong, so the inclusivity is **exactly as written** — `OVER` is a strict `>` (a reading at `target + tolerance` is `OK`), `OK` is inclusive at both bounds, and `NEAR` is inclusive at `target × 0.9` — because the asymmetry is the requirement's answer to what reaches production, and the rule's *order* is what makes the exclusive bound exclusive. And `target × 0.9` is computed once with `decimal.js`, half-up at the storage precision, because in IEEE-754 `94.0000 × 0.9` is `84.60000000000001` — which would put the exact boundary reading the requirement names on the wrong side of `NEAR` — and because recomputing it per reading would let the zone flicker at the boundary.
- **Read when**: Implementing or changing the tolerance zone, the near threshold, the tolerance bounds, the still-to-weigh quantity, or the confirmation gate; working on FR-9, FR-10, FR-14, FR-18, C-05, C-07, C-11, or the boundary test suite; deciding whether a bound is inclusive, whether `target × 0.9` may be a float, or whether the bounds are recomputed per reading; reviewing a change to the order of the four zone rules.

### ADR-036: The session is the live state and it is persisted; the weighing record is the act and it is not
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 013-003-weighing-station (003-weighing-station)
- **Path**: `bolts/013-003-weighing-station/adr-036-the-session-is-the-live-state-and-it-is-persisted.md`
- **Summary**: The session is the station's own live state — the MES has no idea where the operator got to, and it cannot be re-derived — so it is persisted, and it is **mutable**, because it is not a record of a completed act; the `WeighingRecord` is that, and it is immutable (BRD DR-02). The stale-looking-fresh risk that refused the snapshots, the recipe and the tare does not apply, because a session is not a snapshot — it is obviously stale once the process is gone, and the tare is the device's, not the session's. The session persists the last accepted reading's **sequence**, so the out-of-order guard survives a restart and a replayed reading is still rejected.
- **Read when**: Implementing or changing the session, its table, its repository, the weighing record, or the reading guard; working on NFR-06, DR-02, C-08, C-12, IR-11, IR-13, or the resumption of an interrupted session; deciding whether to persist a quantity in the session, whether to make the session append-only, or whether the tare belongs in the session's row; reviewing a proposal to copy the recipe's target or tolerance into the session.

### ADR-035: The container assignment is a relation, and the tare is recorded twice — once on the device and once on the assignment
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 012-002-recipe-material-management (002-recipe-material-management)
- **Path**: `bolts/012-002-recipe-material-management/adr-035-the-container-assignment-is-a-relation.md`
- **Summary**: Q-10 asks whether one container holds one component or a whole recipe, and the two answers imply different data models — so the assignment is modelled as a relation between a component and a container, which holds under either answer and lets the station neither forbid nor assume a shared container. And the tare is recorded twice, because the device's current zero reference is not persisted (ADR-015, since a stale one is a wrong number) while the assignment's tare must be, because the weighing record carries it and it cannot be re-derived — so the assignment keeps its own copy, taken at the moment of the assignment, rather than reading the live device's tare.
- **Read when**: Implementing or changing the container assignment, the container master, the tare, or the tare's source; working on FR-6, FR-25, Q-10, CQ-08, IR-12, or BRD FR-11; deciding whether to add a `container_id` column to the recipe component or to record the tare from the device; deciding whether the client may supply the tare value, the tare source, the assignment method or the operator; reviewing a proposal to persist the device's tare or to make the master table append-only.

### ADR-034: The identity and the lot are the station's own facts, and they are append-only
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 011-002-recipe-material-management (002-recipe-material-management)
- **Path**: `bolts/011-002-recipe-material-management/adr-034-the-identity-and-the-lot-are-append-only.md`
- **Summary**: ADR-031 refused to persist the recipe because it is a copy of somebody else's truth that can be re-fetched, and a persisted copy risks being stale-looking-fresh — but a material identity and a lot capture are the opposite case, because they are the station's own acts and the MES has no idea they happened, so they cannot be re-derived and must be durable. So both tables are strictly append-only, the effective record is the newest row with the insertion sequence as a total tie-break, the method is derived from the request's shape and the operator comes from the session, and a refusal writes nothing.
- **Read when**: Implementing or changing the material identity, the lot capture, their tables, their repositories, or the effective capture's lookup; working on FR-4, FR-5, FR-25, DR-01, DR-02, or B-6; deciding whether something in unit 002 should be persisted or not, and whether a "current" column is acceptable; adding a `verifiedBy`, `captureMethod` or `operatorId` to a request body; reviewing a proposal to prune, update or delete a capture.

### ADR-033: One scanner, two ports, one instance
- **Status**: accepted
- **Date**: 2026-11-06
- **Bolt**: 011-002-recipe-material-management (002-recipe-material-management)
- **Path**: `bolts/011-002-recipe-material-management/adr-033-one-scanner-two-ports-one-instance.md`
- **Summary**: One physical barcode scanner serves three reads — the batch card, the dyestuff code and the lot code — and giving each unit its own adapter would mean two device states that are really one, two sources of truth for what was just scanned, and two backends behind the workbook's single `POST /api/scan`. So each unit declares its own port, because a port belongs to its consumer, and the composition root binds both ports to the SAME device instance; the device's outcome carries only a code, because only the consumer can classify what a code means, and a code that matches nothing is a specific refusal rather than a device error.
- **Read when**: Implementing or changing the scanner, either scanner port, the Dummy Scanner, or the `POST /api/scan` training contract; working on Q-03, A-10, Q-07, or the batch card's scan path; deciding whether to add a scanner adapter, a scanner instance, or a code type to the scan outcome; reviewing a proposal for a second device or a per-unit scanner state.

### ADR-032: The recipe's display facts cross the seam as optional fields, and the station owns its own endpoint
- **Status**: accepted
- **Date**: 2026-11-05
- **Bolt**: 010-002-recipe-material-management (002-recipe-material-management)
- **Path**: `bolts/010-002-recipe-material-management/adr-032-the-display-facts-cross-the-seam-and-the-station-owns-its-endpoint.md`
- **Summary**: The rail needs a swatch and a name, and the BRD puts those on the DYESTUFF master rather than on the recipe component, so the facts had two possible homes — and a second master read would mean two contacts, two caches and two sources of truth for one component. So the seam is extended minimally and additively with the two optional fields, and unit 002 owns its own `GET /api/recipe/:batchId` and reads the MES only through unit 005's reader, in process. The facts are optional on both sides, so the station works under either answer to A-01, and the swatch is a validated type because the prototype builds a CSS `background` by string concatenation.
- **Read when**: Implementing or changing the recipe endpoint, the recipe rail's payload, the component's name or swatch, or the seam's `RawComponent`; working on the dyestuff master, BRD IR-03, or whether a second read of the MES seam is needed; deciding whether the station's recipe should live at `/api/recipe/:batchId` or reuse `/api/orgatex/*`; reviewing a proposal to add a second reader of the MES seam or to make the display facts required.

### ADR-031: The recipe is not persisted, and the station's working copy is in memory
- **Status**: accepted
- **Date**: 2026-11-05
- **Bolt**: 010-002-recipe-material-management (002-recipe-material-management)
- **Path**: `bolts/010-002-recipe-material-management/adr-031-the-recipe-is-not-persisted.md`
- **Summary**: Three different things are called "the cache" — unit 005's last-known-good fallback, unit 002's working copy, and a row in a table — and the recipe is not persisted at all, because a persisted recipe's pre-restart `receivedAt` makes a correct age on a previous process's world look like a fresh-but-slow response, and it passes every freshness check and is wrong. So unit 002 holds one in-memory working copy, defines no cache and no freshness threshold of its own, and passes unit 005's freshness through unchanged — which is what serves the outage case, with its age, for the life of the process.
- **Read when**: Implementing or changing the recipe's storage, the working copy, the session's recipe reference, or the recipe's freshness; working on FR-30, the offline recipe, or the DEGRADED fallback; deciding whether a recipe may be written to SQLite or whether a restart should resume a batch; reviewing a proposal to add a `recipes` table, a recipe cache, or a second freshness window.

### ADR-030: The filter's offered statuses come from the queue, and the selection method is derived from the request
- **Status**: accepted
- **Date**: 2026-11-05
- **Bolt**: 009-001-batch-management (001-batch-management)
- **Path**: `bolts/009-001-batch-management/adr-030-the-filter-options-and-the-derived-method.md`
- **Summary**: The filter's option set must be derived from the queue's contents and not from the MES's five-status vocabulary, because a status that is not in the queue is a filter that will match nothing and an option set that collapses to the filtered status is a one-way door — while the vocabulary is still used to reject an unknown `?status=` with a `400` rather than silently matching nothing. The `selectionMethod` is derived from the request's shape — a `code` means `SCAN`, a `batchId` means `TOUCH` — and the schema has no `selectionMethod` field at all, so a client cannot record a scan that never happened in an immutable traceability record.
- **Read when**: Implementing or changing the filter, the filter control's options, the published `statuses` array or the validation of `?status=`; working on the selection endpoint's body, the selection method or the scan/touch distinction; deciding whether a status vocabulary or a queue-derived set belongs in a payload; adding a client that writes a selection.

### ADR-029: The selection record is append-only, and the active selection is the newest row
- **Status**: accepted
- **Date**: 2026-11-05
- **Bolt**: 009-001-batch-management (001-batch-management)
- **Path**: `bolts/009-001-batch-management/adr-029-the-selection-record-is-append-only.md`
- **Summary**: BRD DR-02 requires that a selection — a fact about what the operator physically did — be immutable, while the workflow needs a *current* selection that changes. Storing "which one is active" as a `superseded_at`, an `is_active` flag or a pointer row would mutate a historical record and create a second source of truth that a partial failure could leave inconsistent. So the table is strictly append-only, with `BEFORE UPDATE`/`BEFORE DELETE` triggers that abort, and the active selection is derived as `ORDER BY selected_at DESC, id DESC LIMIT 1` — a total order, so two terminals read the same answer and a crash before the write leaves the previous selection active.
- **Read when**: Implementing or changing the selection record, its repository or its table; working on the current or active selection, the crumb, or unit 003's resume of a selection; deciding whether a selection may be updated, pruned or deleted; reviewing a proposal to store an `is_active` flag or a `superseded_at` column.

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
