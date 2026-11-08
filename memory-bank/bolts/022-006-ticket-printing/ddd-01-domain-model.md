---
stage: model
bolt: 022-006-ticket-printing
created: 2026-11-06T14:50:00Z
---

## Static Model: 006-ticket-printing (bolt 022)

### Entities

- **ConfigurationEntry**: one configuration key's **current** effective
  value — the key, the value, the category, the version, the
  effective-from moment, and the actor who set it.

  It is the **effective** value — and it is **append-only**: a change is a
  **new version**, not an edit.

- **ConfigurationVersion**: one version of one key — the key, the value,
  the version number, the effective-from moment, the actor, the actor's
  role, and the reason.

  **The original value is retained, not overwritten in place.** The
  version history is what makes the effective value at any past moment
  reconstructable.

- **LocaleBundle**: one language's operator-facing strings — the locale
  code, the strings, and where it was loaded from.

  Loaded **at runtime** and cached — **not embedded at build time**.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **ConfigurationKey** | a bounded string | Which setting. **The key set is NOT closed by any requirement** — so the key is a **bounded string with a category and a type**, not an enum. The story is explicit: *"new keys must be added with a category and a type, not hard-coded into call sites."* |
| **ConfigurationCategory** | `SCALE_THRESHOLD` \| `TOLERANCE` \| `TEMPLATE` \| `LANGUAGE` | The four **named** categories. A **closed set** — because a category without a type cannot be read back. |
| **ConfigurationValue** | a bounded string | The value — always a **string**, because a scale threshold and a template id are both strings, and a typed union of every possible value would be a second taxonomy to keep in step. |
| **ConfigurationVersion** (number) | a positive integer | The key's version. **Monotonically increasing per key** — and the version is what orders the history. |
| **LocaleCode** | a bounded string | Which language. |

### THE SHARP EDGE — an override must not LAUNDER a weighing

**This is the story's own phrase, and it is the design's centre:**

> *"An override must not launder a weighing. This is the sharp edge of the
> configuration store and it is deliberate: a tolerance override is
> ultimately a way to make an out-of-tolerance weight acceptable."*

**So a tolerance override is not a setting change. It is a way of changing
what a weighing MEANS.** And the story's four rules follow from that:

1. **The override records WHAT it overrode** — the key, the component or
   scope, the original value — **and WHY** (the reason).
2. **The original value is RETAINED**, not overwritten in place.
3. **The override is VISIBLE ON THE WEIGHING RECORD ITSELF**, not only in
   a settings screen — *"so a reader of the weighing can see that an
   override applied"*.
4. **The version history of each key is kept**, so the effective value at
   any past moment can be reconstructed.

**And rule 3 is the one that reaches outside this unit.** The weighing
record lives in unit `003`. So this bolt **writes to it** — a new column
carrying the override that applied, if any.

**That is a deliberate exception to "this unit reads other units' records"
(bolt `019`), and it is worth stating why it is safe:** the override is
**appended to the record, never substituted for anything in it**. The
record's quantity, zone and timestamp are untouched; the override is
**additional evidence** about how the weighing was judged. So the record
stays immutable in the sense BRD DR-02 requires — a fact about the
weighing is not revised — while gaining a fact about the *judgement*.

### The weighing is evaluated against the configuration IN FORCE WHEN IT WAS TAKEN

**The story's rule:** *"Configuration values that change what a weighing
means are stored with a version and an effective-from point, so a weighing
is always evaluated against the configuration in force when it was
taken."*

**So the effective value is a function of TIME, not just of the key.** And
the version history is what makes that lookup possible: *"what was the
effective value of `tolerance.pct.dye` at 09:41?"*

**And that is why the version is never rewritten.** If the current value
were edited in place, the past would become unreconstructable — and a
dispute about a weighing six months ago would be unsettleable.

### The locale bundle is RUNTIME, and it FALLS BACK

**Two requirements, and they are distinct:**

> *"Locale bundles are JSON resources loaded **at runtime** and cached,
> **not embedded at build time** — that is what makes a language changeable
> without a redeployment (BRD NFR-11, BRD NFR-14). A bundle added later is
> picked up without a rebuild."*

> *"Given the configured locale bundle is missing a string, When that string
> is requested, Then a **defined fallback** is used and **no request
> fails** (BRD FR-22, NFR-7)."*

**And the edge case is precise:** *"A locale bundle is missing a key
present in another bundle → the defined fallback is used for that key; the
rest of the bundle is served normally."*

**So the fallback is PER KEY, not per bundle.** A bundle missing one string
does not fall back to another bundle wholesale — **that key** falls back,
and the rest is served normally.

**And the fallback is DEFINED.** It is not "whatever happens to be there" —
it is the default locale's string, and the default locale's bundle is the
**complete** one. That is what makes "no request fails" true.

### The configuration change is ITSELF AUDITED

**The story:** *"A configuration change is itself audited. A tolerance
override that is not attributable has changed the meaning of the weighings
around it, so `setConfiguration` writes through the same append-only audit
API as every other privileged action."*

**And the audit entry carries MORE than a reprint's does** — because the
story's acceptance criterion names six things:

> *"an audit entry is written carrying the actor, the actor's role, **the
> configuration key changed, the previous value, the new value and the
> reason**"*

**And the previous value is in the AUDIT entry, not only in the version
history.** They are different things:
- the **version history** reconstructs what was effective;
- the **audit entry** says *who* changed it, *when*, and *why* — the
  attribution.

**And it is the SAME append-only API** — bolt `020`'s — so the trail has
one shape and one ordering across every unit that writes to it.

### Two supervisors changing the same key CONCURRENTLY

**The story's edge case:** *"Two supervisors change the same key
concurrently → The later write wins and both changes are audited with their
own actors, reasons and versions; no change is lost from the audit trail."*

**So there are two facts here, and they are different:**

| Fact | Rule |
|---|---|
| The **effective value** | The **later** write wins |
| The **audit trail** | **Both** changes are recorded, each with its own actor, reason and version |

**And the trail losing nothing is the load-bearing half.** A last-write-wins
store with a single audit entry would lose a supervisor's change entirely —
and the reason they gave for it would vanish with it.

**So the version is assigned per key, monotonically, and every change
writes an audit entry** — whichever write lands second, it still audits.

### An override applied to a scope that does NOT EXIST is REFUSED

**The story's edge case:** *"An override is applied to a scope that does not
exist → The change is refused with a **visible reason**; **no value is
changed and no effective-version bump occurs**."*

**So the refusal happens BEFORE the version bump** — and "no effective-
version bump" is explicit. A refused override must not consume a version
number, because the version is the key's history and a version that
records nothing is a hole in it.

### An override is REMOVED by restoring the original

**The story's edge case:** *"A tolerance override is removed → The original
value is **restored as effective**, and the removal is itself audited with a
reason."*

**So removal is ANOTHER VERSION** — not a deletion, and not a special
"unset" state. The version history keeps the override's version, and the
new version carries the original value back.

**And the removal is audited** — with its own reason, because *"why was the
override withdrawn?"* is a question an auditor asks.

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **ConfigurationEntry** (the effective value) | the key, the value, the category, the version, the effective-from, the actor | 1. The value is **append-only** — a change is a new version. 2. The version is **monotonic per key**. 3. The **original value is retained** in the history. 4. A refused change bumps **no** version. |
| **ConfigurationVersion** | the key, the value, the version, the effective-from, the actor, the role, the reason | 1. The reason is **never empty** — an unattributable override changed the meaning of the weighings around it. 2. It is **immutable** once written. 3. It is **append-only** in the database. |
| **LocaleBundle** | the locale, the strings | 1. It is loaded at **runtime** — never embedded. 2. A **missing key** falls back, and the rest is served normally. |

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **ConfigurationChanged** | A value was changed | `key`, `previousValue`, `newValue`, `version`, `actorId` |
| **ConfigurationChangedRefused** | A change was refused | `key`, `reason` |
| **ConfigurationOverrideApplied** | A tolerance override applied | `key`, `scope`, `originalValue`, `newValue`, `reason` |

### Domain Services

- **ConfigurationService**: reads the effective value, applies a change,
  and refuses an invalid one.

- **LocaleService**: resolves a string in the configured locale, with the
  defined per-key fallback.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **ConfigurationRepository** | `ConfigurationEntry` + `ConfigurationVersion` | `effective(key, at?)`, `set(entry)`, `history(key)`, `all()` | **Yes** — append-only |
| **LocaleBundleRepository** | `LocaleBundle` | `load(locale)`, `default()` | **Yes** — the bundles are files |

### Ubiquitous Language

- **A key** — a setting's name.
- **A category** — what kind of setting it is.
- **The effective value** — the one in force now, or at a given moment.
- **A version** — one change to a key.
- **An override** — a change that alters what a weighing means.
- **A scope** — what the override applies to: a key, a component, or a range.
- **A bundle** — one language's strings.
- **The fallback** — the default locale's string for a missing key.

---

## Constraints carried into the Technical Design

1. **A configuration change is AUDITED**, through the **same append-only
   API** as every other privileged action.
2. **The audit entry carries the actor, the role, the key changed, the
   previous value, the new value and the reason** — six facts.
3. **The ORIGINAL value is retained** — never overwritten in place — and
   the **version history** is kept.
4. **A weighing is evaluated against the configuration IN FORCE WHEN IT
   WAS TAKEN** — so the effective value is a function of time.
5. **The override is VISIBLE ON THE WEIGHING RECORD** it affects — and it
   is **appended**, never substituted for anything in the record.
6. **The reason is MANDATORY** on every change — including a removal.
7. **Two concurrent changes**: the **later** write wins the effective
   value, and **BOTH** are audited with their own actors, reasons and
   versions.
8. **A refused change bumps NO version** and changes NO value, and the
   refusal carries a **visible reason**.
9. **A removal restores the original as effective** — as another version,
   audited with its own reason.
10. **The locale bundle is loaded at RUNTIME and cached** — never embedded
    at build time — so a language changes without a redeployment.
11. **A missing string falls back PER KEY**, to the **defined** default
    locale — and **no request fails**.
12. **The key set is NOT closed** — a new key carries a category and a
    type, and is **not hard-coded into call sites**.

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| A configuration write is interrupted by power loss | Either the previous version or the new one is in effect, **never a partially written value**; the audit entry and the version record agree |
| The configured language changes **mid-session** | Strings requested after the change are served in the new language — **no redeployment, no restart** |
| A bundle is missing a key another bundle has | The **defined fallback** is used for that key; the rest of the bundle is served normally |
| Two supervisors change the same key concurrently | The **later** write wins; **both** are audited with their own actors, reasons and versions; **no change is lost from the trail** |
| A tolerance override is removed | The **original** is restored as effective; the removal is **itself audited with a reason** |
| An override is applied to a scope that does not exist | **Refused with a visible reason**; no value changed, **no version bump** |

---

## Open points carried forward

- **The report on tolerance failures and overrides** — story `006`. It
  reads the configuration's history and the trail for override
  authorisations.
- **The settings screen and the locale bundles in the UI** — unit `007`.
- **The upstream value a local override names** — *"Scale thresholds and
  tolerance rules originate in OrgaTEX (A-07); a configuration override in
  WeighingMS records a local override of that upstream value and names the
  upstream value it overrode."* The MES's value is read through the seam
  unit `005` already exposes.
- **The ticket's physical format** — Q-11 and Q-12 remain open. The
  template is a **configuration key**, and this bolt does not invent a
  layout.
