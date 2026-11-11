---
stage: design
bolt: 032-003-weighing-station
created: 2026-11-11T13:15:00Z
---

## Technical Design: 003-weighing-station (bolt 032)

### Layer by layer

| Layer | File | Change |
|---|---|---|
| Domain | `domain/value-objects/recorded-tare.ts` (new) | `RecordedTare { weight: WeightValue; source: 'CONTAINER_MASTER' \| 'WEIGHED_EMPTY_CONTAINER' }`, with a guard for the source. |
| Domain | `domain/entities/weighing-record.ts` | New trailing constructor parameter `tare: RecordedTare \| null = null`, after `correctsRecordId`. The six existing constructions keep compiling and mean "no tare". |
| Application | `application/use-cases/confirm-component.ts` | The two reads `lotNumber()` and `containerId()` become **one**: `captures(): Promise<{ lotNumber, containerId, tare }>`. Container and tare come from the same answer, so model invariant 1 holds by construction. |
| Infrastructure | `infrastructure/composition-root.ts` | `captures` is built from `activeCaptures()` (bolt 031's this-session rule): `tare = container === null ? null : { weight: WeightValue.of(tareWeight, tareUnit), source: tareSource }`. |
| Infrastructure | `infrastructure/persistence/record-database.ts` | Migration **`037-weighing-records-carry-tare`**: `ALTER TABLE weighing_records ADD COLUMN tare_weight TEXT NULL`, `tare_unit TEXT NULL`, `tare_source TEXT NULL CHECK (tare_source IS NULL OR tare_source IN ('CONTAINER_MASTER','WEIGHED_EMPTY_CONTAINER'))`. |
| Infrastructure | `sqlite-weighing-record-repository.ts` | Insert and read the three columns. A row with no tare reads back as `null`. |
| Presentation | `presentation/controllers/session-controller.ts` | `serialiseRecord` adds `tare: { weight, unit, source } \| null`. Every quantity stays a string (NFR-16). |

No new endpoint. The confirm response and every reader of the record
(ticket, report, batch summary) get the new field. Those that ignore it are
unaffected.

### The migration, and the append-only table

`ALTER TABLE … ADD COLUMN` adds nullable columns without rewriting a row, so
the table's no-update and no-delete triggers are untouched and every
existing record reads back with `tare: null`. That is the truth: those
weighings recorded no tare. Nothing is back-filled from the assignments,
because the join that would do it is the fragile one this bolt removes.

The pairing rule (container ⇔ tare) is enforced in the application,
because SQLite cannot add a table-level CHECK to an existing table without
rebuilding it, and a rebuild would mean copying an append-only table.

### Failure behaviour

| Case | Result |
|---|---|
| No container assigned in this session | `containerId` null, `tare` null |
| Container assigned in an earlier session only | Both null (bolt 031's rule) |
| Container weighed empty (`D-03`, `D-05`) | `tare.source = WEIGHED_EMPTY_CONTAINER`, the measured weight |
| Unit 002 unreadable at confirmation | The confirmation fails as any record write would; nothing is written (ADR-040 order unchanged) |

### Tests (Stage 5)

- **Unit:** `RecordedTare` source guard; the record round-trips a tare and a
  null tare through SQLite; an old row (written before the migration) reads
  back with `tare: null`.
- **Integration:** confirm with `C-09` → `tare {214.0000, g, CONTAINER_MASTER}`;
  without a container → `tare: null`; an earlier session's container → both
  null.
- **E2E / evidence:** the Step 25 capture writes `STEP-25-transaction.json`
  from the confirm response, all eight workbook fields on the record itself.
