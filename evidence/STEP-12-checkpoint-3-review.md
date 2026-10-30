# Checkpoint 3 — Inception Artifacts Review

**Intent**: 001-assisted-dyestuff-weighing-station
**Reviewer**: the human who owns this build
**Date**: 2026-10-30

---

## What this checkpoint is

Everything the Inception phase produced is presented **together**, because the
artefacts only make sense as a set. A story that references a unit that does
not exist, or a bolt that depends on a story belonging to another unit, is
invisible when the artefacts are reviewed one at a time.

**Nothing has been built yet.** No application code exists. This checkpoint
reviews the *plan* for the build.

### Artifacts under review

| # | Artefact | File | Status |
|---|----------|------|--------|
| 1 | System Context | `memory-bank/intents/001-assisted-dyestuff-weighing-station/system-context.md` | 8 external actors, 11 failure boundaries, 8 context questions |
| 2 | UI/UX Analysis | `memory-bank/intents/001-assisted-dyestuff-weighing-station/ui-analysis.md` | 20 prototype rules, 18 prototype questions, prototype gaps catalogued |
| 3 | Requirements | `memory-bank/intents/001-assisted-dyestuff-weighing-station/requirements.md` | 23 FRs, 12 NFRs, 14 ACs, 12 open questions |
| 4 | Units | `memory-bank/intents/001-assisted-dyestuff-weighing-station/units.md` + 8 × `unit-brief.md` | 8 units, 23 FRs mapped exhaustively |
| 5 | Stories | 38 × `units/{unit}/stories/*.md` + `memory-bank/story-index.md` | 38 stories |
| 6 | Bolt Plan | 28 × `memory-bank/bolts/{BBB}-{unit}/bolt.md` | 28 bolts |

### The numbers

| Measure | Count |
|---------|-------|
| Units | 8 (7 backend, 1 frontend) |
| Functional requirements | 23 (ours) + 37 (the BRD's) |
| Stories | 38 |
| Bolts | 28 |
| Stories per bolt | 1–2 (max allowed 6) |
| Open questions | 38 (12 BRD + 18 prototype + 8 context) |
| Failure boundaries | 11 |

---

## 1. The unit decomposition

| # | Unit | Type | FRs | Stories | Bolts |
|---|------|------|-----|---------|-------|
| 001 | `001-batch-management` | backend | FR-1, FR-2 | 3 | 2 |
| 002 | `002-recipe-material-management` | backend | FR-3…FR-6 | 4 | 3 |
| 003 | `003-weighing-station` | backend | FR-7…FR-15, FR-18 | 9 | 6 |
| 004 | `004-scale-integration` | backend | FR-19 (scale half) | 4 | 2 |
| 005 | `005-orgatex-integration` | backend | FR-16, FR-19 (MES half), FR-20 | 5 | 3 |
| 006 | `006-ticket-printing` | backend | FR-17, FR-21, FR-22, FR-23 | 6 | 5 |
| 007 | `007-weighingms-ui` | frontend | (consumes all) | 5 | 5 |
| 008 | `008-operator-identity` | backend | — | 2 | 2 |

**Every one of the 23 FRs is assigned to exactly one unit.** The
Requirement-to-Unit Mapping table in `units.md` is exhaustive and was checked
by script.

**FR-19 is the one split.** It covers two genuinely different peripherals —
scales and OrgaTEX — with two different failure modes (B-3 blocks weighing;
B-1 does not). It is split explicitly and counted once.

---

## 2. The stories

38 stories, each with acceptance criteria, technical notes, dependencies, edge
cases and out-of-scope. They are not evenly sized, and that is deliberate:
the stories that carry the hard rules (the tolerance gate, the escalation, the
supervisor authorisation) are separate stories from the ones that carry the
plumbing.

**The stories preserve the hard-won decisions.** A sample of what is encoded
in them, and why it matters:

- **The client never computes a zone.** The zone, the remaining quantity and
  the tolerance band all arrive in the session snapshot. Two classifications
  of the same reading in two places is the failure mode this avoids.
- **A silent scale shows no value — never `0.0`.** A `0.0` fallback is
  indistinguishable from an empty scale, and is the most dangerous thing the
  client could render.
- **Surplus compensation uses `surplus ÷ totalRemainingTarget`** — never the
  prototype's `1.026` worked example, which is only correct *for that
  example*.
- **A supervisor authorisation is scoped to one action and one subject, and
  expires.** A stale or mismatched authorisation is refused, not silently
  applied.
- **The operator cannot authorise their own escalation.**
- **A printer failure never costs a weighing.** The ticket shows as *not
  printed*, never as printed.
- **The identity source is undecided (Q-08)** and is reached only through the
  `IdentityProvider` seam.

---

## 3. The bolt plan

28 bolts with a **global** 3-digit sequence. The ordering is not arbitrary:

```text
Band 1 — the leaf seams, built first
  001  008-operator-identity    sign-in
  002  008-operator-identity    supervisor authorisation
  003  004-scale-integration    live stream + disconnect detection
  004  004-scale-integration    tare + scale selection
  005  005-orgatex-integration  batch queue + recipe reads
  006  005-orgatex-integration  idempotent consumption posting
  007  005-orgatex-integration  link state + offline queue
  008  001-batch-management     the released batch queue
  009  001-batch-management     filter + selection
  010  002-recipe-material      the recipe
  011  002-recipe-material      identity verification + lot capture
  012  002-recipe-material      container + tare

Band 2 — the core, then the outputs
  013  003-weighing-station     open the session + consume the stream
  014  003-weighing-station     tolerance zone + confirm gate
  015  003-weighing-station     surplus + compensation
  016  003-weighing-station     escalation
  017  003-weighing-station     progression
  018  003-weighing-station     batch completion
  019  006-ticket-printing      ticket + print job
  020  006-ticket-printing      reprint
  021  006-ticket-printing      audit trail
  022  006-ticket-printing      configuration + locale
  023  006-ticket-printing      operational reporting
  024  007-weighingms-ui        app shell + batch selection
  025  007-weighingms-ui        the weigh view
  026  007-weighingms-ui        confirm + surplus + escalation panels
  027  007-weighingms-ui        completion + ticket + print
  028  007-weighingms-ui        degraded states + locale wiring
```

**Why the seams come first.** The three leaf units carry the external
contracts and the security rules. Their contracts are the ones most exposed to
the undecided questions — Q-01/Q-02 for OrgaTEX, Q-03 for the scale, Q-08 for
identity. Building them first means the *shape* of the uncertainty is
resolved before the core is built on top of it.

**Why the UI comes last.** Unit 007 consumes every API. Building it last
means it is written against contracts that already exist, rather than
guessing at them and then bending them.

---

## 4. Verification performed

The plan is not asserted to be correct; it is **checked** by script.

| Check | Script | Result |
|-------|--------|--------|
| FR reference hygiene (padding, prefixes, typos) | `verify-fr-refs.cjs` | ✅ 38 stories, 0 problems |
| Every BRD identifier cited exists in `docs/brief.md` | `verify-br-ids.cjs` | ✅ FR 1–37, BR 1–24, IR 1–18, NFR 1–16, AC 1–14, DR 1–3 |
| Every identifier we own exists in its source document | `verify-our-ids.cjs` | ✅ 0 problems |
| Bolt frontmatter is valid | `verify-frontmatter.cjs` | ✅ 28 bolts, no duplicate keys |
| Bolt plan invariants | `build-bolt-plan.cjs` | ✅ every story once, contiguous sequence, enables mirror requires, no cycles, no bolt > 6 stories |
| Story index matches the files | `build-story-index.cjs` | ✅ 38/38 |

The identifier ranges are **derived from the source documents**, not
hard-coded — so the check fails if a requirement is invented or renumbered.

---

## 5. Three things to look at critically

These are the judgement calls in this plan. They are flagged rather than
presented as settled, because a reviewer who disagrees should be able to say
so and have it changed.

### 5.1 Unit 003 carries 11 FRs and is large

`003-weighing-station` holds the session state machine, the tolerance engine,
the surplus and compensation rules, the escalation and the completion. The
alternative — splitting the session from the tolerance engine — was
considered and rejected: the zone evaluation, the confirm gate and the
compensation rule all read the same session state, and splitting them would
put a service boundary through the middle of one rule.

**If you prefer smaller units, this is the one to revisit.** The cost is
that the session state becomes a shared contract between two units.

### 5.2 Unit 006 is deliberately wide

`006-ticket-printing` carries the ticket, the print job, the reprint, the
audit trail, the configuration store, the locale bundles *and* the operational
reporting — six stories in five bolts. The workbook suggested "Ticket &
Printing". It was widened because all of these share one characteristic:
**they are supporting capabilities with a different owner and a different
change rate.** The ticket template changes when FCI chooses one; the audit
trail changes when the retention policy changes; the locale bundles change
when a new language is added. None of them change on the same rhythm as the
weighing logic.

**If you prefer narrow units, this is the one to revisit.** The cost is that
"configuration" is a vague home for four different concerns.

### 5.3 FR-23 was found late, and unit 006 absorbed it

`FR-23` (operational reporting on tolerance failures and overrides) had **no
story** when the unit briefs were written in Step 10. It was found by checking
the requirement-to-story coverage, and it became
`006-report-on-tolerance-failures-and-overrides.md` — a Should-priority story
in unit 006, which is why unit 006 has 6 stories rather than 5.

This is worth a reviewer's eye because it is the one place where the plan was
corrected after the fact. The check that found it is now a script, so it
cannot recur silently.

---

## 6. Known limitations of this plan

Stated plainly, so nobody is surprised later:

1. **The external contracts are assumed, not known.** The OrgaTEX API shape
   (Q-01, Q-02), the scale's stream capability (Q-03), the printer's
   interface (CQ-01) and the identity source (Q-08) are all unresolved. The
   plan isolates each behind a seam with a Dummy implementation, so a changed
   answer replaces one adapter rather than the build.
2. **The compensation rule is an assumption.** A-08 / Q-06 — the BRD itself
   flags this as the document's most likely misunderstanding. If
   "compensation" turns out to mean only displaying the excess, bolt 015's
   compensation branch is **deleted**, not rewritten.
3. **The "is a scale a stream?" risk is the largest single risk.** B-5. If the
   real scale returns only a stabilised value, guided dispensing as drawn is
   not buildable and the interaction's *shape* changes — not its pixels.
4. **CQ-04 is unresolved**: whether the 3 kg and 32 kg scales are one re-zeroed
   indicator or two devices. The capacity rule is written against a *set* of
   scales, so either answer fits.
5. **Nothing here has been validated by running it.** The plan is internally
   consistent and traceable. Whether the tolerance zones and the compensation
   arithmetic behave correctly against real operator expectations is a
   Construction-phase question, and it is exactly what bolt 014's and bolt
   015's tests exist to answer.

---

## 7. What approval means

Approving this checkpoint authorises:

- the **unit decomposition** as the build's structure,
- the **story set** as the definition of done,
- the **bolt sequence** as the build order.

It does **not** authorise skipping any construction-phase checkpoint. Each
bolt stops at its own stage gates and waits for a human.

The next step after this checkpoint is **Checkpoint 4 — Ready for
Construction**, which is the gate before any code is written.
