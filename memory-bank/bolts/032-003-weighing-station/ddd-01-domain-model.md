---
stage: model
bolt: 032-003-weighing-station
created: 2026-11-11T13:05:00Z
---

## Static Model: 003-weighing-station (bolt 032)

### The gap this models

The workbook's Step 25 lists what a confirmed weighing must record:
actual weight, operator, component, lot, container, **tare**, scale,
timestamp. Since bolt 031 the record carries all of them **except the
tare**. The tare exists, on unit 002's container assignment, but ADR-035
says the assignment keeps it *"because the weighing record carries it"*,
and the record does not.

Reconstructing a past weighing (BRD BR-14) from the assignment means
joining by component id and time window. Component ids recur across
batches, so that join is fragile. The record must say what tare applied.

### Value object

| Value object | Shape | Rule |
|---|---|---|
| **RecordedTare** (new) | `weight: WeightValue` + `source: CONTAINER_MASTER \| WEIGHED_EMPTY_CONTAINER` | The tare of the container assigned in **this session**, as unit 002 recorded it. Snapshotted at confirmation. |

### Entity

**WeighingRecord** (bolt 017, extended). Gains `tare: RecordedTare | null`.
`actualQuantity` stays **net of the tare**, unchanged.

### Invariants

1. **Container and tare come together.** Both are taken from the same
   assignment: both present, or both null. A record never carries a
   container without its tare, or a tare without a container.
2. **Never invented.** With no container assigned in this session, the
   tare is null. The device's own zero (a re-tare) is not a recorded tare:
   it is not persisted, by design (ADR-015).
3. **Snapshotted.** The tare is copied at confirmation. A later change to
   the container master does not change a past record.
4. **Append-only stays true.** Existing records gain a null tare; nothing
   is updated, and the table's no-update and no-delete triggers stay.
5. **The client never supplies it.** It is read from unit 002 by the
   station, like the lot and the container (ADR-035: the client may not
   supply the tare value or its source).

### Out of scope

- Showing the tare on the completion detail or the printed ticket (unit
  006's ticket lines). The weigh view already shows it (bolt 031).
- Changing how a tare is established (bolt 012).
