---
bolt: 022-006-ticket-printing
created: 2026-11-06T15:30:00Z
status: accepted
---

# ADR-045: The configuration is VERSIONED, and an override is APPENDED to the weighing record — never substituted into it

## Context

Bolt `022` adds the configuration store: the scale thresholds, the
tolerance overrides, the label template and the operator language.

**The story says plainly that this store has a sharp edge:**

> *"An override must not launder a weighing. This is the sharp edge of the
> configuration store and it is deliberate: a tolerance override is
> ultimately a way to make an out-of-tolerance weight acceptable."*

**And it gives four rules that follow from that:**

1. the override records **what it overrode** (key, component or scope,
   original value) and **why** (reason);
2. the **original value is retained**, not overwritten in place;
3. the override is **visible on the weighing record itself**, not only in
   a settings screen;
4. **the version history of each key is kept**, so the effective value at
> any past moment can be reconstructed.

**And there is a second rule that reaches further:**

> *"Configuration values that change what a weighing means are stored with
> a version and an effective-from point, so a weighing is always evaluated
> against the configuration in force when it was taken."*

**And a third, about concurrency:**

> *"Two supervisors change the same key concurrently → The later write wins
> and **both changes are audited** with their own actors, reasons and
> versions; **no change is lost from the audit trail**."*

**And the configuration change is itself audited** — through the
append-only API bolt `020` built.

## Decision

**The configuration is VERSIONED and append-only, and an override is
APPENDED to the weighing record — never substituted into it.**

1. **Every change is a new VERSION.** The history is append-only; the
   effective value is a **projection** of it.

2. **The version is assigned per key, atomically**, by a `UNIQUE (key,
   version)` constraint — and the version write and its audit entry are in
   **ONE transaction**, so they always agree.

3. **The original value is RETAINED** — in the history's `previous_value`,
   and in the version that restored it when the override was removed.

4. **The override is APPENDED to the weighing record** as a single
   nullable field carrying the key, the scope, the original value, the new
   value and the reason. **The record's quantity, zone and timestamp are
   untouched.**

5. **The effective value is a function of TIME** — the newest version
   whose `effective_from` is at or before the moment asked about.

6. **A change requires a REASON**, and a refusal bumps **no** version.

7. **Two concurrent changes**: the later write wins the effective value,
   and **both** are audited.

8. **The locale bundle is a FILE, read at runtime and cached** — and the
   fallback is **per key**, to a **defined** default locale.

## Rationale

### Why the store is VERSIONED, and not a mutable key-value table

**Because a configuration value is not a setting — it is a statement about
what a weighing MEANT, and a mutable row would erase the history of every
statement the station has ever made.**

Consider the obvious implementation: a `settings` table with
`(key, value, updated_at)`, updated in place.

**And then the dispute arrives.** A shade failure six weeks ago: the
weighing was 3% over tolerance, and the operator says the tolerance was
different that day. The station is asked to settle it. And the settings
table says the tolerance is whatever it is **now** — because the value
that was in force that day was **overwritten** by a change nobody
remembered.

**So the mutable table cannot answer the question the trail exists to
answer.** And the story is explicit:

> *"the version history of each key is kept, so **the effective value at
> any past moment can be reconstructed**."*

**And "in force when it was taken" is not a nicety — it is the rule that
makes a weighing mean anything.** A weighing evaluated against today's
tolerance, when it was taken against yesterday's, is not a weighing. It is
a number compared with the wrong band.

**So the history is the truth and the effective value is a projection of
it.** And the projection is a **projection** — it can be rebuilt from the
history, and a trigger refuses to let it drift.

### Why the version is PER KEY, and why it needs a constraint

**Because the trail's global sequence does not fit — and because the
concurrency rule demands an atomic guard.**

The audit trail's `AUTOINCREMENT` is a **global** counter (bolt `021`),
because the trail is one ordered whole. **But a configuration key's version
is per key** — `tolerance.pct.dye` at version 3 says nothing about
`template.id` at version 3, and their versions must be independent.

**And the story's concurrency rule is precise:** *"the later write wins and
**both** changes are audited with their own actors, reasons and
versions."*

**So two concurrent changes to one key must get two DISTINCT versions** —
and "distinct" has to be guaranteed, not hoped for:

```ts
// WRONG — racy. Two concurrent changes read the same V and both write V+1.
const version = (await currentVersion(key)) + 1;
await insertVersion(key, version, ...);
```

**So the `UNIQUE (config_key, version)` is the guard.** Two concurrent
writes both attempt `V + 1`; one wins the insert, the other **loses it** —
so its write fails, it retries, and it becomes `V + 2`. **The versions
never collide**, and the later write wins the effective value, which is
exactly the story's rule.

**And the version write and its audit entry are in ONE transaction** —
because the story's power-loss edge case demands it:

> *"Either the previous version or the new version is in effect, never a
> partially written value; **the audit entry and the version record
> agree**."*

A version without its audit entry would be a change nobody is accountable
for. **And an audit entry without its version** would be an attribution
for a change that is not in the history. The transaction makes them one
fact.

### Why the override is APPENDED to the weighing record, and not SUBSTITUTED

**Because the rule is about what a reader of the weighing can SEE — and a
substitution would corrupt the very fact the record exists to preserve.**

The story's third rule is about **visibility**: *"the override is visible
on the weighing record itself, not only in a settings screen, so a reader
of the weighing can see that an override applied."*

**So the record must carry it.** And that is a **write to unit `003`'s
record** — which is a deliberate exception to this unit's usual read-only
relationship with unit `003`.

**And it is safe because it is APPENDED.** The record's quantity, zone and
timestamp are untouched; the override is **additional evidence about how
the weighing was judged**. So:

- the record's **immutability** holds in the sense BRD DR-02 requires — a
  fact about **the weighing** is not revised;
- the record gains a fact about **the judgement** that was applied to it.

**And the alternative — reading the configuration at read time — is
exactly the thing the versioning exists to prevent.** A record that
rendered "tolerance: ±2%" by looking up *today's* value would be a record
that changes its own meaning over time. **A record must not be a
function of when you read it.**

**And a single nullable field, not a row per override.** A weighing had
**one** effective configuration when it was taken — so there is one
override to show, and the *versions* carry the history of the setting
itself. A row per override would be a second history, and it would have to
agree with the first.

### Why a refusal bumps NO version

**Because the version is the key's HISTORY, and a version that records
nothing is a hole in it.**

The story's edge case: *"An override is applied to a scope that does not
exist → The change is refused with a visible reason; **no value is changed
and no effective-version bump occurs**."*

**"No effective-version bump" is explicit** — and it matters more than it
looks. A version that consumed a number without recording a change would
mean the history reads `1, 2, 4` — and a reader reconstructing the
effective value would have to wonder what happened to version 3.

**So the validation happens BEFORE the version is assigned.** The scope is
checked, the reason is checked, and only then does the version exist.

### Why BOTH concurrent changes are audited

**Because the trail losing a supervisor's change would lose their REASON
with it — and the reason is the whole point.**

The story says: *"the later write wins and **both changes are audited**
with their own actors, reasons and versions; **no change is lost from the
audit trail**."*

**And the asymmetry is the point.** The **effective value** is
last-write-wins, because there is only one value in force and the later
one is the truth. **But the trail is not last-write-wins** — it is a
record of what people did, and two people did two things.

**So a store that kept one audit entry per key would lose a supervisor's
change entirely** — and the reason they gave for it would vanish with it.
**And the trail is the product's answer to "who changed this, when, and
why".** A change that is not in the trail did not happen, as far as the
product is concerned.

### Why the locale bundle is a FILE, and the fallback is PER KEY

**Because "not embedded at build time" is the requirement, and the
fallback's shape follows from the edge case.**

The story: *"Locale bundles are JSON resources loaded at runtime and
cached, **not embedded at build time** — that is what makes a language
changeable without a redeployment."*

**And the edge case is precise:** *"A locale bundle is missing a key
present in another bundle → **the defined fallback is used for that key;
the rest of the bundle is served normally**."*

**So the fallback is PER KEY, not per bundle.** A bundle missing one
string does **not** fall back to another bundle wholesale — that key
falls back, and the rest of the configured bundle is served normally.

**And the fallback must be DEFINED**, which is why the default locale's
bundle is **complete** and loaded eagerly: it must be available even when
the configured bundle lacks a key.

**And the last fallback is the key itself.** A key missing from *both*
bundles returns the key — **not** an error, and not `undefined`. The story
requires *"a defined fallback is used and **no request fails**"*, and a
string showing the key is a defined, diagnosable answer.

## Consequences

### Positive

- **A dispute six weeks old can be settled** — the effective value at that
  moment is reconstructable.
- **A weighing's meaning is frozen** — it is evaluated against the
  configuration in force when it was taken.
- **The versions never collide**, and the later write wins.
- **A version and its audit entry always agree** — one transaction.
- **A reader of the weighing can see that an override applied**, without
  opening a settings screen.
- **A language changes without a redeployment**, and a missing string
  never fails a request.

### Negative

- **The configuration table grows without bound.** Every version of every
  key is kept forever — which is the point, and it is bounded by the
  number of *changes*, not by the number of keys.
- **The effective value is a projection**, so there is a second thing to
  keep in step with the history. The trigger that refuses a projection
  pointing at a non-existent version is what holds them together.
- **The weighing record gains a nullable column** — a write to another
  unit's table, and a deliberate exception.
- **The default bundle must be COMPLETE**, and someone must keep it
  complete. A missing default key degrades to the key name — visible, but
  not ideal.

### Risks

- **A future agent makes the configuration a mutable key-value table.**
  *Mitigation*: the decision index's "Read when" points here; the past
  becomes unreconstructable, and a dispute about a weighing cannot be
  settled.
- **A future agent reads the configuration at RENDER time** to show a
  weighing's tolerance. *Mitigation*: the same index entry; a record must
  not be a function of when you read it — the override is **appended** to
  the record for exactly this reason.
- **A future agent writes the audit entry outside the version's
  transaction.** *Mitigation*: the same index entry; the version and its
  audit entry must agree, and the story's power-loss case requires it.
- **A future agent falls back to another bundle wholesale** when one key
  is missing. *Mitigation*: the same index entry; the fallback is per key,
  and the rest of the bundle is served normally.

## Related

- **Stories**: `005-change-configuration-and-language`
- **Requirements**: FR-18, FR-21, FR-22, FR-36, FR-37 · BRD NFR-03,
  NFR-11, NFR-14 · NFR-7 · IR-16
- **Previous ADRs**: ADR-043 (the audit trail is an append-only API with a
  database-assigned sequence — the API this bolt writes through, and the
  per-key variant of the same argument); ADR-044 (the export is streamed
  and the trail is a supervisor's record — the trail this bolt writes to,
  and the role check this bolt reuses); ADR-042 (the print path has no
  weighing-record repository — the exception this ADR makes, and why it is
  safe); ADR-034 (the station's own facts are durable, and a record is
  immutable — the weighing record this bolt appends to); ADR-005 (the
  reason is stored in clear text — it is a record, not a credential)
- **Standards**: `standards/tech-stack.md` § "Database" — append-only rows
  for acts, fixed-point decimal for every quantity, and `synchronous =
  FULL` for durability
