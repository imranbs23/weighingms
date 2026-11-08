---
stage: design
bolt: 022-006-ticket-printing
created: 2026-11-06T15:10:00Z
---

## Technical Design: 006-ticket-printing (bolt 022)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

**And this bolt adds a store whose shape is dictated by a sharp edge**: a
configuration change can alter what a weighing means, so the store is
**versioned**, the change is **audited**, and the override reaches the
weighing record.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   ConfigurationController  GET  /api/configuration                │
│                         PUT  /api/configuration/:key             │
│   LocaleController        GET  /api/locale/:locale/:key          │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   SetConfiguration      the change, the version, the audit       │
│   ResolveString         the locale, and the per-key fallback     │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   ConfigurationEntry     the EFFECTIVE value                      │
│   ConfigurationVersion   ONE version — the history                │
│   ConfigurationKey/Category/Value                                 │
│   LocaleBundle          one language's strings                   │
│   ConfigurationRepository  THE PORT                               │
│   LocaleBundleRepository   THE PORT                               │
│   AuditEntryRepository     bolt 020's — the SAME append-only API │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   ConfigurationDatabase       the tables and migrations          │
│   SqliteConfigurationRepository                               │
│   SqliteLocaleBundleRepository  the bundles are FILES             │
│   JsonLocaleBundleAdapter      reads them at RUNTIME              │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `GET /api/configuration` — the effective configuration

`200` with every entry — **its key, value, category, update time, updating
actor and version**.

#### `PUT /api/configuration/:key` — the change

| Status | Meaning | Body |
|---|---|---|
| **200** | The value was changed | `{ entry, version }` |
| **400** | The body is not a change | `{ error: "VALIDATION_ERROR" }` |
| **403** | The operator is not a supervisor | `{ error: "SUPERVISOR_REQUIRED" }` |
| **404** | The scope does not exist | `{ error: "SCOPE_NOT_FOUND" }` |
| **422** | The reason is missing | `{ error: "REASON_REQUIRED" }` |

**AND A CONFIGURATION CHANGE IS A SUPERVISOR'S ACT** — the story's actor is
*"a dyehouse supervisor"*, and a change that alters what a weighing means is
exactly the kind of act that needs one. **The role comes from the
session**, never from the request.

**AND THE BODY CARRIES THE VALUE, THE SCOPE AND THE REASON** — and **not**
the actor, the role, the version or the previous value. Those are derived
or assigned.

#### `GET /api/locale/:locale/:key` — one string

`200` with the string, or the **fallback** — and **never** a failure.

### The configuration store's shape — and why it is versioned

**The table has TWO rows' worth of information per change**, and that is
the design:

| Table | Holds | Mutability |
|---|---|---|
| `configuration_versions` | **every** version of **every** key — the history | **append-only** |
| `configuration_effective` | the **current** effective value per key | **upserted** — it is a projection |

**And the effective table is a PROJECTION of the history.** That is what
makes the effective value a function of time without making the *read* a
scan: the history is the truth, and the effective table is the answer to
"what is in force now".

**And a version's `effective_from` is what makes the historical lookup
possible:** *"what was the effective value of this key at 09:41?"* is a
query for the newest version whose `effective_from` is at or before that
moment.

### The version is assigned by the DATABASE, per key

**And this is where bolt `021`'s argument applies with a twist.** The audit
trail's sequence is a **global** `AUTOINCREMENT`. The configuration's
version is **per key** — so two keys' versions are independent.

**So the version is a `UNIQUE (key, version)` constraint**, and the
version number is assigned by the **application** — but **atomically**,
by the constraint.

**The write is one transaction:**

```text
1. read the key's current version (V)
2. INSERT the new version with V + 1
3. UPDATE the effective row
```

**And step 2's `UNIQUE (key, version)` is the guard.** Two concurrent
changes to the same key both read `V`, both try `V + 1`, and **one loses
the insert** — so the loser's write fails, it retries, and it becomes
`V + 2`. **The versions never collide, and the later write wins the
effective value** — which is the story's rule.

**And both changes are audited**, whichever order they land in: the audit
entry is written in the **same transaction** as the version, so a version
and its audit entry always agree — the story's power-loss edge case
(*"the audit entry and the version record agree"*).

### The override reaches the weighing record — APPENDED, never substituted

**The story's third rule:** *"the override is **visible on the weighing
record itself**, not only in a settings screen, so a reader of the
weighing can see that an override applied"*.

**And that is a write to unit `003`'s record.** Which is a **deliberate
exception** to this unit's usual read-only relationship with unit `003`.

**And it is safe because it is APPENDED.** The record's quantity, zone and
timestamp are untouched; the override is **additional evidence about how
the weighing was judged**. So:

- the record's **immutability** is preserved in the sense BRD DR-02
  requires — a fact about the weighing is not revised;
- the record gains a fact about the **judgement**.

**And the column is a single nullable field** carrying the override's
description — the key, the scope, the original value, the new value and
the reason. **Not a row per override** — because a weighing had one
effective configuration when it was taken, and the versions carry the
history.

### The locale bundle is a FILE, read at runtime

**The story:** *"Locale bundles are JSON resources loaded at runtime and
cached, **not embedded at build time**"*.

**So the bundles are files on disk**, and the adapter reads them **when a
locale is first requested** and **caches** them.

**And the default locale's bundle is the COMPLETE one** — because it is
the fallback for every key the configured bundle lacks. **That is what
makes "no request fails" true**, and it is why the default bundle is
**loaded eagerly**: it must be available even when the configured bundle
is missing a key.

**And the fallback is PER KEY**, not per bundle:

```ts
// The configured bundle's string, or the DEFAULT bundle's string for THAT
// key — and the rest of the configured bundle is served normally.
const value = bundle.strings[key] ?? this.defaultBundle.strings[key] ?? key;
```

**And the last fallback is the key itself.** A key missing from *both*
bundles returns the key — **not** an error, and not `undefined`. The
story says *"a defined fallback is used and **no request fails**"*, and a
string that shows the key is a defined, diagnosable answer.

### Data Model

#### `configuration_versions` — the history, append-only

| Column | Type | Notes |
|---|---|---|
| `version_id` | `TEXT NOT NULL PRIMARY KEY` | A **uuid** |
| `config_key` | `TEXT NOT NULL` | Which setting |
| `category` | `TEXT NOT NULL` | Which kind — the four named categories |
| `value` | `TEXT NOT NULL` | The value — always a **string** |
| `version` | `INTEGER NOT NULL` | The key's version number |
| `effective_from` | `TEXT NOT NULL` | When it came into force |
| `actor_id` | `TEXT NOT NULL` | Who set it |
| `actor_role` | `TEXT NOT NULL` | Their role |
| `reason` | `TEXT NOT NULL` | **Never empty** |
| `previous_value` | `TEXT NULL` | What it replaced — **the original is retained** |
| `scope` | `TEXT NULL` | What the override applies to |
| `recorded_at` | `TEXT NOT NULL` | When the row was written |

**And the `UNIQUE (config_key, version)`** — the per-key version's atomic
guard.

**And the triggers refuse an UPDATE and a DELETE** — the history is
append-only (BRD DR-02).

#### `configuration_effective` — the projection

| Column | Type | Notes |
|---|---|---|
| `config_key` | `TEXT NOT NULL PRIMARY KEY` | Which setting |
| `value` | `TEXT NOT NULL` | The value in force |
| `category` | `TEXT NOT NULL` | Which kind |
| `version` | `INTEGER NOT NULL` | The version in force |
| `effective_from` | `TEXT NOT NULL` | When it came into force |
| `actor_id` | `TEXT NOT NULL` | Who set it |
| `updated_at` | `TEXT NOT NULL` | When the row was written |

**And it IS updated** — it is a projection, not a record. **And a
trigger refuses to update it to a version that does not exist in the
history** — so the projection cannot drift from the truth.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). |
| **The role** | From the **session's operator** — a change is a supervisor's act. |
| **A client-supplied actor or role** | There is **no** field for it. The session supplies both. |
| **A client-supplied version** | There is **no** field for it. The store assigns it. |
| **A client-supplied previous value** | There is **no** field for it. The store reads it. |
| **A client-supplied effective-from** | There is **no** field for it. It is **now** — a change takes effect when it is made. |
| **A client-supplied category** | There is **no** field for it. The category comes with the key's **definition**, not the request. |
| **The reason** | **Mandatory** — a change without one is refused. |
| **A scope that does not exist** | **Refused with a visible reason**, and **no version is bumped**. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **BRD FR-22 / NFR-14** | The value is in effect for subsequent operations **without a rebuild, a redeployment or a restart** — the store is read at use, and the bundles are runtime files. |
| **BRD FR-21 / FR-36** | The change is audited through the **same** append-only API, with all six facts. |
| **BRD FR-18** | The override is **visible on the weighing record** it affects. |
| **BRD NFR-11** | The bundles are loaded at runtime and cached. |
| **NFR-7** | A missing string falls back, and **no request fails**. |
| **BRD NFR-05** | The version and its audit entry are written in **one transaction**, with `synchronous = FULL`. |

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the store** | A change creates a **new version**; the original is **retained**; the effective value is the latest; the historical lookup answers *"what was in force then?"*. |
| **Unit — the concurrency** | Two changes to one key get **distinct versions**, the **later** wins the effective value, and **both** are audited. |
| **Unit — the refusal** | A missing reason is refused; a scope that does not exist is refused; **neither bumps a version**. |
| **Unit — the locale** | A missing key falls back **per key**; the rest of the bundle is served normally; a key missing from **both** returns the key; **no request fails**. |
| **Integration — the change** | The `200` carries the entry and the version; the audit entry carries all **six** facts; an operator is a `403`. |
| **Integration — the locale** | The string is served in the configured language; the fallback is served when the bundle lacks it. |
| **Persistence** | The history refuses an UPDATE and a DELETE; the effective row cannot drift from the history. |
| **Security** | The role comes from the **session**; a client-supplied actor, role, version, previous value or effective-from is **dropped**. |

### Open points carried forward

1. **The report on tolerance failures and overrides** — story `006`.
2. **The settings screen and the locale bundles in the UI** — unit `007`.
3. **The upstream value a local override names** — the MES's value, read
   through unit `005`'s seam.
4. **The ticket's physical format** — Q-11 and Q-12 remain open. The
   template is a configuration **key**, and this bolt invents no layout.
