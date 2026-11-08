---
id: 006-apply-surplus-compensation
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 006-apply-surplus-compensation

## User Story

**As a** dyehouse operator
**I want** the remaining components recalculated so the shade ratio is preserved, and shown to me before I accept it
**So that** one over-weighed component does not silently wreck the batch

## Acceptance Criteria

- [ ] **Given** a surplus of `2.4000 g` and a total remaining target of `94.0000 g`, **When** the compensation proposal is calculated, **Then** the factor is `surplus ÷ totalRemainingTarget = 2.4000 ÷ 94.0000 = 0.025532` and every remaining component's target is increased by that factor's proportion, preserving the recipe ratio (BRD FR-12, `A-08`).
- [ ] **Given** a surplus of `2.4000 g` and a total remaining target of `188.0000 g`, **When** the compensation proposal is calculated, **Then** the factor is `2.4000 ÷ 188.0000 = 0.012766` — the factor is **derived from this surplus**, not carried over from any worked example (BRD FR-12, `A-08`).
- [ ] **Given** a compensable over-dose, **When** the proposal is presented, **Then** it shows each affected component's original target and its revised target, and states that the remaining components are recalculated to preserve the shade ratio (BRD FR-12, BRD FR-22).
- [ ] **Given** a proposal has been presented, **When** the operator accepts it, **Then** the remaining components' targets are revised by the proposed amounts and the session returns to `WEIGHING` on the next pending component (BRD FR-12, BRD FR-24).
- [ ] **Given** the remaining components cannot absorb the surplus, **When** compensability is determined, **Then** no proposal is produced and the session escalates instead (BRD FR-12, BRD FR-13).

## Technical Notes

- **The compensation factor is proportional and computed, not constant.** `factor = surplus ÷ totalRemainingTarget`, and each remaining component's revised target is `originalTarget × (1 + factor)`. This is assumption `A-08`, the BRD's own flagged highest-likelihood misunderstanding (BRD R-03, `Q-06`).
- **The prototype's `1.026` is NOT a rule.** It is the prototype's own worked example — a surplus of `+2.4 g` on `94.0 g`, i.e. `+2.6%`, in a prototype whose remaining total happened to be `94.0 g`. A constant of `1.026` is correct only for that one example and wrong for every other surplus. **Do not replace the proportional formula with the prototype constant.** The unit brief's success criteria require the rule to be "tested against the proportional formula, not against the prototype's example constant". The implementation records which rule it applied, so that a different answer from FCI to `Q-06` changes one place rather than requiring a rewrite.
- Worked numbers, to fix the behaviour precisely:
  - Surplus `2.4000 g`, remaining total `94.0000 g` → factor `0.025532` (2.5532%). A remaining component of `20.0000 g` revises to `20.0000 × 1.025532 = 20.51064 g`; a remaining component of `74.0000 g` revises to `74.0000 × 1.025532 = 75.889368 g`. The two revised targets sum to `96.4000 g`, i.e. the original `94.0000 g` plus the `2.4000 g` surplus — the surplus is fully and only distributed.
  - Surplus `2.4000 g`, remaining total `188.0000 g` → factor `0.012766` (1.2766%), i.e. **not** `0.025532`. The formula, not the prototype's example, decides.
- The division is performed in fixed-point decimal with a defined rounding (half-up at the storage precision of 4 dp). No float appears anywhere in the factor or the revised targets (BRD NFR-16, `C-11`).
- **Compensability** is determined against the compensation rule: a surplus is compensable when the remaining components can absorb it under this proportional rule; otherwise the session escalates (story 007). The compensability check and the proposal generation share one rule implementation so they can never disagree.
- The proposal is a **`SurplusProposal`**: `surplusAmount`, `surplusPercent`, `recalculatedComponents[]`, `factor`. It is presented for acceptance; it is **not** applied until the operator accepts it.
- On acceptance, the compensation applied is recorded with the authorising user and the reason, and retained for ≥ 5 years (BRD FR-24, BRD DR-01). The proposal itself is persisted as one row per over-dose.
- Revised targets apply to **remaining** components only. The component that was over-dosed is not recalculated by its own proposal; it is handled by the over-dose path.
- Assumptions and open items: `A-08` (High risk), `Q-06` (owner FCI production). If the answer to `Q-06` turns out to be "surplus compensation just means displaying the excess", the compensation path is **deleted** rather than rewritten.

## Dependencies

### Requires
- 005-detect-overdose-and-calculate-surplus (the surplus amount)

### Enables
- 007-escalate-non-compensable-overdose (the non-compensable branch of the same decision)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Surplus `2.4000 g`, remaining total `94.0000 g` | Factor `0.025532` — the prototype's example happens to land here; this is a **result**, not a constant |
| Surplus `2.4000 g`, remaining total `188.0000 g` | Factor `0.012766` — a constant `1.026` would be wrong here |
| Surplus `0.0000 g` (over-dose with zero excess after rounding) | Factor `0`; revised targets equal the originals; no proposal is presented |
| No remaining components (last component over-dosed) | The surplus cannot be absorbed — no proposal; escalate (story 007) |
| A remaining component's revised target would fall below zero after adjustment | The surplus is not compensable under the proportional rule; escalate |
| The operator declines the proposal | The proposal is recorded as declined; the over-dose is not confirmed; the batch is held |
| The operator accepts, then a later reading changes | The accepted proposal stands for the remaining components; it is not silently recomputed |
| Rounding at 4 dp | Half-up at the storage precision; the sum of revised targets equals the original remaining total plus the surplus within one unit at the last stored place |

## Out of Scope

- Supervisor authorisation of a non-compensable over-dose → story 007.
- The prototype's visual surplus table → `007-weighingms-ui`.
- Resolving `Q-06` with FCI → open question owned by FCI production; the rule is isolated so the answer changes one place.
