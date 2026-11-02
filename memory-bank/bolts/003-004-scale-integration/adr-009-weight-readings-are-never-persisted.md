---
bolt: 003-004-scale-integration
created: 2026-10-30T23:40:00Z
status: accepted
superseded_by: null
---

# ADR-009: Weight readings are never persisted, and the absence of a repository is the enforcement

## Context

This unit produces a continuous stream of weight readings — at least ten per
second, per device, for the whole time the station is running. That is
roughly 1.7 million readings per device per day.

The obvious thing to do with a stream of readings is to **keep them**. A
table of readings is easy to build, easy to query, and looks like the
responsible engineering choice: it gives history, it supports investigation
after an incident, and it means the data is there if someone needs it.

The unit brief says not to:

> **Readings are not persisted.** A weighing record captures the confirmed
> value (unit 003); the stream itself is ephemeral. Persisting every reading
> would be noise, and would risk a stale reading being read back as a live
> one — the exact confusion the disconnection rule exists to prevent.

And the story says the same thing, in the terms that matter:

> **Given** the device has sent no reading, **When** the stream is read,
> **Then** no reading is emitted at all — the absence of a reading is never
> represented as a reading whose value is zero.

The reason given — *"risk a stale reading being read back as a live one"* —
is the part that needs recording, because it is not obvious and it is the
reason the rule survives contact with a future developer who wants to add
history.

The danger is specific. The product has exactly one safety-critical
distinction:

> **"No reading" and "a reading of zero" must never be confused.**

`0.0` is a legitimate under-dose reading. If the operator is told to keep
pouring to reach 93.5 g, and the scale has actually gone silent, the
operator pours into a scale that is not there. Every rule in this unit —
the 2 s watchdog, the `LinkState` axis, the `WeightSnapshot` union — exists
to make that confusion impossible.

Persistence is what breaks it. Once readings are in a table, there is a
natural and very tempting query available:

```sql
SELECT value, received_at FROM scale_readings
WHERE scale_id = ? ORDER BY received_at DESC LIMIT 1
```

That query returns the **last reading ever written**. If the scale died an
hour ago, it returns the reading from an hour ago, and the caller — which
may not know the scale is dead — renders it as the current weight. The
value is stale, and nothing in the query says so. The `received_at` column
is right there, but a query that returns it does not force a caller to
*check* it.

The failure is silent, and it produces exactly the wrong number: a plausible
weight from a scale that is not there.

## Decision

**No reading is persisted. There is no reading table and no reading
repository.**

This is enforced **structurally**, not by convention:

1. The domain declares **no `ScaleReadingRepository`**. There is no
   interface to call, so there is nothing to accidentally call.
2. The persistence layer has **no `scale_readings` table**. There is no
   place to accidentally write one.
3. The `ScaleDevice` aggregate holds **only the last accepted reading**, in
   memory, and it is **overwritten** by the next one — not appended to.

The only way to persist a weight in this product is to **confirm** it, and a
confirmed weight is a *weighing record* — which belongs to unit `003`, is
written once per weighing rather than ten times per second, and is
immutable (BRD DR-02).

### The distinction, stated as a rule

> A **reading** is a live signal. It is not a record.
> A **record** is a confirmed value. It is written once and never changed.
>
> Only the second kind is persisted.

### What this costs, and where it goes instead

| Need | Where it is met |
|------|-----------------|
| "What did the scale say?" — now | The live stream. |
| "What did the scale say?" — during an incident | The **weighing record** (unit `003`) for the confirmed value, plus the **link history** for the disconnection gap, plus the **audit trail** (unit `006`) for the privileged actions. |
| "Show me the trend over the last hour" | Not available — and not required by any traced requirement. If it is ever required, it is a **new** requirement, and it is met by recording *confirmed* values, not by persisting the raw stream. |

The second row is the important one. Investigation is served by the
**durable facts** — the confirmed value, the disconnection gap, the audit
trail — and none of them require the raw stream. The raw stream is the
**least** valuable thing to keep for investigation, because it is
overwhelmingly redundant: at 10 Hz, 99.9% of the readings are superseded
within 100 ms.

### The link history is the exception, and it is not a reading

`scale_link_events` records **disconnections** — a start time, an end time,
and the sequence numbers either side of the gap. It records no weight.

This is deliberate. A disconnection gap says *"there was no reading between
these two times"*, which is exactly the durable fact that matters for
investigation, and it says it without recording a single quantity.

## Rationale

The alternative — persist readings, and make staleness explicit — was
seriously considered, because it is the answer that keeps the history and
fixes the dangerous part. It was rejected for three reasons.

**1. The guard is advisory, and the failure is silent.** Making staleness
explicit means every consumer must check `received_at` against a threshold
before using a reading. That check lives in **every consumer**, and a
consumer that omits it produces a plausible wrong weight with no error. The
structural approach removes the possibility instead of warning about it: if
there is no stored reading, no consumer can read a stale one, because there
is nothing to read.

**2. It invites exactly the query that causes the failure.** A readings
table makes the "latest reading" query the obvious one to write, and that
query is the bug. The alternative does not merely permit the failure — it
makes it the path of least resistance, and adds a freshness check to
compensate. A structure that cannot be misused beats a structure that must
be used carefully.

**3. The volume is real, and the value is not.** 1.7 million rows per
device per day, of which the overwhelming majority are superseded within
100 ms and are never read by anything. BRD DR-01's five-year retention
obligation applies to *records* — weighing records, compensations, overrides,
audit events. It does not apply to a live signal, and extending a retention
obligation to a signal would be a misreading of it.

The third reason is the weakest on its own, and it is listed third for that
reason. If the volume were small, the other two reasons would still decide
it. The volume is what makes the decision *comfortable* rather than
*merely correct*.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **No persistence; no repository** (adopted) | Staleness is impossible by construction; the "latest reading" query does not exist; the volume is never written | No raw history for later analysis | The durable facts that investigation actually needs are recorded elsewhere. The raw stream is the least valuable thing to keep |
| **Persist readings; require a freshness check on read** | Keeps history; the raw stream becomes available for analysis | The guard is advisory and lives in every consumer; the "latest reading" query remains the path of least resistance and is exactly the bug; the freshness threshold is a second magic number that can be wrong | Makes the failure *possible with care* rather than impossible. The guard's correctness becomes a permanent burden on every future consumer |
| **Persist readings; store them with an explicit `stale` flag updated by the watchdog** | Makes staleness explicit in the data | The flag is a **mutable** fact on a high-write table; it is wrong for the window between the scale dying and the watchdog noticing; it turns the hot path into a write | Reintroduces the confusion it aims to prevent, in the window that matters. A flag that is briefly wrong is worse than no flag, because it looks authoritative |
| **Persist only the last reading per device, updated in place** | Small table; "current weight" is a single row read | Still a stale reading readable after the scale dies; the table is still a place to accidentally read a stale value from | Keeps the failure and most of the cost |
| **Persist readings to a separate time-series store or log file** | Does not pollute the transactional database | The stale reading is still readable, and is now harder to reason about because it lives outside the app's data model | Relocation is not removal. The failure mode is identical |

## Consequences

### Positive

- **A stale reading cannot be read back as a live one.** Not "should not" —
  cannot. There is no stored reading to read.
- The hot path has **no writes at all**. The stream is a read-and-broadcast
  path, which is what lets it sustain 10 Hz per device without competing with
  the database for I/O.
- The "no reading" / "reading of zero" distinction is preserved **all the
  way to the UI**, because the UI is never handed a value that might be old.
- The database stays small enough to be trivially backed up.

### Negative

- **Raw measurement history is unavailable.** If someone later asks for "the
  weight trace for batch B-24187", it cannot be reconstructed from this
  unit. It must come from the weighing records, which hold confirmed values
  only.
- A future unit cannot build a "weight history" screen on this data. This is
  a real product limitation, and the honest way to handle it is to treat a
  request for it as a **new requirement** — not to quietly backfill a
  readings table.
- The rule has to be **restated** to every future developer who wants
  history, which is exactly why this ADR exists.

### Risks

- **A future bolt adds a readings table** for debugging or reporting.
  *Mitigation*: this ADR is in the decision index with a "Read when" field
  that names the scenario. The absence of the repository interface is the
  structural answer — the table would have to be invented deliberately
  rather than added by copying a pattern from a neighbouring unit.
- **A developer concludes that "no persistence" means "no diagnostics".**
  *Mitigation*: the table above names the durable facts that exist and
  where each one lives. The disconnection gap, the confirmed weighing
  record and the audit trail are the diagnostic story.

## Related

- **Stories**: 001-receive-live-weight-stream, 002-detect-disconnection-and-block-weighing
- **Requirements**: FR-8, FRD FR-19, BRD IR-10, BRD IR-13, BRD IR-19
- **Standards**: `standards/tech-stack.md` § Database — the *readings are not
  persisted* rule; `units/004-scale-integration/unit-brief.md` § Data Storage
- **Previous ADRs**: ADR-006 (the same "separate append-only record" reasoning
  applied to the identity unit's authorisation consumption)
