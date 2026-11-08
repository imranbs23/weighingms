---
id: 002-verify-dyestuff-identity-by-scan-or-attestation
unit: 002-recipe-material-management
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 002-verify-dyestuff-identity-by-scan-or-attestation

## User Story

**As a** dyehouse operator
**I want** the station to confirm the dyestuff in my hand is the one the recipe
calls for, by scanning its code when that works and by my own attestation when it
does not
**So that** the wrong dyestuff can never reach the batch, and my record still shows
which material was actually dispensed

## Acceptance Criteria

- [ ] **Given** a component awaiting material identity, **When** the operator scans a
  barcode that matches the required component's dyestuff code, **Then** the component
  is marked verified with the method `SCAN`, the scanned code and the verification
  timestamp are stored, and the component may proceed to dispensing (FR-4,
  BRD FR-09, BRD FR-10).
- [ ] **Given** a component awaiting material identity, **When** the operator scans a
  barcode that does not match the required component, **Then** the verification is
  rejected as a hard stop, the reason names the scanned code and the expected code,
  the component cannot proceed to dispensing, and no attestation may be used to
  override the mismatch (FR-4, BRD BR-10).
- [ ] **Given** a scan fails because the code is unreadable or unknown, **When** the
  failure is reported to the operator, **Then** the affected step is not silently
  skipped and the operator is offered the attestation path (FR-4, BRD FR-19, BRD IR-15,
  BRD IR-18, BRD R-08).
- [ ] **Given** the operator has chosen to attest, **When** the operator confirms the
  on-screen identity of the material, **Then** the component is marked verified with
  the method `ATTESTATION`, the operator ID and the verification timestamp are
  stored, and the attestation is recorded as an attributable traceability decision
  (FR-4, BRD R-08, BRD BR-11).
- [ ] **Given** a component has been verified by attestation, **When** the weighing
  record is later retrieved, **Then** the record shows that the material identity was
  attested rather than scanned, and an attested component is distinguishable from a
  scanned one (FR-4, BRD BR-11).
- [ ] **Given** a component is not yet verified, **When** the operator attempts to
  begin dispensing it, **Then** the dispensing step is blocked and the operator is
  shown which verification is outstanding (FR-4).

## Technical Notes

- **Both paths are first-class.** The scan path and the attestation path are
  implemented as equally supported states, each with its own tests. Whether dyestuffs
  carry scannable barcodes at all is **Q-07** (assumption A-10); this story asserts
  neither answer. Switching the default between scan-first and attestation-first is a
  **configuration change**, not a rewrite.
- **The attestation is a decision, not a silent substitution.** When the scanner
  fails, the operator attests, and the attestation is recorded with `verifiedBy =
  ATTESTATION`, the operator identity and the time. An attested verification and a
  scanned verification are distinguishable in the audit trail (B-6, BRD BR-11). The
  attestation path is never entered silently on the operator's behalf.
- **Mismatch is a hard stop.** A scanned code that resolves to a different material
  is not a warning and is not downgradable to an attestation; the component is
  blocked (BRD BR-10).
- **Scanner seam.** The scanner is reached through the adapter boundary. The Dummy
  Scanner's `POST /api/scan` is a training contract behind that boundary; no external
  endpoint or payload shape is asserted here (Q-01, A-01, A-10).
- **Storage.** One identity row per component per weighing, retained ≥ 5 years
  (BRD DR-01). The row carries `componentId`, `verifiedBy`, `verifiedAt`, the operator
  ID, and the scanned barcode when the method is `SCAN`.
- The verification result is recorded against the component, so it survives into the
  weighing record; the weighing record itself is owned by unit 003.
- **Attestation may need more than one identity fact.** Whether an attestation covers
  only the dyestuff code or also the lot is tied to CQ-08; the attestation record is
  therefore structured to carry an attested-claims set, so that adding a lot claim
  later does not require a schema change.
- All operator-facing verification messages are externalised for translation (NFR-7,
  BRD NFR-11).
- No quantity values are produced by this story; where quantities later appear they
  must be fixed-point decimal, never float (BRD NFR-16).

## Dependencies
### Requires
- 001-retrieve-recipe-and-component-list

### Enables
- 003-capture-and-validate-dyestuff-lot
- 004-assign-container-and-apply-tare
- 003-weighing-station (unit 003)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The scanner returns a code for a material not in the recipe at all | The mismatch is a hard stop naming the scanned code and the expected code for the component |
| The scanner returns a code that matches a *different* component in the same recipe | The mismatch is a hard stop on this component; the operator may select the component the code does match |
| The scanner returns an empty code or a whitespace-only code | Treated as an unreadable scan, not as an unknown code; the operator is offered the attestation path |
| The scanner is disconnected entirely | The operator is told the scanner is unavailable and the affected step is not skipped; attestation remains available (BRD FR-19, BRD IR-15, BRD IR-18) |
| The operator attests and then scans a matching code | The later scan supersedes the attestation, and the stored method becomes `SCAN`; the superseded attestation is not silently deleted |
| The operator scans a matching code and then attests | The recorded method remains `SCAN`; the attestation is not permitted to downgrade a scan |
| The operator attempts to attest without explicitly confirming the displayed identity | The attestation is refused; no identity record is written without an explicit operator confirmation |
| The recipe has been re-read and the component's expected code has changed | The expected code used for comparison is the one loaded into the active session, so the comparison is against what the operator was shown |

## Out of Scope

- Capturing the supplier lot → `003-capture-and-validate-dyestuff-lot`.
- Container assignment and tare → `004-assign-container-and-apply-tare`.
- The weighing, tolerance zones and confirmation → unit `003-weighing-station`.
- The scanner seam and the scanner's own status reporting →
  `005-orgatex-integration`.
- Operator authentication → unit `008-operator-identity`.
- The recipe read → `001-retrieve-recipe-and-component-list`.
