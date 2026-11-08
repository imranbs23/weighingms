---
bolt: 018-003-weighing-station
created: 2026-11-06T06:10:00Z
status: accepted
---

# ADR-041: The total is summed in kilograms, and the write-back's outcome does not gate the completion

## Context

Bolt `018` produces the batch's completion summary. Two of its decisions are
genuinely open, and both are the kind that are decided by accident and then
lived with.

**The first: the total dispensed.** The recipe mixes units — the dyestuffs
are in grams, the auxiliaries in kilograms — so the total is a sum across
two units. The story is explicit about the arithmetic:

> *"the total dispensed is computed in fixed-point decimal with units
> converted and summed correctly — grams and kilograms are added as one
> quantity, never by concatenating display strings"*

and gives the worked example: **`500.0 g` + `24.000 kg` = `24.500 kg`**.

**The second: the write-back's relationship to the completion.** The story
says the write-back is performed on completion, and it is idempotent
(BRD IR-08, C-14). And it says:

> *"Weighing continues when OrgaTEX is unreachable; unsynchronised records
> are queued and transmitted on reconnection, and the summary reflects that
> the write-back is pending. A pending write-back does not un-complete the
> batch."*

**And the ticket is out of scope** — the summary states the release and
names the machine; unit `006` prints the ticket.

**And unit `005` already owns the whole write path** — the
`ConsumptionPostingService` with its idempotency ledger, and the
`BatchStatusWriteService` with its precondition that every one of the
batch's postings must be resolved before `WEIGHED` is written.

## Decision

**The total is summed in KILOGRAMS, in the domain, in fixed-point decimal
— and the write-back's outcome does not gate the completion.**

1. **The total's unit is kilograms**, and every confirmed record's
   quantity is **converted into it** before it is summed. The conversion
   is **exact** — `decimal.js`, never a float division.

2. **The summation happens in ONE unit.** The grams are converted
   **before** they are added — never concatenated, never added as strings,
   never added as floats.

3. **The write-back is unit `005`'s**, called through a port the services
   satisfy structurally. This bolt re-implements **no** guard.

4. **The completion is recorded, and the write-back is driven after it.**
   The write-back's outcome — `CONFIRMED`, `PENDING` or `FAILED` — is
   **reported** and **never** prevents or undoes the completion.

5. **The summary is COMPUTED, not stored.** It is a projection of the
   immutable records.

## Rationale

### Why kilograms

**Because the recipe's auxiliaries are the large quantities and the
dyestuffs the small ones, and a kilogram total is the one an operator
reads at the end of a batch.**

Look at the numbers the recipe actually holds:

| Component | Target | Unit |
|---|---|---|
| DYE-4471-B | 1240.0000 | **g** |
| DYE-2204-R | 386.0000 | **g** |
| DYE-4471-Y | 94.0000 | **g** |
| AUX-0101 | 24.0000 | **kg** |
| AUX-0107 | 9.6000 | **kg** |

The **dyestuffs** total 1720 g and the **auxiliaries** total 33.6 kg. So
expressed in kilograms the batch is about **35.32 kg**, and expressed in
grams it is about **35320 g** — and the gram figure is the odd one: it
makes the two-kilogram dyestuff look like a rounding error and the
thirty-kilogram auxiliaries look like they have digits of noise.

**But the real reason is not aesthetic.** It is that **the story's own
worked example reports kilograms** — `500.0 g` + `24.000 kg` =
`24.500 kg`. The requirement is written in the unit the answer is expected
in, and the answer should match the requirement.

**And the alternative — reporting in grams — would be the sum's own
arithmetic with the display precision dropped.** There is no precision
argument for grams; the conversion is exact either way.

### Why the conversion happens BEFORE the sum, and why it is exact

**Because summing across units is not a thing you can do, and every
workaround for it is a bug waiting to happen.**

The three ways to "sum" grams and kilograms:

```ts
// WRONG — string concatenation. "500.0" + "24.000" = "24.000500.0"
const total = records.map((r) => r.quantity.text).join('');

// WRONG — float addition. 0.5 + 24 gives 24.5, but the *displayed*
// values do not, and 0.1 + 0.2 gives 0.30000000000000004.
const total = records.reduce((sum, r) => sum + parseFloat(r.quantity.text), 0);

// RIGHT — convert, then add, in fixed-point decimal.
const total = records.reduce(
  (sum, r) => sum.plus(new Decimal(convert(r.quantity, 'kg'))),
  new Decimal(0),
);
```

**The string version is what the story's wording warns against by name**
— *"never by concatenating display strings"* — and it is not a
theoretical mistake. A summary is the one place a UI is *tempted* to
concatenate, because the display strings already exist and look right.

**And the float version is the one that NFR-16 forbids everywhere else.**
Every other quantity in this product is a decimal string for a reason —
`500.0 g` in a float is `500`, and `0.1 kg` in a float is
`0.1000000000000000055511151231257827`. The conversion must be exact:
**`0.5 kg` is `500 g`, not `499.9999999 g`.** A fraction of a gram that
nobody would see and everybody would inherit.

**And converting BEFORE the sum — rather than converting the sum — is what
makes the result independent of the order.** If each quantity is converted
first, then every addition is between two quantities in the same unit, and
the intermediate sums are exact at every step. Converting after the sum
would mean summing incompatible quantities first, which is the error.

### Why the write-back does NOT gate the completion

**Because the material is weighed and in the container whether or not the
MES heard about it — and a rule that says otherwise would let a broken
network stop a dyehouse.**

Think about what "the batch is complete" means physically: the operator
has dispensed every component, the material is in the container, and the
container is on its way to the machine. **None of that depends on the MES.**

**And the story is unambiguous:**

> *"A pending write-back does not un-complete the batch."*

> *"OrgaTEX is unreachable at completion → the batch completes; the
> write-back is queued and the summary shows the write-back as pending, not
> confirmed."*

**And the MES's own copy catches up.** Unit `005`'s sync queue holds the
posting and delivers it when the link returns (BRD FR-20, FR-30, FR-31,
NFR-03). So the write-back is **eventually** consistent by design, and the
only question the summary has to answer is *"did the MES confirm it yet?"*

**And this is the same shape as ADR-018's principle** — a refusal or an
unreachable MES is a **value**, not an error, and it is reported
faithfully. Here it is stronger still: the unreachable MES does not even
change the batch's state.

**The alternative — gating the completion on the write-back — would be
worse in three ways at once:**

1. **It would stop the dyehouse.** A network fault would prevent the
   operator from finishing a batch.
2. **It would lose the completion.** The weighing is done; the record is
   written; but the batch would show as incomplete, and the container would
   sit there with no release.
3. **It would be a second answer to a question unit `005` already
   answers.** Unit `005`'s `BatchStatusWriteService` already refuses to
   write `WEIGHED` while a posting is unresolved — *"the batch weighing
   status advances to `WEIGHED` only when the batch's postings are all
   resolved"*. So the station already knows the right answer: **the status
   write waits; the batch does not.**

### Why this bolt calls unit 005's services rather than implementing the write path

**Because unit 005's ADRs are a record of every way an idempotent posting
can go wrong — and each of those failures is silent.**

Unit `005` settled, in its own ADRs:

| Unit 005's decision | The failure it prevents |
|---|---|
| The **idempotency ledger**'s PRIMARY KEY is the atomic guard | A check-then-write that admits a double-post under concurrency |
| The key is **derived** from the weighing's identity | A client that could choose the key could collide with another weighing's and suppress it |
| The **enqueue guard** is separate from the send guard | Two queue entries for one weighing, when the link is down |
| The batch status write has a **precondition** | A batch advancing to `WEIGHED` while a component's consumption is unresolved |
| The **schema** has no `operatorId` and no `idempotencyKey` | A privilege escalation, and a client-chosen key |

**Now consider a "reasonable" re-implementation of the write-back in this
bolt.** The author reads the story — *"post the consumptions, advance the
status, make it idempotent"* — and writes:

```ts
const posted = new Set<string>();
for (const record of records) {
  if (posted.has(record.id)) continue;   // ← the idempotency check
  await adapter.postConsumption({ ... });
  posted.add(record.id);
}
```

**That code is correct in every branch** — and it is a **compliance
regression**, because:

- the guard is an **in-memory `Set`**, so it does not survive a restart,
  and the station **is** restarted (NFR-06);
- it is not atomic, so two concurrent completions would both post;
- it re-implements the key derivation, and a second derivation is a second
  answer to "what is this weighing's key?";
- and it would post the operator id from the session into a body whose
  schema deliberately has **no** such field.

**And every test in this bolt would pass.**

So the rule is the same one ADR-039 set for the authorisation: **this bolt
calls `post` and `advanceToWeighed` and re-implements nothing.** The
ledger is the atomic guard, and it is unit 005's.

### Why the summary is computed and not stored

**Because a stored summary is a second thing to keep in step with the
records — and the records are the truth.**

The records are immutable (BRD DR-02, C-12) and retained ≥ 5 years
(BRD DR-01). A stored summary would be a **copy** of a fact that the
records already state, and it would have to be invalidated whenever a
record were corrected — and corrections are new records referencing the
original.

**And the summary is read rarely.** It is produced once, at completion, and
shown once. There is nothing to be gained by caching it and a great deal
to be lost in the invalidation.

## Consequences

### Positive

- **The total is correct** — converted before it is summed, in fixed-point,
  in one unit, and exact.
- **The summary is a projection**, so it cannot disagree with the records.
- **The write-back's idempotency is unit 005's ledger** — atomic,
  restart-safe, and exhaustively tested there.
- **A broken network cannot stop the dyehouse** — the batch completes and
  the write-back is queued.
- **The verdict is a usable quality signal** — an authorised override makes
  it `NO`, because the record carries the over-dose zone.

### Negative

- **The summary's unit is fixed at kilograms**, so a batch of only grams
  is reported in kilograms. That is the story's own example, and the
  conversion is exact, so the number is right — but it is a choice, and it
  is recorded here.
- **The completion depends on unit 005's services** for the write-back's
  outcome. A defect there surfaces here — and that is **correct**: the
  defect is found by one suite rather than two, and fixed in one place.
- **The summary cannot be produced without the records**, so it needs the
  session's history rather than a snapshot. That is the point.

### Risks

- **A future agent changes the total's unit to grams** "because the
  dyestuffs are in grams". *Mitigation*: the decision index's "Read when"
  points here; the story's worked example is in kilograms, and the
  auxiliaries dominate the mass.
- **A future agent gates the completion on the write-back** "so the MES
  knows before the container moves". *Mitigation*: the same index entry;
  the story says a pending write-back does not un-complete the batch, and
  unit 005's own precondition already handles the status write.
- **A future agent re-implements the idempotency guard** as an in-memory
  set, "just for the completion". *Mitigation*: the same index entry; it
  does not survive a restart, and ADR-039's rule applies to every
  privileged write in this product.

## Related

- **Stories**: `009-complete-batch-and-summarise`
- **Requirements**: FR-15, FR-16, FR-17, FR-26, FR-29, FR-30, FR-31 ·
  BRD AC-08, BRD IR-08, IR-09, IR-13 · NFR-03, NFR-16 · C-11, C-12, C-13,
  C-14
- **Previous ADRs**: ADR-039 (this bolt implements no authorisation
  mechanism — the same rule applied to the write path); ADR-040 (the
  record is written before the progression — the record this summary
  reads); ADR-023 (unit 005's idempotency ledger is the atomic guard — the
  guard this bolt calls and does not re-implement); ADR-034 (the station's
  own facts are durable and a record is immutable — the records the
  summary reads); ADR-018 (a refusal is a value, not an error — the same
  discipline, applied to the write-back's outcome)
- **Standards**: `standards/tech-stack.md` § "Database" — append-only rows
  for acts, and fixed-point decimal for every quantity
