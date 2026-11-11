---
bolt: 032-003-weighing-station
created: 2026-11-11T13:20:00Z
status: accepted
---

# ADR-048: The weighing record snapshots its tare, and old records are not back-filled

## Context

ADR-035 (bolt 012) records the tare on the container assignment *"because
the weighing record carries it"*. The record never did: it carried the
container id (since bolt 031) but not the tare. The workbook's Step 25 lists
the tare among the facts a confirmed weighing must record, and BRD BR-14
requires that a past batch can be reconstructed exactly.

Reading the tare back from the assignment means matching an assignment to a
weighing by component id and time. Component ids recur across batches, so
that match is fragile.

## Decision

**The weighing record carries the tare that applied to it, copied at
confirmation from this session's container assignment.**

1. `WeighingRecord.tare: RecordedTare | null`: the weight (value and unit)
   and the source (`CONTAINER_MASTER` or `WEIGHED_EMPTY_CONTAINER`).
2. **The container and the tare are read in one call** and written
   together. Both present, or both null.
3. **No container, no tare.** The device's own zero is not a recorded tare
   (ADR-015).
4. **Old records are not back-filled.** Migration `037` adds nullable
   columns; records written before it read `tare: null`.
5. **The pairing is enforced in the application,** not by a table CHECK.

## Rationale

- **Snapshot, not reference.** A record must not be a function of when it
  is read (ADR-045). A reference to the assignment would change meaning if
  the assignment's rules changed; a copy does not.
- **No back-fill.** A back-fill would run the fragile join this ADR exists
  to avoid, and would write into an append-only table. `null` is the truth
  for those rows: they recorded no tare.
- **Pairing in code.** SQLite cannot add a table-level CHECK to an existing
  table without rebuilding it, and rebuilding means copying an append-only
  table. The use case's single read makes the pairing structural, and a
  test pins it.

## Consequences

- **Positive:** all eight of the workbook's Step 25 fields are on one row; a
  weighing is reconstructable from its own record; ADR-035's statement is
  now true.
- **Negative:** the tare is stored twice (assignment and record). That is
  intended: the assignment is the act of taring, the record is what the
  weighing used.
- **Risk:** a future agent back-fills old rows "to complete the data".
  Mitigation: this ADR and the decision index.

## Related

- **Stories:** `004-gate-confirmation-on-zone`
- **Requirements:** BRD FR-11, FR-25, BR-11, BR-14, DR-02
- **Previous ADRs:** ADR-035 (the tare is recorded on the assignment); ADR-015
  (the device's zero is not persisted); ADR-040 (the record is written
  before the progression); ADR-045 (a record is not a function of when it is
  read)
