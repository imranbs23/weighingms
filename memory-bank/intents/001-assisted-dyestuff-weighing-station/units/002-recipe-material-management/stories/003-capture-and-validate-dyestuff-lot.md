---
id: 003-capture-and-validate-dyestuff-lot
unit: 002-recipe-material-management
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 003-capture-and-validate-dyestuff-lot

## User Story

**As a** dyehouse operator
**I want** the supplier lot of the dyestuff I am using recorded against the
component, whether it comes from OrgaTEX, from a scan or from my own entry
**So that** a shade failure can later be traced to the exact lot of material

## Acceptance Criteria

- [ ] **Given** a component whose lot is held by OrgaTEX, **When** the component is
  prepared for weighing, **Then** the lot is retrieved from OrgaTEX through the
  adapter and is displayed alongside the component, with the capture method recorded
  as `SOURCE` (FR-5, BRD IR-04, BRD FR-10).
- [ ] **Given** OrgaTEX does not hold the lot, **When** the operator scans a lot code
  on the container or material, **Then** the lot is captured against that component
  and is displayed alongside it, with the capture method recorded as `SCAN` (FR-5,
  BRD FR-10, BRD FR-25, BRD BR-11).
- [ ] **Given** OrgaTEX does not hold the lot and no code can be read, **When** the
  operator keys the lot number in and confirms it, **Then** the lot is captured
  against that component and is displayed alongside it, with the capture method
  recorded as `KEYED_IN` (FR-5, BRD FR-10).
- [ ] **Given** a lot has been captured for a component, **When** the weighing record
  is later retrieved, **Then** the record carries that lot number (FR-5, BRD FR-25,
  BRD BR-11, AC-07).
- [ ] **Given** the operator enters or scans a lot value, **When** the value is
  submitted empty, **Then** the capture is refused with a validation error naming the
  missing lot, and no lot is stored against the component (FR-5).
- [ ] **Given** the operator enters or scans a lot value, **When** the value is
  submitted, **Then** the stored lot is captured with the operator ID and the capture
  timestamp, so the capture is attributable to a person and a moment (FR-5, BRD BR-11,
  A-09).

## Technical Notes

- **CQ-08 is unresolved and this design accommodates both answers.** Whether
  containers already carry a lot barcode, or the lot is keyed in, is **CQ-08**. If
  keyed in, FR-5 becomes a form rather than a scan with different error
  characteristics. The lot is therefore modelled as a captured value with an explicit
  `captureMethod` (`SOURCE` | `SCAN` | `KEYED_IN`), so that all three routes are the
  same operation with different evidence — the question can be settled by FCI without
  a rewrite.
- **Tolerances and the lot are not this story's concern.** Lot validation is a
  presence-and-format check plus an optional upstream existence check. The unit does
  not compute or apply a tolerance rule here (BRD FR-03, BRD BR-04).
- **Adapter boundary.** Where the lot comes from OrgaTEX it is read through the
  adapter (BRD IR-07, C-13). No external endpoint or payload shape is asserted
  (Q-01, A-01).
- **Fixed-point decimal for quantities.** The lot number itself is an identifier, not
  a quantity, and is stored as a string with its source format preserved. Where the
  lot identifier embeds a quantity-like token, it is not converted to a number and
  never to a float (BRD NFR-16).
- **Storage.** One lot row per component per weighing, retained ≥ 5 years
  (BRD DR-01). The row carries `componentId`, `lotNumber`, `materialCode`,
  `captureMethod`, `capturedBy`, `capturedAt`.
- The captured lot is a snapshot: a later change in OrgaTEX does not alter the
  historical capture, matching the snapshot principle applied to weighing records
  (BRD BR-14).
- All operator-facing lot labels, placeholders and validation messages are
  externalised for translation (NFR-7, BRD NFR-11).
- The lot displayed on the component is the captured value, never a value re-derived
  from the current upstream state.

## Dependencies
### Requires
- 001-retrieve-recipe-and-component-list
- 002-verify-dyestuff-identity-by-scan-or-attestation

### Enables
- 004-assign-container-and-apply-tare
- 003-weighing-station (unit 003)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| OrgaTEX returns a lot for the component but the operator believes it is wrong | The upstream value is displayed as `SOURCE`; correcting a source-held lot is an upstream data matter and is not silently overwritten locally |
| The scanned lot code resolves to no known lot | The capture is refused with a visible reason stating the code is not recognised; the operator may key the lot in instead |
| The operator keys a lot with leading or trailing whitespace | The value is trimmed before validation and storage; the stored value is the trimmed form |
| The operator keys a lot longer than 64 characters | The capture is refused with a validation error naming the maximum length; the value is not truncated |
| The same lot number is captured for two different components | Both captures are stored; a lot may legitimately serve several components and is not de-duplicated |
| Two different lots are captured for the same component in one weighing | The most recent capture for that component is the effective one, and the superseded capture is retained in the record rather than deleted |
| The upstream system is unreachable and the lot must be scanned | The scan or keyed-in path remains available, and the capture method records that the lot was not source-held |

## Out of Scope

- Verifying the material identity → `002-verify-dyestuff-identity-by-scan-or-attestation`.
- Container assignment and tare → `004-assign-container-and-apply-tare`.
- The weighing record's own fields and confirmation → unit `003-weighing-station`.
- The upstream lot read and the MES contract → `005-orgatex-integration`.
- Consumption posting of the lot to OrgaTEX → unit `003-weighing-station` /
  `005-orgatex-integration` (BRD FR-16).
- The lot barcode or key convention, which is CQ-08 and owned by FCI production.
