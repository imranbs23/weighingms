---
stage: implement
bolt: 028-007-weighingms-ui
created: 2026-11-07T03:30:00Z
---

# Implementation Walkthrough: Peripheral Degraded States (Bolt 028)

## What was built

**The status strip** — the four peripherals' states, their reasons, their
ages, and the un-synchronised count.

```text
src/007-weighingms-ui/
├── api/
│   └── endpoints.ts    + the scales, the link state, the sync queue
├── state/
│   └── status-store.ts  Zustand — the strip's four peripherals
└── screens/status/
    └── StatusStrip.tsx   the entries, the reasons, the ages
```

## The five rules, and where each is enforced

### 1. Every entry is a REAL value from the API

**The strip is a RENDERER, not a monitor.** It does not probe devices and
it does not infer states — every entry is the value the owning unit
reports:

| The strip's half | The owning unit | The call |
|---|---|---|
| The scales | `004` | `GET /api/scales` |
| The OrgaTEX link | `005` | `GET /api/orgatex/link-state` |
| The queue | `005` | `GET /api/orgatex/sync-queue` |
| The printer | `006` | the print job's state |

### 2. The prototype's hard-coded link status is NOT carried over

**And the source test proves it** — no `ORGATEX · LINKED`, and `LINKED` is
never *rendered* as a literal.

**And the test was deliberately narrowed** when bolt 028 needed to compare a
reported state against `'LINKED'` — because **comparing** a reported value
is how the client knows the link is healthy, and **rendering** it is the
prototype's failure. The test now bans the *rendered* form, not the
comparison.

### 3. A stale snapshot is shown WITH ITS AGE

**The link's age is displayed whenever the data is not current** — so a
wrong number wearing a correct-looking costume is never presented as
current (BRD FR-32, FR-33).

### 4. A queued write is shown as PENDING, never as POSTED

**The un-synchronised count is visible — even on a healthy link**, because
*"a healthy link with a non-empty queue is a fact the operator needs."*

**And a `FAILED` entry stays visible** with its attempt count — *"it is not
silently discarded and it can be re-driven."*

### 5. Two failures get TWO entries

**Each peripheral is its own entry, with its own reason** — never collapsed
into one generic "error" state (FR-19).

## The API the client uses — and it already existed

| The client calls | What it provides |
|---|---|
| `GET /api/scales` | each device's `status`, its `linkState`, and its **capacity** |
| `GET /api/orgatex/link-state` | the status, the age, and the un-synchronised count |
| `GET /api/orgatex/sync-queue` | the pending and failed entries |

**And the OrgaTEX link-state endpoint was already doing the hard part:**

> *"A `DEGRADED` read is still a **200**, with `freshness.kind` saying
> `STALE` and `ageMs` saying how stale. It is not a 503: the station served
> the operator's work list, marked with its age — which is exactly what
> FR-20 asks for."*

## A gap this bolt CLOSED

**Bolt `025` flagged that the scale's maximum capacity was not on the zone
response — so the tolerance band could not be scaled against it (FR-8).**

**And it IS on `GET /api/scales`** — each device's `capacity`. So the
capacity is available, and the band can be scaled against it. **The gap was
in which endpoint the client was reading, not in the API.**

## What the client does NOT do

- **It does not probe a device.** Every state is reported.
- **It does not infer a state.** It renders the API's.
- **It does not show a queued write as posted.**
- **It does not show a stale snapshot without its age.**
- **It does not collapse two failures into one.**
