---
stage: plan
bolt: 028-007-weighingms-ui
created: 2026-11-07T03:00:00Z
---

# Implementation Plan: Peripheral Degraded States (Bolt 028)

## What this bolt is

**The status strip and the degraded states** — the last UI bolt.

**A `simple-construction-bolt`** — plan → implement → test. The client owns
no functional requirement.

## The governing rule

**"No failure at any boundary may produce a silently wrong number."**

**Every degraded state in this story is one of the ways that rule is
honoured at the rendering layer**, and the story lists them exactly:

| Peripheral | The failure | What the client must show |
|---|---|---|
| **The scale** | stopped producing readings | **no value** — never `0.0` — and the stream's age |
| **The scale** | disconnected | which scale failed, and what to do |
| **The scale** | calibration expired | weighing blocked, the reason naming it |
| **The scanner** | unreadable or unavailable | the failure, **never a silent skip**, and the attestation path |
| **The printer** | out of paper | the weighing **still recorded**, the ticket **not printed** |
| **OrgaTEX** | unreachable | `OFFLINE`, the last known state **with its age**, writes **pending** |
| **OrgaTEX** | degraded | the snapshot **marked with its age**, never as current |
| **The API** | unreachable | an explicit degraded state, **never stale numbers** |

**And the status strip is a RENDERER, not a monitor** — every entry is the
value the owning unit reports.

## The facts I checked before planning

**Every peripheral's state is already on the API:**

| The strip needs | What exists |
|---|---|
| Both scales | `GET /api/scales` — each device's `status` and `linkState`, and its **capacity** |
| The weighing gate | `GET /api/scales/:scaleId/can-weigh` — `{ allowed, reason }` |
| The OrgaTEX link | `GET /api/orgatex/link-state` — the status, the age, and the **un-synchronised count** |
| The sync queue | `GET /api/orgatex/sync-queue` — the pending and failed entries |
| The scanner | unit `002`'s scan endpoint, and its `SCANNER_UNAVAILABLE` refusal |
| The printer | `GET /api/print-jobs/:jobId` — the job's state and error |

**And the OrgaTEX link-state endpoint is already doing the hard part:**

> *"A `DEGRADED` read is still a **200**, with `freshness.kind` saying
> `STALE` and `ageMs` saying how stale. It is not a 503: the station served
> the operator's work list, marked with its age — which is exactly what
> FR-20 asks for."*

**And the scale's capacity IS on `GET /api/scales`** — which is the field
bolt `025` was missing for the band. **So the band can be scaled against it
after all**, and that closes a gap I flagged two bolts ago.

## The four decisions

### 1. The strip shows REAL values, and never `ORGATEX · LINKED`

> *"the prototype's hard-coded `ORGATEX · LINKED` string is deliberately not
> carried over; `LINKED`, `DEGRADED` and `OFFLINE` are **real values that
> arrive over the API**" (FR-19, BRD IR-18).

**So the strip renders the API's `status` values**, and the source test
already proves `LINKED` and `ORGATEX ·` appear nowhere in the client.

### 2. A QUEUED WRITE is shown as PENDING, never as POSTED

> *"A consumption posting that has not landed at OrgaTEX has not happened as
> far as the MES is concerned; showing it as posted would tell the operator
> their work has reached production when it has not."*

**So the strip shows the un-synchronised count**, and a `FAILED` entry
stays visible with its last error and attempt count — *"it is not silently
discarded and it can be re-driven."*

### 3. A STALE SNAPSHOT is shown WITH ITS AGE, never as current

> *"A snapshot presented as current is a wrong number wearing a
> correct-looking costume, and the operator cannot tell it apart from live
> data."*

**So the queue's age is displayed whenever the snapshot is stale**, and the
client never presents it as current.

### 4. The READOUT's LIVENESS is tied to the STREAM's freshness

> *"the readout's liveness is tied to the stream's actual freshness
> (≤ 200 ms), **not to the last number the client happened to receive**"*
> (B-8, NFR-1).

**So the readout is live only while the stream is fresh** — and the
already-built 200 ms threshold is the rule.

## The architecture

```text
src/007-weighingms-ui/
├── api/
│   └── endpoints.ts     + the scales, the link state, the sync queue
├── state/
│   └── status-store.ts   Zustand — the strip's four peripherals
└── screens/status/
    ├── StatusStrip.tsx
    └── PeripheralState.tsx
```

## The tests

| Suite | What it proves |
|---|---|
| **Unit — the strip's states** | Every peripheral's state is **the API's**; a `DEGRADED` link is marked with its **age**; a queued write is **pending**, never posted. |
| **Component — the strip** | The four peripherals are shown; each failure gets **its own entry and its own reason** — never collapsed into one generic "error". |
| **Component — the scale's silence** | The readout shows **no value** — never `0.0` — and the age is shown; the confirm action is disabled with a reason. |
| **Component — the link's states** | `OFFLINE` shows the last known state **with its age** and the un-synchronised count; `DEGRADED` marks the snapshot with its age. |
| **Component — the printer** | The ticket is shown as **not printed**, and the weighing is unaffected. |
| **Component — the source** | No operator-facing literal; **no** `LINKED`; no probe of the devices. |
| **Component — the targets** | Every status entry and fallback action is **≥ 15 mm**. |

## What this bolt does NOT do

- **The end-to-end Playwright suite** — the last bolt of the project.
