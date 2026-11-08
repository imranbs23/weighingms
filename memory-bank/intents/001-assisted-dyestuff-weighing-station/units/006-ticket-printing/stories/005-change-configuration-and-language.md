---
id: 005-change-configuration-and-language
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 005-change-configuration-and-language

## User Story

**As a** dyehouse supervisor
**I want** to change the station's scale thresholds, tolerance overrides, label template and interface language at runtime
**So that** the station can be reconfigured for a new label or a second site without a redeployment

## Acceptance Criteria

- [ ] **Given** a valid change to a scale threshold, a tolerance override, the label template or the operator language, **When** the change is applied, **Then** the new value is in effect for subsequent operations without a rebuild, a redeployment or a restart (BRD FR-22, BRD NFR-14).
- [ ] **Given** a configuration change, **When** it is applied, **Then** an audit entry is written carrying the actor, the actor's role, the configuration key changed, the previous value, the new value and the reason (BRD FR-21, BRD FR-22, BRD FR-36).
- [ ] **Given** a tolerance override, **When** it is applied, **Then** the overridden value and the reason are recorded alongside the original value, the original value is retained and not erased, and the override is visible on the weighing records it affects (BRD FR-22, BRD FR-18).
- [ ] **Given** the operator language is changed, **When** an operator-facing string is requested afterwards, **Then** it is returned in the newly configured language from a locale bundle fetched at runtime (BRD FR-22, BRD FR-37, BRD NFR-11).
- [ ] **Given** the configured locale bundle is missing a string, **When** that string is requested, **Then** a defined fallback is used and no request fails (BRD FR-22, NFR-7).
- [ ] **Given** the effective configuration is read, **When** it is returned, **Then** every entry carries its key, value, category, update time, updating actor and version (BRD FR-22).

## Technical Notes

- **A configuration change is itself audited.** A tolerance override that is not attributable has changed the meaning of the weighings around it, so `setConfiguration` writes through the same append-only audit API as every other privileged action.
- **An override must not launder a weighing.** This is the sharp edge of the configuration store and it is deliberate: a tolerance override is ultimately a way to make an out-of-tolerance weight acceptable. Therefore:
  - the override records **what it overrode** (key, component or scope, original value) and **why** (reason);
  - the **original value is retained**, not overwritten in place;
  - the override is **visible on the weighing record itself**, not only in a settings screen, so a reader of the weighing can see that an override applied;
  - the version history of each key is kept, so the effective value at any past moment can be reconstructed.
- Configuration values that change what a weighing means are stored with a version and an effective-from point, so a weighing is always evaluated against the configuration in force when it was taken.
- Locale bundles are JSON resources loaded at runtime and cached, **not embedded at build time** — that is what makes a language changeable without a redeployment (BRD NFR-11, BRD NFR-14). A bundle added later is picked up without a rebuild.
- Scale thresholds and tolerance rules originate in OrgaTEX (A-07); a configuration override in WeighingMS records a local override of that upstream value and names the upstream value it overrode.
- The label template is a configuration value (BRD IR-16), consistent with the ticket format not being invented — Q-11 remains open, so no story may assert a specific physical layout as fact.
- The configuration key set is not closed by any requirement beyond the four named categories; new keys must be added with a category and a type, not hard-coded into call sites.

## Dependencies

### Requires
- 004-record-and-export-audit-trail (the append-only audit API).

### Enables
- 001-generate-weighing-ticket (the configured label template).
- 006-report-on-tolerance-failures-and-overrides (the override values reported).
- Unit 007 story 001 and story 005 (the configured locale bundles and the settings screen).

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| A configuration write is interrupted by power loss | Either the previous version or the new version is in effect, never a partially written value; the audit entry and the version record agree. |
| The configured language is changed mid-session | Strings requested after the change are served in the new language; no redeployment and no restart. |
| A locale bundle is missing a key present in another bundle | The defined fallback is used for that key; the rest of the bundle is served normally. |
| Two supervisors change the same key concurrently | The later write wins and both changes are audited with their own actors, reasons and versions; no change is lost from the audit trail. |
| A tolerance override is removed | The original value is restored as effective, and the removal is itself audited with a reason. |
| An override is applied to a scope that does not exist | The change is refused with a visible reason; no value is changed and no effective-version bump occurs. |

## Out of Scope

- Deciding the actual tolerance model — OrgaTEX owns tolerances (A-07, Q-05).
- The scale-selection threshold rule itself — unit 003 (Q-04).
- The ticket's physical layout and content — Q-11, Q-12, AC-10.
- The settings screen — unit 007.
