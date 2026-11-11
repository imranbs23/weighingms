---
step: 24
decided: 2026-11-11T08:40:00Z
decided_by: human (project owner), at the Step 24 checkpoint
implemented_by: bolt 030-003-weighing-station
---

# Step 24 — The overshoot decision

**The workbook's requirement:** *"The supplied prototype deliberately
represents overshoot as a business question. Do not simply copy its
proposed calculation… Propose two or three safe training implementations…
Do not silently choose one… Record your selected training rule."*

## Observed problem

When a component is poured over its tolerance band, the station must not
record it as if it were in tolerance, and the operator must have a
**defined** way forward. The Product Brief says so: *"Where a component is
over-dosed, the business must have a defined response rather than an
ad-hoc one."*

The product as built (bolts 015–016) detects the overdose and proposes a
proportional recalculation of the remaining components. But **accepting the
proposal changes nothing**: the revised targets are not applied, and the
over-dosed component still cannot be confirmed, because the confirmation
gate refuses OVER unconditionally. An operator who accepts is stuck; the
only way out is Re-tare, which throws the surplus away.

## What is known, and what is assumed

| | Statement | Source |
|---|---|---|
| **Known** | Detect an overdose and calculate the surplus | Brief FR-20 |
| **Known** | Confirm only while inside tolerance, **or after authorised override** | Brief FR-18 |
| **Known** | Allow the operator to abandon a component and restart it | Brief FR-19 |
| **Known** | Where not compensable, offer **supervisor override or discard-and-re-weigh** | Brief FR-23 |
| **Known** | Record the compensation or override applied, **with authorising user and reason** | Brief FR-24 |
| **Assumed** | Compensability is decided by a rule | Brief FR-21, **A-08** |
| **Assumed** | "Surplus compensation" means proportionally recalculating the remaining components to preserve the shade ratio | Brief **A-08**, rated risk **High**: *"the most likely misunderstanding in the document. FCI may mean only 'display the excess'"*; open questions **Q25, Q26, Q33** |
| **Assumed** | The prototype's surplus panel: *"Proposal: recalculate the remaining components to preserve the shade ratio"* | The prototype pins it with Q25 as a question for FCI, not a rule |

## The options presented

| Option | Rule | Impact |
|---|---|---|
| **A · Discard and re-weigh only** | OVER stays unconfirmed; the only recovery is Re-tare and re-weigh; the surplus is shown for information | Simplest and safest; wastes dyestuff; ignores FR-18's "after authorised override" |
| **B · Proportional compensation** | Accepting the proposal confirms the over-dosed component (recorded COMPENSATED) and applies revised targets to every remaining component; non-compensable goes to a supervisor | Preserves shade and material, but builds on the brief's highest-risk assumption (A-08); the largest change |
| **C · Supervisor-gated** | OVER is never auto-confirmed and no recipe is recalculated. Recovery is either Re-tare and re-weigh, or a **supervisor override** to accept the weight as-is: authenticated, reason required, audited, marked on the record and the ticket | Implements FR-18, FR-23 and FR-24 as written; holds A-08 back until FCI answers Q25/Q26 |

## The decision

> **For this training implementation, an over-tolerance component is never
> confirmed automatically, and no recipe is recalculated. The operator has
> two defined recovery actions:**
>
> 1. **Re-tare and re-weigh** (discard the pour), or
> 2. **Supervisor override**: a supervisor authenticates at the terminal
>    (badge and PIN), gives a reason, and authorises confirming the weight
>    **as poured**. The override is single-use, bound to that component in
>    that session, and recorded with the supervisor, the operator, the
>    reason and the surplus. The weighing record and the ticket mark the
>    component **OVERRIDDEN**.
>
> **The surplus and its percentage are displayed for information only.**
> The proportional-compensation proposal is **withdrawn from the operator
> UI** until FCI answers Q25/Q26. The capability (bolt 015) stays in the
> code base, unused.

**Decided:** option **C**, by the project owner at the Step 24 checkpoint,
2026-11-11.

## Implementation and test

Built by **bolt 030-003-weighing-station** (DDD construction bolt, ADR-047),
with a human checkpoint at every stage.

| Evidence | What it shows |
|---|---|
| `STEP-24-overshoot-ui.png` | OVER at rest: the surplus shown for information; the override authorised by SUP-001; **OK · Confirm** enabled, "Over tolerance — authorised by a supervisor" |
| `STEP-24-overshoot-completion.png` | The completed batch: DYE-4471-B **OVER · overridden** on the detail and the ticket; the other components at their MES targets |
| `STEP-24-overshoot-test.png` | The Playwright run (`npm run test:e2e:step24`): every step passed, including a refused wrong PIN |
| `memory-bank/bolts/030-003-weighing-station/ddd-03-test-report.md` | The full test report: 1938/1938 Vitest, 10 new integration tests, Step 29 and Step 30 suites still passing |
