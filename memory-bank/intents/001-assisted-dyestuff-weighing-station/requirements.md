---
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: draft
created: 2026-10-29T13:20:00Z
updated: 2026-10-29T13:20:00Z
---

# Requirements: Assisted Dyestuff Weighing Station

> **Status: DRAFT — awaiting Checkpoint 1 approval.**
> Detailed functional requirements are elaborated in Step 7. This document captures
> the Intent: the business problem, actors, scope boundaries and unknowns.

## Intent Overview

WeighingMS is an assisted weighing station application that guides a dyehouse
operator through dispensing dyestuffs and dry auxiliaries for a dye batch,
against a recipe issued by FCI's OrgaTEX MES.

Today the operator weighs by eye against a paper printout. Nothing about what
was actually dispensed is recorded. When a batch fails shade approval there is
no record distinguishing a bad recipe from a bad weighing, so the failure cannot
be attributed and the same error recurs.

WeighingMS closes that loop. The recipe arrives digitally from OrgaTEX, the
correct scale is selected automatically per component, dispensing is guided in
real time against the target, out-of-tolerance weights are refused unless a
supervisor authorises an override, and actual consumption is written back to
OrgaTEX against the batch.

**WeighingMS does not replace OrgaTEX.** OrgaTEX remains the upstream and
downstream production system: it owns batches, recipes, tolerances and dyestuff
master data, and WeighingMS is read-only against all of them except the batch
weighing status and the actual-consumption posting. WeighingMS does not connect
to or control dispensing machinery, and it does not author or modify recipes.

The product deliberately does **not** automate dispensing. The operator still
dispenses by hand and a worker still carries the container to the dyeing
machine. FCI has chosen accuracy and traceability over labour reduction.

## Primary User

| Actor | Relationship to WeighingMS | Need |
|---|---|---|
| **Weighing operator** (primary) | Daily user of the station | A station that is faster and less stressful than paper, that tells them what to weigh and whether they are right, and that they cannot accidentally bypass |
| **Dyehouse supervisor** | Authorises exceptions; does not normally weigh | Authority to approve tolerance overrides, manual scale reselection and calibration bypass; visibility of batch progress and hold-ups |
| **Lab / QA** | Consumer of the record, not a user | The weighed-vs-recipe record, to investigate a shade failure |
| **Store / inventory** | Consumer of the record | Actual consumption for stock reconciliation and lot control |
| **FCI IT** | Owns network, deployment, backup, support | OrgaTEX access, network reachability, supportability |
| **FCI management** | Approves scope and signs off acceptance | Evidence that the business problem is solved |

## Business Goals

| Goal | Success Metric | Priority |
|------|----------------|----------|
| Eliminate out-of-tolerance dyestuff weighings reaching production | % of batches dispensed with all components inside tolerance | Must |
| Establish component-level traceability for every dye batch | % of weighings with operator, timestamp, scale, lot and actual quantity recorded (0% today) | Must |
| Reconcile actual dyestuff consumption against theoretical | Variance between issued and theoretical consumption per period (not measured today) | Must |
| Reduce shade-related rework attributable to weighing error | Re-dye rate attributable to weighing | Should |
| Reduce time to investigate a shade failure | Time from failure report to identified cause | Should |
| Preserve or improve operator throughput | Time to weigh a complete batch vs the current paper process | Should |

Throughput is a **guard, not a goal**. If the station is slower than paper,
operators will bypass it and every other objective fails with it.

## Scope

### In scope

- Barcode-driven batch selection from the OrgaTEX batch queue
- Digital recipe retrieval per batch, consumed read-only
- Automatic scale selection between the precision and floor scales, per component
- Container tare handling and dyestuff identity verification
- Real-time guided weighing with live target-vs-actual feedback
- Tolerance enforcement at confirmation
- Surplus compensation for over-dosed components
- Supervisor override with logging
- Dyestuff lot capture and component-level traceability
- Actual-consumption write-back to OrgaTEX
- Weighing ticket and label printing
- Offline operation with deferred synchronisation
- Operator identification
- Basic operational reporting

### Out of scope

- Any connection to, or control of, a dispensing machine or automated dyestuff kitchen
- Automated transport of weighed containers
- Dissolving stations, liquid chemical dosing, salt and soda bulk systems
- Recipe authoring or modification — recipes originate in and remain owned by OrgaTEX
- Replacing or modifying any OrgaTEX functionality
- Laboratory colour matching or shade approval
- Procurement, dyestuff purchasing, or supplier management
- Machine-side dyeing control

### Source artifacts

| Artifact | Path | Role |
|---|---|---|
| Business Requirements Document v1.1 (draft) | `docs/brief.md` | Business context, requirements BR-01–BR-24, FR-01–FR-37, data model §9.2, integration IR-01–IR-18, NFR-01–NFR-16, assumptions A-01–A-15, acceptance criteria AC-01–AC-14 |
| UI/UX functional prototype | `docs/customize-weighing-station.html` | Three views (Select batch / Weigh / Confirm & print), weighing state model, tolerance and overshoot interaction, embedded business rules |

The prototype is a **functional** source, not merely visual: it contains
components, states, data, interaction logic, simulation behaviour and business
assumptions. It is analysed in full in Step 8. Nothing is redesigned.

The final product must reproduce the functional experience represented by the
supplied UI/UX.

## Dummy Integrations

The real external systems are not available in this environment. Four **Dummy
APIs** stand in for them and are part of the product, not test fixtures bolted
onto the UI. No fake data may be hard-coded directly into the UI; all of it must
be obtained over these APIs.

| Real system (conceptual) | Training-time substitute | Responsibility |
|---|---|---|
| **OrgaTEX MES** | Dummy OrgaTEX API | Released batch queue, batch detail, recipe and component list, dyestuff master data; accepts consumption posting and weighing-status write-back |
| **Weighing scale indicators** (precision + floor) | Dummy Scale API | Continuous weight stream with a stability flag, tare, calibration status, connection status; supports both scales concurrently |
| **Barcode scanner** | Dummy Scanner | Keyboard-wedge style barcode input for batch, dyestuff and lot identification |
| **Ticket printer** | Dummy Printer | Weighing ticket rendering with configurable content, and reprint marking |

**Constraint:** the Dummy APIs are training contracts only. No real external API
contract may be invented or assumed. Every Dummy OrgaTEX endpoint is a
self-defined training interface behind the adapter boundary that BRD IR-07
requires, so replacing it with the real interface touches one component.

The Dummy APIs must be independently exercisable (for example via `curl`) and
must reproduce the behaviour the BRD depends on — in particular a 10 Hz
continuous weight stream with a stability flag, and a stable recipe payload
shape that the UI can bind to.

## Constraints

### Technical constraints

- **No floating point for quantities.** All weight, target, tolerance and
  compensation arithmetic uses fixed-point decimal (BRD NFR-16). This applies
  to API payloads and persisted values, not only to the UI.
- **Adapter isolation.** All OrgaTEX interaction is confined to a single adapter
  component (BRD IR-07), so a change of interface technology affects one
  replaceable part.
- **Idempotent consumption posting.** A retry after an ambiguous failure must
  not double-post (BRD IR-08).
- **Immutable records.** Confirmed weighing records are immutable; corrections
  are new records referencing the original (BRD DR-02).
- **Externalised text.** All operator-facing text is externalised for
  translation (BRD NFR-11).
- **Configuration without redeployment.** Scale, tolerance, label and language
  configuration are changeable without a redeploy (BRD NFR-14).

### Business constraints

- OrgaTEX remains the single source of truth for batches and recipes; WeighingMS
  must not become a second source of truth (BRD C-01).
- No modification to OrgaTEX is permitted (BRD C-02).
- The system must not connect to or control dispensing machinery (BRD C-03).
- The station operates in an industrial dyehouse environment — dust, humidity,
  cleaning (BRD C-04).
- Operators may have limited computer literacy; the interface must not assume
  otherwise (BRD C-05).
- Physical scale capacities bound what can be weighed (BRD C-06).
- All primary actions must be reachable with gloved hands; minimum touch target
  15 mm (BRD NFR-07).

## Assumptions Carried Forward

These are the Product Brief's own assumptions (BRD §12). They are **not**
confirmed by FCI, and each is cited by the requirements that depend on it.

| ID | Assumption | Risk if invalid |
|----|------------|-----------------|
| A-01 | SETEX provides a documented, licensed REST API over HTTPS exposing batch queue, recipe, components, tolerances and dyestuff master | **Severe.** If no interface exists the project premise fails. If it is OPC-UA/DB/file, the Dummy OrgaTEX adapter absorbs it |
| A-02 | OrgaTEX accepts actual-consumption postings from an external system against a batch | **Severe.** Without write-back, consumption reconciliation stays in WeighingMS only |
| A-05 | Scale indicators stream weight continuously at ≥10 Hz with a stability flag | **Severe.** If only stabilised values are available, guided weighing is redesigned |
| A-08 | Surplus compensation means proportionally recalculating remaining components to preserve shade ratio | **High.** The most likely misunderstanding in the document; FCI may mean only "display the excess" |
| A-13 | Today's process is paper-based, unguided and unrecorded | **High** for the business case. If FCI already has a system, the justification changes |
| A-03 | Weighing continues through an OrgaTEX outage and synchronises afterwards | Moderate. If FCI prefers the station to stop, the sync subsystem is dropped |
| A-06 | Scale selection is rule-based on target quantity, with a defined threshold | Moderate. The threshold and boundary behaviour need FCI's rule |
| A-07 | Tolerances are per-component, percentage with an absolute floor, originating in OrgaTEX | Moderate. If banded or per-dyestuff, the rule entity changes shape |
| A-09 | Per-operator traceability is required; lots captured at weighing; records retained long-term | Moderate |
| A-10 | Dyestuffs carry scannable barcodes; interface language English; 21-key terminal duplicates touchscreen actions | Moderate. Absent barcodes make identity verification manual |
| A-12 | Powder dyestuffs and dry auxiliaries only; no liquids in V1 | Moderate |
| A-15 | Daily batch volume falls within a single station's throughput | Moderate. If exceeded, station count and deployment architecture change |
| A-04 | A ticket printer is present; label content is configurable and defined by FCI | Low |
| A-11 | One station at one site in V1, architected for several | Low for V1 |
| A-14 | Baselines, targets and environmental ratings will be set by FCI during BRD review | Low — placeholders by design |

**Severity note:** five assumptions are severe or high (A-01, A-02, A-05, A-08,
A-13). These should be resolved before the PRD. The remainder can be carried.

## Unresolved Questions

These are **not** resolved by the Product Brief, the prototype, or this Intent.
They are recorded so they are not silently decided during construction.

| ID | Question | Owner | Why it matters |
|----|----------|-------|----------------|
| Q-01 | Does SETEX actually provide a documented, licensed interface — and of what kind? | FCI / SETEX | Determines whether the OrgaTEX adapter has anything real to target (A-01) |
| Q-02 | Will OrgaTEX accept external consumption postings against a batch? | FCI / SETEX | Determines whether reconciliation is achievable at all (A-02) |
| Q-03 | What are the scale indicator make, model and protocol? Can they stream continuously? | FCI | Determines whether the live readout and progress bar are buildable as drawn (A-05) |
| Q-04 | What is the scale-selection threshold, and what happens when a target sits near the boundary? | FCI production | Determines the automatic scale-selection rule (A-06) |
| Q-05 | What is the exact tolerance model — percentage, absolute, banded, per-dyestuff? | FCI production | Determines the tolerance rule shape (A-07) |
| Q-06 | What does "surplus compensation" mean to FCI in practice? | FCI production | Highest-likelihood misunderstanding; drives the entire over-dose interaction (A-08) |
| Q-07 | Do dyestuffs carry scannable barcodes in reality? | FCI | If not, identity verification falls back to on-screen attestation (A-10) |
| Q-08 | Does FCI supply its own operator directory, or does WeighingMS master operators? | FCI IT | Determines the authentication implementation (A-09) |
| Q-09 | What is FCI's actual daily batch and component volume? | FCI | Determines whether one station suffices (A-15) |
| Q-10 | Does one container hold one component or a whole recipe, and how are containers identified? | FCI production | Determines tare and container modelling |
| Q-11 | What content should the weighing ticket and label carry? | FCI | Determines ticket layout and reprint marking (A-04) |
| Q-12 | What are the baseline figures for out-of-tolerance rate, re-dye rate and throughput? | FCI | Determines whether the business case is measurable (A-14) |

## Non-Functional Requirements (Summary)

Full metrics are elaborated in Step 7; the load-bearing ones are:

| Requirement | Target | Source |
|-------------|--------|--------|
| Displayed weight lag | ≤ 200 ms behind the scale | BRD NFR-01 |
| Batch selection to recipe displayed | ≤ 3 seconds when online | BRD NFR-02 |
| Availability during OrgaTEX/network outage | Weighing remains available | BRD NFR-03 |
| Confirmed weighing survives power loss | No data loss on confirmed records | BRD NFR-05 |
| Interrupted session resumable | At the component in progress | BRD NFR-06 |
| Gloved-hand operation | All primary actions, ≥15 mm touch targets | BRD NFR-07 |
| Weight readout legibility | Readable at 1.5 m | BRD NFR-08 |
| Operator trainability | Competent within one shift | BRD NFR-09 |
| Environment | Hardware rated for dyehouse dust/humidity, IP54 min | BRD NFR-10 |
| Security | Privileged actions authenticated; credentials never shared between roles | BRD NFR-12 |
| Auditability | Audit records immutable and exportable | BRD NFR-13 |
| Capacity | Daily volume without degradation | BRD NFR-15 |
| Data integrity | Fixed-point decimal; no floating point | BRD NFR-16 |

## Dependencies

| ID | Dependency | Owner | Needed by |
|----|------------|-------|-----------|
| D-01 | SETEX interface documentation and licence | FCI with SETEX | Before PRD sign-off |
| D-02 | Scale indicator models and protocol documentation | FCI | Before PRD |
| D-03 | Network access from station to OrgaTEX, with credentials | FCI IT | Before integration testing |
| D-04 | Hardware procurement — scales, terminal, scanner, printer | To be agreed | Before installation |
| D-05 | FCI confirms tolerance and compensation rules | FCI production | Before PRD |
| D-06 | Operator availability for UI validation and training | FCI production | Before acceptance |
| D-07 | Baseline metrics for BO-01, BO-03, BO-06 | FCI | Before acceptance |

## Out of Scope for This Intent

The following are deferred and must not be silently pulled into construction:
multi-site deployment (A-11), liquid dosing (A-12), automated dispensing
machinery (C-03), colour matching and shade approval, procurement, and
machine-side dyeing control.

## Next Steps

1. **Checkpoint 1** — validate this Intent against the seven workbook criteria
2. **Step 7** — elaborate the detailed Requirements
3. **Step 8** — analyse the UI prototype as a functional prototype
4. **Steps 9–10** — System Context, then Unit decomposition
5. **Steps 11–12** — Stories, then Bolt plan
