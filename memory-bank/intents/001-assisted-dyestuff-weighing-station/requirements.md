---
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: complete
created: 2026-10-29T13:20:00Z
updated: 2026-10-30T05:00:00Z
---

# Requirements: Assisted Dyestuff Weighing Station

> **Intent approved at Checkpoint 1 (2026-10-29).**
> **Requirements approved at Checkpoint 2 (2026-10-29).**
> **Inception complete at Checkpoint 4 (2026-10-30)** — every functional requirement
> below is traced to at least one story, verified by `scripts/verify-inception.cjs`.

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
machine.

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

## Primary User

| Actor | Relationship to WeighingMS | Need |
|---|---|---|
| **Weighing operator** (primary) | Daily user of the station | A station that is faster and less stressful than paper, that tells them what to weigh and whether they are right, and that they cannot accidentally bypass |
| **Dyehouse supervisor** | Authorises exceptions; does not normally weigh | Authority to approve tolerance overrides, manual scale reselection and calibration bypass; visibility of batch progress and hold-ups |
| **Lab / QA** | Consumer of the record, not a user | The weighed-vs-recipe record, to investigate a shade failure |
| **Store / inventory** | Consumer of the record | Actual consumption for stock reconciliation and lot control |
| **FCI IT** | Owns network, deployment, backup, support | OrgaTEX access, network reachability, supportability |
| **FCI management** | Approves scope and signs off acceptance | Evidence that the business problem is solved |

## Traceability Legend

| Source | Meaning |
|---|---|
| **BRD §n** | Business Requirements Document v1.1, `docs/brief.md` — the cited requirement ID (BR-nn, FR-nn, IR-nn, NFR-nn, AC-nn) |
| **PROTO** | `docs/customize-weighing-station.html` — the supplied UI/UX functional prototype |
| **C-01** | A **Confirmed requirement** — settled by the source artifacts, safe to build |
| **A-nn** | An **Assumption** — taken from the BRD's assumption register; valid only while that assumption holds |
| **Q-nn** | An **Unresolved question** — recorded, not decided |
| **TRAIN** | **Training-only behaviour** — a Dummy API behaviour that exists solely for this build and is *not* a claim about the real system |

---

# Functional Requirements

## FR-1: Batch queue retrieval and display

- **Description**: The system retrieves the batches released for this station from OrgaTEX and displays them as a queue the operator can act on.
- **Acceptance Criteria**:
  - The queue displays batch ID, order reference, machine reference, fabric description, shade code, component count and weighing status for each batch. *(BRD FR-01, FR-04; PROTO view 1 table columns)*
  - Batches are fetched from OrgaTEX, never embedded in the client. *(PROTO: "Queue received from OrgaTEX at 06:12")*
  - The time the queue was last received is displayed. *(PROTO view 1)*
  - The queue can be filtered by status. *(BRD IR-01)*
  - A batch not in `RELEASED` state cannot be selected; the reason is shown. *(BRD BR-03, FR-03)*
- **Priority**: Must
- **Traceability**: BRD BR-01, FR-01, FR-04, IR-01 · PROTO view 1
- **Assumptions**: A-01 (OrgaTEX interface exists) · Q-01

## FR-2: Batch selection by barcode or touch

- **Description**: The operator starts work on a batch either by scanning its identifier or by touching its row in the queue.
- **Acceptance Criteria**:
  - Scanning a barcode selects the matching released batch. *(BRD FR-02, BR-02)*
  - Touching a queue row selects that batch. *(BRD FR-02; PROTO view 1)*
  - A scan of an unknown or unreleased identifier is rejected with a visible reason, and no recipe is loaded. *(BRD FR-03)*
  - Batch selection is refused for a batch OrgaTEX has not released. *(BRD BR-03)*
- **Priority**: Must
- **Traceability**: BRD BR-02, BR-03, FR-02, FR-03 · PROTO view 1
- **Assumptions**: A-01, A-10 (dyestuffs carry scannable barcodes) · Q-07

## FR-3: Recipe retrieval and component list

- **Description**: On batch selection the system retrieves the batch detail and its recipe, **loads the recipe** into the active weighing session, and presents the components in recipe sequence.
- **Acceptance Criteria**:
  - The recipe is fetched from OrgaTEX and cached locally; it is never authored or modified locally. *(BRD BR-04, C-01, FR-05)*
  - The recipe is loaded into the weighing session on batch selection, and the component list becomes the source of truth for the components to weigh. *(BRD FR-05)*
  - Components are presented in recipe sequence with completed, active and pending states. *(BRD FR-06; PROTO rail states `done` / `WEIGHING` / `PENDING`)*
  - The rail displays, per component: colour swatch, name, dyestuff code, scale class, target quantity with unit, and state. *(PROTO `renderComps`)*
  - A count of components weighed so far is displayed against the total. *(PROTO `rail-done`)*
  - The recipe is read-only in WeighingMS. *(BRD BR-04)*
- **Priority**: Must
- **Traceability**: BRD BR-04, FR-05, FR-06 · PROTO rail
- **Assumptions**: A-01 · Q-01

## FR-4: Component identification and dyestuff identity verification

- **Description**: Before dispensing is accepted, the system verifies that the dyestuff being weighed is the dyestuff the recipe calls for.
- **Acceptance Criteria**:
  - The dyestuff barcode is scanned and matched against the recipe component. *(BRD FR-09, BR-10)*
  - A mismatch is rejected and the component cannot proceed to dispensing. *(BRD BR-10)*
  - The component header displays dyestuff code, name and colour swatch. *(PROTO `w-name`, `w-meta`)*
  - Fallback when a dyestuff carries no barcode: on-screen confirmation with operator attestation. *(BRD R-08)*
- **Priority**: Must
- **Traceability**: BRD BR-10, FR-09, FR-10 · PROTO `w-name`
- **Assumptions**: A-10 · Q-07

## FR-5: Dyestuff lot capture

- **Description**: The supplier lot of the dyestuff being consumed is captured against the component being weighed.
- **Acceptance Criteria**:
  - The lot is captured at weighing time and displayed alongside the component. *(BRD FR-10; PROTO `w-meta` — `LOT 2026-0387`)*
  - The lot is recorded on the weighing record. *(BRD FR-25, BR-11)*
  - The lot is retrieved from OrgaTEX where OrgaTEX holds it, otherwise captured by scan. *(BRD IR-04, §9.3)*
- **Priority**: Must
- **Traceability**: BRD FR-10, IR-04, BR-11 · PROTO `w-meta`
- **Assumptions**: A-09 · Q-10

## FR-6: Container assignment and tare handling

- **Description**: The system knows which container the component is being dispensed into and applies that container's tare so the dispensed quantity excludes the container's own weight.
- **Acceptance Criteria**:
  - A container is associated with the component being weighed and displayed with its ID. *(PROTO `w-meta` — `CONTAINER C-12`)*
  - Tare is applied either from the container master or by weighing the empty container. *(BRD FR-11; PROTO `btn-retare` — Re-tare action)*
  - The applied tare value and its source are displayed. *(PROTO `w-meta` — `TARE 214 g`)*
  - A re-tare action resets the dispense and re-establishes the tare. *(PROTO `btn-retare` → `reset()`)*
  - The container used is recorded on the weighing record. *(BRD FR-25)*
- **Priority**: Must
- **Traceability**: BRD FR-11, FR-25 · PROTO `w-meta`, `btn-retare`
- **Assumptions**: A-09 · Q-10

## FR-7: Automatic scale selection

- **Description**: The system selects the scale appropriate to the component's target quantity, rather than the operator choosing.
- **Acceptance Criteria**:
  - The target scale is determined from the component target quantity against the scale-selection rule. *(BRD FR-07, BR-05)*
  - The selected scale is displayed with its class and capacity. *(PROTO `w-scale` — "3 kg precision"; `cap-max` — "125 g" / "32 kg")*
  - The selection is automatic and requires no operator input. *(BRD BR-05, AC-02)*
  - A supervisor-authorised manual reselection is possible. *(BRD FR-08, FR-35)*
  - Weighing is prevented on a scale whose calibration has expired. *(BRD FR-12, BR-24, AC-14)*
- **Priority**: Must
- **Traceability**: BRD BR-05, BR-24, FR-07, FR-08, FR-12, AC-02, AC-14 · PROTO `w-scale`
- **Assumptions**: A-06 · Q-04

## FR-8: Live weight stream and guided dispensing

- **Description**: While the operator dispenses, the system shows the current weight, the target, and how much remains, updating continuously from the scale.
- **Acceptance Criteria**:
  - The live weight updates continuously from the selected scale at no less than 10 readings per second. *(BRD IR-10, FR-13)*
  - The readout shows the current weight, the still-to-weigh quantity and the target quantity, each with its unit. *(BRD FR-14; PROTO three cells — "Weighed now" / "Still to weigh" / "Target")*
  - The still-to-weigh quantity is `max(0, target − current)`. *(PROTO `w-left`)*
  - A graphical progress indicator shows the fill relative to the scale's capacity, with the tolerance band and the target line marked. *(BRD FR-15; PROTO `bar` / `fill` / `band` / `tline`)*
  - The indicator is accessible: `role="progressbar"` with `aria-valuenow`. *(PROTO `bar` attributes)*
  - The tolerance band caption shows the tolerance magnitude and its lower and upper bounds. *(PROTO `cap-band` — "TOLERANCE ±0.5 g (93.5 – 94.5)")*
  - The scale's maximum capacity is displayed as the right-hand scale of the indicator. *(PROTO `cap-max`)*
- **Priority**: Must
- **Traceability**: BRD FR-13, FR-14, FR-15, IR-10, NFR-01 · PROTO readout, `bar`
- **Assumptions**: A-05 (approved at Checkpoint 1) · Q-03

## FR-9: Tolerance zones and status signalling

- **Description**: The system classifies the current weight into a tolerance zone and signals that state distinctly to the operator.
- **Acceptance Criteria**:
  - Four zones are distinguished: `under` (below target − tolerance), `near` (within 10% below target), `ok` (inside tolerance), `over` (above target + tolerance). *(PROTO `zone()`)*
  - Zone boundaries are evaluated as: `over` when `weight > target + tolerance`; `ok` when `weight >= target − tolerance`; `near` when `weight >= target × 0.9`; otherwise `under`. *(PROTO `zone()`)*
  - The status line states the remaining quantity to dispense when under or near. *(PROTO `status` — "DISPENSE — 94.0 g REMAINING")*
  - The status line states that the weight is within tolerance and that OK confirms it when inside. *(PROTO `status` — "WITHIN TOLERANCE — PRESS OK TO CONFIRM")*
  - The status line states the surplus when over tolerance. *(PROTO `status` — "OVER TOLERANCE — SURPLUS +2.4 g")*
  - The zone is reflected on the progress bar, the live-weight cell and the status line via a shared `data-zone` attribute. *(PROTO `paint()` — `data-zone` on `bar`, `cell-live`, `status`)*
  - The tolerance band is always visible on the indicator, whether or not the zone is `ok`. *(PROTO `band`)*
- **Priority**: Must
- **Traceability**: BRD FR-15, FR-16, FR-17 · PROTO `zone()`, `paint()`, `status`
- **Assumptions**: A-05, A-07 · Q-05

## FR-10: Confirmation gating

- **Description**: A component can only be confirmed when its weight is inside tolerance, or when a supervisor has authorised an override.
- **Acceptance Criteria**:
  - The confirm action is disabled while the zone is not `ok`. *(PROTO `btn-ok` — `disabled = (z !== "ok")`)*
  - The confirm action is enabled only inside tolerance, or after an authorised override. *(BRD FR-18, AC-04)*
  - Confirmation is impossible while the weight sits outside tolerance. *(BRD AC-04)*
  - On confirmation, the actual quantity is recorded, the component becomes `done`, and the rail re-renders. *(PROTO `btn-ok` handler)*
  - The confirmed actual is displayed against the target in the rail. *(PROTO rail — "✓ 1241.5")*
  - An in-progress component can be abandoned and restarted. *(BRD FR-19; PROTO `btn-quit` → `reset()`)*
- **Priority**: Must
- **Traceability**: BRD FR-18, FR-19, AC-04 · PROTO `btn-ok`, `btn-quit`
- **Assumptions**: A-05, A-07

## FR-11: Over-dose detection, overshoot and surplus calculation

- **Description**: When the weight **overshoots** the tolerance maximum, the system detects the over-dose, calculates the surplus, and presents a response.
- **Acceptance Criteria**:
  - An over-dose is detected and the surplus above the tolerance maximum is calculated. *(BRD FR-20)*
  - The overshoot is detected as the `over` zone: `weight > target + tolerance`. *(PROTO `zone()`, `btn-override`)*
  - The surplus is expressed as an absolute quantity and as a percentage of the target. *(PROTO surplus panel — "Surplus +2.4 g (+2.6%) — over tolerance")*
  - The surplus panel becomes visible only in the `over` zone. *(PROTO `surplus.classList.toggle("on", z === "over")`)*
  - The surplus is the amount above the target, matching the status line. *(PROTO `status` — surplus above `target`)*
  - The prototype's overshoot simulation (`Simulate overshoot`, landing at `target + tolerance × 4.8`) is reproduced by the Dummy Scale. *(PROTO `sim-over`)*
- **Priority**: Must
- **Traceability**: BRD FR-20 · PROTO `zone()`, `surplus` panel, `sim-over`
- **Assumptions**: A-05, A-08 · Q-06

## FR-12: Surplus compensation

- **Description**: Where an over-dose is compensable, the system recalculates the remaining components' targets to preserve the shade ratio, and presents the proposal for acceptance.
- **Acceptance Criteria**:
  - Compensability is determined against the compensation rule. *(BRD FR-21)*
  - Where compensable, revised targets for all remaining components are calculated preserving the recipe ratio. *(BRD FR-22)*
  - The proposal is presented showing each affected component's original target and its revised target. *(PROTO surplus table — "Sodium Sulphate 24.000 kg → 24.624 kg")*
  - The proposal states that it recalculates the remaining components to preserve the shade ratio. *(PROTO surplus panel footnote)*
  - The compensation applied is recorded with the authorising user and the reason. *(BRD FR-24)*
- **Priority**: Must
- **Traceability**: BRD FR-21, FR-22, FR-24 · PROTO surplus table
- **Assumptions**: A-08 (the highest-likelihood misunderstanding; BRD R-03) · Q-06

## FR-13: Non-compensable over-dose escalation

- **Description**: Where an over-dose cannot be compensated, the system escalates rather than silently accepting it.
- **Acceptance Criteria**:
  - The operator is offered supervisor override, or discard-and-re-weigh. *(BRD FR-23)*
  - An override request enters an explicit awaiting-supervisor state. *(PROTO `btn-override` — "OVERRIDE REQUESTED — AWAITING SUPERVISOR")*
  - An override cannot be completed without supervisor authentication and a recorded reason. *(BRD AC-06, FR-35)*
  - The override records who authorised it, the reason and the time. *(BRD FR-24, BR-13, OVERRIDE entity)*
- **Priority**: Must
- **Traceability**: BRD FR-23, FR-24, BR-13, AC-06 · PROTO `btn-override`
- **Assumptions**: A-08 · Q-06

## FR-14: Component progression

- **Description**: After a component is confirmed, the system advances to the next pending component in recipe sequence.
- **Acceptance Criteria**:
  - The next `pending` component becomes active and the weigh view updates to it. *(PROTO `btn-ok` → `select(next)`)*
  - The recipe sequence is preserved — progression is by recipe order, not by operator choice. *(BRD FR-06)*
  - A `done` component cannot be re-selected. *(PROTO `select()` — `if (components[i].state === "done") return;`)*
  - A pending component may be selected out of sequence, and selecting one resets the dispense. *(PROTO `select()` → `reset()`)*
- **Priority**: Must
- **Traceability**: BRD FR-06, FR-19 · PROTO `select()`, `btn-ok`
- **Assumptions**: A-05

## FR-15: Batch completion summary

- **Description**: When the last component is confirmed, the system presents the batch completion summary.
- **Acceptance Criteria**:
  - The summary shows the batch identifier. *(PROTO — "Batch B-24187 weighed")*
  - The summary shows components weighed as a count of the total. *(PROTO — "5 of 5")*
  - The summary states whether all components were within tolerance. *(PROTO — "All within tolerance: YES")*
  - The summary shows total dispensed, with units summed correctly across grams and kilograms. *(PROTO — "35.322 kg")*
  - The summary shows elapsed time and the operator. *(PROTO — "6 min 41 s", "R. Karim")*
  - The summary shows the OrgaTEX write-back result and its confirmation time. *(PROTO — "CONFIRMED 07:48:22")*
  - The summary states that the container is released for transport, with the target machine. *(PROTO — "Container released for transport to JET-04")*
- **Priority**: Must
- **Traceability**: BRD FR-26, BR-29, AC-08 · PROTO view 3
- **Assumptions**: A-01, A-02 · Q-02

## FR-16: OrgaTEX write-back

- **Description**: On batch completion the system posts actual consumption per component to OrgaTEX and advances the batch weighing status.
- **Acceptance Criteria**:
  - Actual consumption is posted per component against the batch. *(BRD FR-26, IR-05)*
  - The batch weighing status is advanced to `WEIGHED`. *(BRD IR-06)*
  - Posting is idempotent — a retry after an ambiguous failure must not double-post. *(BRD IR-08)*
  - Interface failures are logged with enough detail to diagnose without OrgaTEX-side access. *(BRD IR-09)*
  - No OrgaTEX batch field other than weighing status is altered. *(BRD §9.2)*
- **Priority**: Must
- **Traceability**: BRD FR-26, IR-05, IR-06, IR-08, IR-09, AC-08 · PROTO view 3
- **Assumptions**: A-01, A-02 · Q-02

## FR-17: Weighing ticket generation

- **Description**: On batch completion a weighing ticket is produced, and it accompanies the weighed container to the dyeing machine.
- **Acceptance Criteria**:
  - A ticket is produced on batch completion. *(BRD FR-27, BR-15, AC-10)*
  - The ticket shows batch, order, machine, shade, date and operator. *(PROTO ticket)*
  - The ticket lists each component with its target and actual quantity and unit. *(PROTO ticket component table)*
  - The ticket states the overall tolerance outcome. *(PROTO — "ALL WITHIN TOLERANCE")*
  - The ticket carries a machine-readable barcode of the batch identifier. *(PROTO `barcode` + batch ID)*
  - Label content and layout are configurable without a code change. *(BRD IR-16)*
  - A reprint is permitted and is marked as a reprint. *(BRD FR-28)*
- **Priority**: Must
- **Traceability**: BRD FR-27, FR-28, BR-15, IR-16, AC-10 · PROTO view 3 ticket
- **Assumptions**: A-04 · Q-11
- **Training note**: The prototype states plainly that "Label content is invented" (PROTO view 3). The ticket layout is therefore a **training artefact**, not an FCI-approved format.

## FR-18: Operator identification and traceability

- **Description**: Every weighing is attributable to an identified operator, and the record carries the full traceability set.
- **Acceptance Criteria**:
  - The operator is identified at session start and shown in the top bar. *(BRD FR-34; PROTO `op-chip` — "Operator R. Karim · Shift A")*
  - Every confirmed weighing records target, actual, operator, scale, timestamp and dyestuff lot. *(BRD FR-25, BR-11)*
  - The target and tolerance values are snapshotted onto the record at weighing time, so a later revision in OrgaTEX does not alter the historical record. *(BRD §9.2 WEIGHING_RECORD note, BR-14)*
  - For any past batch, exactly what was weighed can be reconstructed. *(BRD BR-14, FR-29)*
  - Weighing history is retrievable by batch, date, operator or dyestuff. *(BRD FR-29)*
  - Records are immutable once confirmed; corrections are new records referencing the original. *(BRD DR-02)*
  - Weighing records, compensations, overrides and audit events are retained for a minimum of 5 years. *(BRD DR-01)*
- **Priority**: Must
- **Traceability**: BRD BR-11, BR-14, BR-19, FR-25, FR-29, FR-34, DR-01, DR-02 · PROTO `op-chip`
- **Assumptions**: A-09, A-14 · Q-08

## FR-19: Peripheral status and failure handling

- **Description**: The operator can see the state of every connected peripheral, and a peripheral failure is handled safely rather than silently.
- **Acceptance Criteria**:
  - The status strip shows the state of both scales, the scanner and the printer. *(BRD IR-18; PROTO bottom strip — "SCALE 3 kg · READY", "SCALE 32 kg · READY", "SCANNER", "PRINTER")*
  - **Scale failure**: disconnection is detected within 2 seconds and confirmation is blocked while disconnected. *(BRD IR-13)*
  - **Scanner failure**: a scanner that is unavailable or returns an unreadable code is reported to the operator, and the affected step cannot be silently skipped. *(BRD IR-15, BR-18)*
  - **Printer failure**: a printer that is unavailable is reported to the operator, and the ticket is queued for reprint rather than being lost. *(BRD IR-16, FR-27)*
  - The distinction between settling and settled weight is understood from the indicator's stability flag. *(BRD IR-11)*
  - Tare can be issued to the indicator, or applied in software where the indicator does not support it. *(BRD IR-12)*
  - Both scales can be connected concurrently. *(BRD IR-14)*
  - The 21-key terminal duplicates every confirm/abandon action available on the touchscreen. *(BRD IR-17)*
- **Priority**: Must
- **Traceability**: BRD IR-10–IR-18, FR-27 · PROTO status strip
- **Assumptions**: A-05, A-10 · Q-03

## FR-20: Offline operation and deferred synchronisation

- **Description**: Weighing continues when OrgaTEX is unreachable, and the work is transmitted once connectivity returns.
- **Acceptance Criteria**:
  - The station continues operating on locally held recipe and master data when OrgaTEX is unreachable. *(BRD FR-30, BR-16, NFR-03)*
  - Un-synchronised records are queued and transmitted automatically on reconnection. *(BRD FR-31, BR-17)*
  - The connection state and the count of un-synchronised records are displayed. *(BRD FR-32)*
  - Synchronisation failures are surfaced for manual attention. *(BRD FR-33, BR-18)*
  - Reconnection transmits without re-keying and without duplication. *(BRD AC-09)*
  - A full batch can be weighed with the network disconnected. *(BRD AC-09)*
- **Priority**: Must
- **Traceability**: BRD FR-30–FR-33, BR-16–BR-18, NFR-03, AC-09
- **Assumptions**: A-03 · Q-02

## FR-21: Privileged actions and audit trail

- **Description**: Actions reserved to a supervisor are authenticated, and every privileged action is recorded.
- **Acceptance Criteria**:
  - Supervisor authentication is required for tolerance override, manual scale reselection and calibration bypass. *(BRD FR-35)*
  - Credentials are never shared between roles. *(BRD NFR-12)*
  - All privileged actions are written to the audit trail. *(BRD FR-36)*
  - The audit trail records the actor, the event type, the detail and the time. *(BRD §9.2 AUDIT_EVENT)*
  - Audit records are immutable and exportable. *(BRD NFR-13)*
- **Priority**: Must
- **Traceability**: BRD FR-35, FR-36, NFR-12, NFR-13
- **Assumptions**: A-09 · Q-08

## FR-22: Configuration and localisation

- **Description**: Operational configuration is changeable without a redeployment, and operator-facing text is externalised.
- **Acceptance Criteria**:
  - Scale configuration, tolerance rules, label content and interface language are changeable without redeployment. *(BRD NFR-14)*
  - All operator-facing text is externalised for translation. *(BRD NFR-11)*
  - The interface is presented in the configured language. *(BRD FR-37, BR-21)*
- **Priority**: Should
- **Traceability**: BRD FR-37, BR-21, NFR-11, NFR-14
- **Assumptions**: A-10

## FR-23: Operational reporting

- **Description**: The business can report on tolerance failures and overrides over a period.
- **Acceptance Criteria**:
  - Tolerance failures and overrides are reportable over a period. *(BRD BR-23)*
  - A supervisor can see batch weighing progress without visiting the station. *(BRD BR-22)*
- **Priority**: Should
- **Traceability**: BRD BR-22, BR-23
- **Assumptions**: A-11

---

# Non-Functional Requirements

## NFR-1: Responsiveness

| Requirement | Metric | Target | Source |
|---|---|---|---|
| Displayed weight lags the scale | End-to-end lag | ≤ 200 ms | BRD NFR-01 |
| Scale sampling interval | Readings per second | ≥ 10 Hz | BRD IR-10 |
| Batch selection to recipe displayed | Latency when online | ≤ 3 s | BRD NFR-02 |
| Scale disconnection detection | Time to detect and block | ≤ 2 s | BRD IR-13 |

## NFR-2: Data integrity

| Requirement | Metric | Target | Source |
|---|---|---|---|
| Weight arithmetic | Numeric type | Fixed-point decimal; floating point **not permitted** for quantities | BRD NFR-16 |
| Quantity precision | Decimal places | 4 (BRD `decimal(12,4)`) | BRD §9.2 |
| Unit display precision | Decimal places | 1 for grams, 3 for kilograms | PROTO `dp()` |

## NFR-3: Availability and recovery

| Requirement | Metric | Target | Source |
|---|---|---|---|
| Weighing during OrgaTEX/network outage | Availability | Weighing remains available | BRD NFR-03 |
| Station availability in production hours | Uptime | 99% | BRD NFR-04 |
| Confirmed weighing on power loss | Durability | Survives immediate power loss | BRD NFR-05 |
| Interrupted session | Recovery | Resumable at the component in progress | BRD NFR-06 |

## NFR-4: Usability

| Requirement | Metric | Target | Source |
|---|---|---|---|
| Gloved-hand operation | Touch target | ≥ 15 mm, all primary actions | BRD NFR-07 |
| Weight readout legibility | Viewing distance | Readable at 1.5 m | BRD NFR-08 |
| Operator trainability | Time to competence | Within one shift | BRD NFR-09 |
| Operator literacy assumption | Constraint | Interface must not assume computer literacy | BRD C-05 |

## NFR-5: Environment

| Requirement | Metric | Target | Source |
|---|---|---|---|
| Hardware rating at the station | Ingress protection | IP54 minimum | BRD NFR-10 |
| Environment | Constraint | Dust, humidity, cleaning | BRD C-04 |

## NFR-6: Security and auditability

| Requirement | Metric | Target | Source |
|---|---|---|---|
| Privileged actions | Authentication | Supervisor authentication required | BRD NFR-12 |
| Credential sharing | Policy | Credentials never shared between roles | BRD NFR-12 |
| Audit records | Integrity | Immutable and exportable | BRD NFR-13 |
| Record retention | Duration | ≥ 5 years | BRD DR-01 |

## NFR-7: Maintainability and capacity

| Requirement | Metric | Target | Source |
|---|---|---|---|
| Configuration changes | Redeployment | Not required for scale, tolerance, label, language | BRD NFR-14 |
| Station capacity | Daily volume | FCI's actual volume without degradation | BRD NFR-15 |
| Operator-facing text | Localisation | Fully externalised for translation | BRD NFR-11 |

---

# Confirmed Requirements

Settled by the source artifacts — safe to build:

| # | Requirement | Source |
|---|---|---|
| C-01 | WeighingMS is read-only against OrgaTEX batches, recipes, tolerances and dyestuff master, except batch weighing status and consumption posting | BRD BR-04, §9.2, C-01, C-02 |
| C-02 | No connection to or control of dispensing machinery | BRD C-03 |
| C-03 | The interface exposes exactly three views: Select batch, Weigh, Confirm & print | PROTO |
| C-04 | The recipe rail renders components with swatch, name, code, scale class, target and state | PROTO `renderComps()` |
| C-05 | Four tolerance zones with the exact boundaries given in FR-9 | PROTO `zone()` |
| C-06 | The progress indicator is scaled to the scale's maximum capacity, with tolerance band and target line | PROTO `paint()` |
| C-07 | Confirm is disabled unless the zone is `ok` | PROTO `btn-ok` |
| C-08 | Done components cannot be re-selected | PROTO `select()` |
| C-09 | The completed view shows the ticket layout and the batch summary | PROTO view 3 |
| C-10 | Peripheral status strip covers both scales, scanner and printer | PROTO status strip |
| C-11 | Fixed-point decimal for all quantity arithmetic | BRD NFR-16 |
| C-12 | Weighing records are immutable once confirmed | BRD DR-02 |
| C-13 | All OrgaTEX interaction is confined to a single adapter component | BRD IR-07 |
| C-14 | Consumption posting is idempotent | BRD IR-08 |

---

# Assumptions

The BRD's register (A-01…A-15) applies. The assumptions that bind specific
requirements above:

| ID | Assumption | Binds | Risk if invalid |
|---|---|---|---|
| A-01 | SETEX provides a documented, licensed REST API exposing batch queue, recipe, components, tolerances and dyestuff master | FR-1, FR-3, FR-16 | **Severe.** No interface means the project premise fails |
| A-02 | OrgaTEX accepts actual-consumption postings from an external system | FR-15, FR-16, FR-20 | **Severe.** Without write-back, reconciliation is unreachable |
| A-03 | Weighing continues through an OrgaTEX outage and syncs afterwards | FR-20 | Moderate. If FCI prefers a stop, the sync subsystem is dropped |
| A-05 | Scale indicators stream weight continuously at ≥10 Hz with a stability flag | FR-8, FR-9, FR-10, FR-19 | **Severe.** If only stabilised values exist, guided weighing is redesigned |
| A-06 | Scale selection is rule-based on target quantity, with a defined threshold | FR-7 | Moderate. Threshold and boundary behaviour need FCI's rule |
| A-07 | Tolerances are per-component, percentage with an absolute floor, originating in OrgaTEX | FR-9, FR-10 | Moderate. If banded or per-dyestuff, the rule entity changes shape |
| A-08 | Surplus compensation means proportionally recalculating remaining components to preserve shade ratio | FR-11, FR-12, FR-13 | **High.** The most likely misunderstanding in the document |
| A-09 | Per-operator traceability required; lots captured at weighing; records retained long-term | FR-5, FR-18, FR-21 | Moderate |
| A-10 | Dyestuffs carry scannable barcodes; interface language English; 21-key terminal duplicates touchscreen actions | FR-2, FR-4, FR-19, FR-22 | Moderate. Absent barcodes make identity verification manual |
| A-12 | Powder dyestuffs and dry auxiliaries only; no liquids in V1 | FR-3, FR-7 | Moderate |

A-04, A-11, A-13, A-14 and A-15 remain carried but bind no functional requirement in this build.

---

# Unresolved Questions

Not decided by the Product Brief, the prototype, or this requirements document.

| ID | Question | Owner | Affects | Why it matters |
|---|---|---|---|---|
| Q-01 | Does SETEX provide a documented, licensed interface — of what kind? | FCI / SETEX | FR-1, FR-3, FR-16 | Determines whether the adapter has a real target (A-01) |
| Q-02 | Will OrgaTEX accept external consumption postings? | FCI / SETEX | FR-15, FR-16, FR-20 | Determines whether reconciliation is achievable (A-02) |
| Q-03 | What are the scale indicator make, model and protocol? | FCI | FR-8, FR-19 | Determines whether the live readout is buildable as drawn (A-05) |
| Q-04 | What is the scale-selection threshold, and what happens near the boundary? | FCI production | FR-7 | Determines the automatic selection rule (A-06) |
| Q-05 | What is the exact tolerance model — percentage, absolute, banded, per-dyestuff? | FCI production | FR-9, FR-10 | Determines the tolerance rule shape (A-07) |
| Q-06 | What does "surplus compensation" mean to FCI in practice? | FCI production | FR-11, FR-12, FR-13 | Highest-likelihood misunderstanding (A-08, BRD R-03) |
| Q-07 | Do dyestuffs carry scannable barcodes in reality? | FCI | FR-4 | If not, identity verification falls back to attestation (A-10, BRD R-08) |
| Q-08 | Does FCI supply its own operator directory? | FCI IT | FR-18, FR-21 | Determines the authentication implementation (A-09) |
| Q-09 | What is FCI's actual daily batch and component volume? | FCI | NFR-7 | Determines whether one station suffices (A-15) |
| Q-10 | Does one container hold one component or a whole recipe, and how are containers identified? | FCI production | FR-5, FR-6 | Determines tare and container modelling |
| Q-11 | What content should the weighing ticket and label carry? | FCI | FR-17 | Determines ticket layout and reprint marking (A-04) |
| Q-12 | What are the baseline figures for out-of-tolerance rate, re-dye rate and throughput? | FCI | Business Goals | Determines whether the business case is measurable (A-14) |

---

# Training-Only Dummy Behaviour

The external systems are unavailable. Four Dummy APIs stand in for them and are
**part of the product**. The behaviours below exist only for this build; none is
a claim about the real OrgaTEX, scale, scanner or printer.

| Dummy | Endpoints (training contract) | Training behaviour |
|---|---|---|
| **Dummy OrgaTEX** | `GET /api/batches`, `GET /api/batches/:id`, `GET /api/batches/:id/recipe`, `POST /api/batches/:id/consumption` | Serves a fixed seed set of batches and recipes, mirroring the prototype's five-component Teal 4C recipe. Accepts a consumption posting and echoes it. Honours an offline mode so FR-20 can be exercised |
| **Dummy Scale** | `GET /api/scales`, `GET /api/scales/:id/status`, `GET /api/scales/:id/weight` (SSE), `POST /api/scales/:id/tare` | Streams weight at 10 Hz over SSE with a stability flag. Two scales: 3 kg precision, 32 kg floor. Simulates a dispensing ramp and a disconnect |
| **Dummy Scanner** | `POST /api/scan` | Returns a barcode payload for the requested entity type (batch, dyestuff, lot). Simulates a scan of an unknown code |
| **Dummy Printer** | `POST /api/tickets` | Renders a ticket from a template and returns it. Supports reprint marking |

**Rules for the Dummies**:
- The dummies are **training contracts behind the adapter boundary** (FR-16, C-13). No real external contract is invented or assumed.
- No fake data is hard-coded into the UI. All UI data arrives over these APIs.
- The dummies are independently exercisable (e.g. `curl`) — they are a product surface, not a test fixture.
- The dummies must reproduce the behaviour the BRD depends on: a 10 Hz continuous stream with a stability flag, a stability flag that distinguishes settling from settled, and disconnect detection within 2 s.

---

# Constraints

## Technical constraints

**Project-wide standards**: loaded from `memory-bank/standards/` by the Construction Agent
(tech stack, coding standards). Not duplicated here.

**Intent-specific constraints** (not covered by the standards):
- All OrgaTEX interaction is confined to a single adapter component. *(BRD IR-07)*
- Consumption posting is idempotent. *(BRD IR-08)*
- Confirmed records are immutable; corrections are new records referencing the original. *(BRD DR-02)*
- No floating point for quantities, in API payloads and persisted values as well as in the UI. *(BRD NFR-16)*
- The Dummy APIs are training contracts only. *(Workbook section 0)*

## Business constraints
- OrgaTEX remains the single source of truth for batches and recipes. *(BRD C-01)*
- No modification to OrgaTEX. *(BRD C-02)*
- No connection to or control of dispensing machinery. *(BRD C-03)*
- Industrial dyehouse environment — dust, humidity, cleaning. *(BRD C-04)*
- Operators may have limited computer literacy. *(BRD C-05)*
- Physical scale capacities bound what can be weighed. *(BRD C-06)*
- All primary actions reachable with gloved hands, ≥15 mm touch targets. *(BRD NFR-07)*

---

# Dependencies

| ID | Dependency | Owner | Needed by |
|---|---|---|---|
| D-01 | SETEX interface documentation and licence | FCI with SETEX | Before PRD sign-off |
| D-02 | Scale indicator models and protocol documentation | FCI | Before PRD |
| D-03 | Network access from station to OrgaTEX, with credentials | FCI IT | Before integration testing |
| D-04 | Hardware procurement — scales, terminal, scanner, printer | To be agreed | Before installation |
| D-05 | FCI confirms tolerance and compensation rules | FCI production | Before PRD |
| D-06 | Operator availability for UI validation and training | FCI production | Before acceptance |
| D-07 | Baseline metrics for BO-01, BO-03, BO-06 | FCI | Before acceptance |

---

# Acceptance Criteria Trace

| AC | Criterion | Covered by |
|---|---|---|
| AC-01 | Batch selected by scan, correct recipe within 3 s | FR-1, FR-2, FR-3 · NFR-1 |
| AC-02 | Correct scale selected per component, no operator input | FR-7 |
| AC-03 | Live weight tracks the physical scale, no perceptible lag | FR-8 · NFR-1 |
| AC-04 | Confirmation impossible outside tolerance | FR-10 |
| AC-05 | Over-dose produces the agreed compensation or escalation | FR-11, FR-12, FR-13 |
| AC-06 | Override requires supervisor authentication and a reason | FR-13, FR-21 |
| AC-07 | Confirmed weighing retrievable with target, actual, operator, scale, lot, timestamp | FR-18 |
| AC-08 | Consumption appears correctly in OrgaTEX | FR-15, FR-16 |
| AC-09 | Batch weighed offline; records reach OrgaTEX without re-keying or duplication | FR-20, FR-16 |
| AC-10 | Ticket prints with FCI's agreed content | FR-17 (content is a training artefact — Q-11) |
| AC-11 | New operator completes a batch unaided after one shift | NFR-4 (not automatable in this build — A-14) |
| AC-12 | Batch weighed no slower than the paper process | Business Goals, NFR-4 (unmeasurable until A-13/A-14 resolve) |
| AC-13 | All operator-facing text in the agreed language | FR-22 |
| AC-14 | Weighing prevented on an out-of-calibration scale | FR-7 |

---

# Requirement Quality Checklist

- [x] All requirements are testable (measurable, not vague) — every FR carries binary acceptance criteria
- [x] Acceptance criteria are binary (pass/fail) — stated as observable conditions
- [x] NFRs have specific metrics and targets — every NFR row has a metric and a target
- [x] Dependencies are identified — D-01…D-07
- [x] Constraints are documented — technical and business, separately
- [x] Assumptions are stated and risks assessed — 10 binding assumptions with severity
- [x] Unknowns are separated from requirements — 12 open questions with owners
- [x] Training-only behaviour is separated — 4 Dummy APIs with an explicit no-claims rule

## Next Steps

1. **Step 8** — analyse the UI prototype as a functional prototype
2. **Steps 9–10** — System Context, then Unit decomposition
3. **Steps 11–12** — Stories, then Bolt plan
