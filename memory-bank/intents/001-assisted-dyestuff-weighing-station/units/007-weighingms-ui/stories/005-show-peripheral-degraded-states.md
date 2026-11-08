---
id: 005-show-peripheral-degraded-states
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 005-show-peripheral-degraded-states

## User Story

**As a** weighing operator
**I want** every peripheral failure to appear as an explicit degraded state
**So that** I always know what is actually working, and never act on a number I cannot trust

## Acceptance Criteria

- [ ] **Given** the scale has stopped producing readings without reporting an error, **When** the weigh view renders, **Then** the readout shows **no value — never `0.0`** — the stream's age is shown, and the confirm action is disabled with a stated reason (FR-8, FR-19, BRD FR-19, BRD IR-13).
- [ ] **Given** a scale has disconnected, **When** the disconnection is detected, **Then** it is detected within 2 s, weighing on that scale is blocked, and the operator is told **which scale failed and what to do** (FR-19, BRD FR-19, BRD IR-13).
- [ ] **Given** a scale's calibration has expired, **When** the operator attempts to weigh on that scale, **Then** weighing is blocked, the reason names the expired calibration, and progression is prevented (FR-7, FR-19, BRD FR-12, AC-14).
- [ ] **Given** the scanner is unreadable or unavailable, **When** the scan step is presented, **Then** the scan panel reports the failure, **never silently skips the step**, and offers the attestation path (FR-4, FR-19, BRD IR-15, BRD IR-18).
- [ ] **Given** a component was verified by attestation rather than by scan, **When** the verification method is shown and the weighing record is later retrieved, **Then** the fallback is recorded and an unattested weighing is distinguishable from a scanned one (FR-4, BRD BR-11).
- [ ] **Given** the printer is out of paper or unavailable, **When** the print fails, **Then** the weighing is **still recorded**, the ticket is shown as **not printed** — never as printed — and a reprint can be requested later (FR-16, FR-19, BRD FR-19, BRD FR-27).
- [ ] **Given** OrgaTEX is unreachable, **When** the link state is read, **Then** the status strip reads `OFFLINE`, the queue shows its **last known state with its age**, writes are shown as **pending** — never as posted — and the **un-synchronised record count is visible** (FR-20, BRD FR-30, BRD FR-31, BRD FR-32).
- [ ] **Given** the OrgaTEX link is `DEGRADED`, **When** the station serves data from the last successful snapshot, **Then** the snapshot is **clearly marked with its age** and the reads are **not presented as current** (FR-20, BRD FR-32, BRD FR-33).
- [ ] **Given** the API is unreachable from the terminal, **When** the terminal attempts to refresh its state, **Then** it shows an explicit degraded state rather than stale numbers, and the weight readout is **never presented as live when the stream is not live** (FR-8, FR-19, NFR-1).
- [ ] **Given** the status strip renders, **When** each entry is read, **Then** every entry is a **real value from the API** — the prototype's hard-coded `ORGATEX · LINKED` is replaced by the actual link state, and the strip shows the state of both scales, the scanner and the printer (FR-19, BRD FR-19, BRD IR-18).
- [ ] **Given** any degraded state is rendered, **When** the client source is searched, **Then** **no user-visible literal string is written in a component** — every status label, failure reason, age label and disabled-action reason comes from the locale bundle (FR-22, BRD FR-22, BRD NFR-11).
- [ ] **Given** a degraded state is shown on the terminal, **When** its dimensions are measured, **Then** every status entry and every fallback action it offers is at least 15 mm and legible at 1.5 m (NFR-4, BRD NFR-07, BRD NFR-08).

## Technical Notes

- **The governing rule: no failure at any boundary may produce a silently wrong number.** Every degraded state in this story is one of the ways that rule is honoured at the rendering layer. The unit brief's degraded-states table is followed exactly — a scale that is silent, a scanner that will not read, a printer that is out of paper and a link that is down each have a **visible, specific** state, and none of them shows a wrong number (B-1…B-11).
- **A `0.0` fallback for a silent scale is the single most dangerous thing this client could render.** `0.0` is a legitimate under-dose reading, and an operator asked to act on it would be told the scale was empty when it was in fact silent. "No reading" and "a reading of zero" must be distinguishable all the way to the screen, so the readout renders an explicit empty state and the confirm action is disabled with a stated reason (B-3, BRD FR-19).
- **A stale snapshot is shown with its age and never as current.** When the link is `DEGRADED`, the last successful snapshot may still be served — but it is served *labelled with its age*. A snapshot presented as current is a wrong number wearing a correct-looking costume, and the operator cannot tell it apart from live data. The same applies to the last known queue state when the link is `OFFLINE` (BRD FR-32, BRD FR-33).
- **A queued write is shown as pending and never as posted.** A consumption posting that has not landed at OrgaTEX has not happened as far as the MES is concerned; showing it as posted would tell the operator their work has reached production when it has not. The pending state, the un-synchronised count and the last error are all surfaced, and a permanently failed entry stays visible as failed rather than being silently dropped (FR-20, BRD FR-33, BRD NFR-03).
- **A disabled action always states its reason.** The confirm action carries a `reason` alongside its `enabled` flag, and the reason is rendered next to the control. The reasons distinguish the cases an operator can actually act on — the scale is silent, the scale is disconnected, the calibration has expired, the API is unreachable — because a silently dead button on a gloved terminal is a support call rather than a design choice (FR-19, BRD IR-13).
- **The status strip is a renderer, not a monitor.** It does not probe devices and it does not infer states: every entry is the value the owning unit reports — the scale half from unit 004, the scanner half from unit 002, the printer half from unit 006, the OrgaTEX half from unit 005. The prototype's hard-coded `ORGATEX · LINKED` is deliberately not carried over; `LINKED`, `DEGRADED` and `OFFLINE` are real values that arrive over the API (FR-19, BRD IR-18).
- **The scanner failure is never a silent skip.** An unreadable or unavailable scanner is reported, the affected step is not bypassed, and the attestation path is offered. The attestation is a decision, not a substitute the client makes on the operator's behalf, and the method (`SCAN` or `ATTESTATION`) is carried into the record so that an unattested weighing is distinguishable later (FR-4, B-6, BRD BR-11).
- **A printer failure must never cost a weighing.** Recording a weighing and printing its ticket are two operations with two independent outcomes. The view shows the print job's error, marks the ticket as not printed, and offers a reprint — it never renders the ticket as printed when the job did not reach `DONE` (B-7, BRD FR-27).
- **The weight readout is never presented as live when the stream is not live.** The terminal shows an explicit degraded state when the API is unreachable rather than serving stale numbers, and the readout's liveness is tied to the stream's actual freshness (≤ 200 ms), not to the last number the client happened to receive (B-8, NFR-1, BRD NFR-01).
- **Every operator-facing string is a locale key** (FR-22, BRD NFR-11): the status labels, the failure messages, the age labels, the pending and not-printed wording and every disabled-action reason. A test asserts the client source contains no user-visible literal strings, and the locale bundle is fetched at runtime so a language can be changed without a redeployment (BRD FR-37, BRD NFR-14).
- Touch targets ≥ 15 mm and legibility at 1.5 m are testable assertions, not aspirations — a component test measures the rendered target, and a degraded state that cannot be read at arm's length is as useless as no degraded state at all.

## Dependencies

### Requires
- Unit 004's scale device status, disconnection watchdog and calibration state (`002-detect-disconnection-and-block-weighing`).
- Unit 005's OrgaTEX link state, its freshness window and the durable sync queue (`004-report-link-state`, `005-queue-writes-offline-and-sync-on-recovery`).
- Unit 006's print job state and the ticket's not-printed / reprint path (`002-print-ticket-and-track-job`, `003-reprint-ticket-with-reason`).
- Unit 002's scanner status and the scan-or-attest verification result (`002-verify-dyestuff-identity-by-scan-or-attestation`).
- Unit 003's session snapshot, zone and the health gate that blocks confirmation (FR-10).
- The locale bundle endpoint from unit 006 (story 005).

### Enables
- 003-confirm-weighing-and-advance
- 004-review-and-print-ticket
- 002-watch-live-weight-and-tolerance-zone

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The scale is silent but the previous reading was `0.0` | The readout shows no value and the age of the stream; a genuine zero reading and a missing reading are never indistinguishable (BRD FR-19, B-3). |
| The scale reconnects after a disconnection | The scale's entry returns to its connected state and the disconnection is no longer shown; the gap remains recorded on the device (BRD IR-13). |
| The scale disconnects mid-weighing, after some dyestuff has been dispensed | The session is not silently completed at the last known value; the operator is told the scale is gone and the confirm action is disabled with a reason (BRD FR-19, BRD FR-25). |
| The API is unreachable while the weight stream is still running | The terminal shows an explicit degraded state; a weight that is still arriving is not presented as live until the terminal can verify the stream's freshness (B-8, NFR-1). |
| The link is `DEGRADED` and the served snapshot is minutes old | The snapshot is served because it is within the configured freshness window, and it is marked with its age; the operator can judge it (BRD FR-32, BRD FR-33). |
| The link is `OFFLINE` and a posting has been queued | The posting is shown as pending, the un-synchronised count includes it, and it is never shown as posted (FR-20, BRD FR-31, BRD FR-32). |
| A queued posting has failed permanently | It stays visible as a failed entry with its last error and attempt count; it is not silently discarded and it can be re-driven (BRD FR-33, BRD NFR-03). |
| The scanner fails but the operator has already scanned a valid code for another component | The failed scan is reported and the affected step is not skipped; the attestation path is offered (BRD IR-15, BRD BR-11). |
| The operator attests after a scanner failure, then the scanner returns | The later successful scan supersedes the attestation and the recorded method becomes `SCAN`; the attestation is not silently deleted (FR-4, BRD BR-11). |
| The printer runs out of paper mid-batch, before any ticket exists | The printer's state appears in the status strip so the operator sees it before completing a batch; the completed weighings are unaffected (FR-19, BRD IR-16). |
| The locale changes while a degraded state is on screen | The status labels, failure reasons and disabled-action reasons re-render in the new language from the locale bundle, with no redeployment (FR-22, BRD NFR-11). |
| Two peripherals fail at once | Each failure gets its own entry and its own reason; no failure is collapsed into a single generic "error" state (FR-19). |
| The link recovers while a degraded view is open | The link state and the un-synchronised count update from the API; the client does not optimistically declare `LINKED` before the API reports it (BRD FR-19, BRD FR-32). |

## Out of Scope

- The scale's disconnection watchdog, its device status vocabulary and the calibration gate — unit 004 (`002-detect-disconnection-and-block-weighing`, BRD IR-13, BRD FR-12).
- The OrgaTEX link-state model, the freshness window and the durable sync queue — unit 005 (`004-report-link-state`, `005-queue-writes-offline-and-sync-on-recovery`).
- The print job lifecycle, the printer adapter and the reprint marking with its mandatory reason — unit 006 (`002-print-ticket-and-track-job`, `003-reprint-ticket-with-reason`).
- The scanner seam, the scanner's own status reporting and the attestation record — unit 002 (`002-verify-dyestuff-identity-by-scan-or-attestation`, FR-4).
- The weighing health gate, the zone and the confirmation rules — unit 003 (FR-9, FR-10).
- The live weight stream's origin and the reading sequence — unit 004 (`001-receive-live-weight-stream`, FR-8).
- The locale bundle's content and the translation workflow — unit 006 (story 005, FR-22).
- Operator identity, supervisor authentication and the audit trail — unit 008 (FR-18, FR-21).
