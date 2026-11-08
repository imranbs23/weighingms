---
stage: plan
bolt: 027-007-weighingms-ui
created: 2026-11-07T01:00:00Z
---

# Implementation Plan: Review and Print (Bolt 027)

## What this bolt is

**The completion view** — the batch summary, the per-component detail, the
ticket preview, and the print and reprint actions.

**A `simple-construction-bolt`** — plan → implement → test. The client
owns no functional requirement.

## The facts I checked before planning

| The client needs | What exists |
|---|---|
| The summary | `GET /api/batch/:batchId/summary` — the domain's, with the total as a **string** and the verdict as a **string** |
| The ticket | `GET /api/tickets/:ticketId` — its identity, its lines, its outcome |
| The print | `POST /api/tickets/:ticketId/print` — the job's state, `DONE` or `FAILED` |
| The job's state | `GET /api/print-jobs/:jobId` — **retrievable while in flight** |
| The reprint | `POST /api/tickets/:ticketId/reprint` — the body's **only** field is the reason |
| The strings | `GET /api/locale/:locale/:key` |

**And the summary's own fields are the ones the story names** — the batch
id, the counts, the total, the elapsed time, the operator, the verdict,
the write-back state, the release statement and the target machine.

## The four decisions

### 1. The client NEVER composes the ticket

> *"the preview is the ticket **rendered by the API** and shown as received,
> and the client composes no part of the ticket itself — no field layout,
> no header, no footer text is assembled in the browser"* (FR-17, BRD IR-16).

> *"A client that assembled the ticket from its own field list would
> **freeze that list into the build** and turn every template change into a
> release."*

**So the preview renders the API's ticket — its identity, its lines, its
outcome — and the client assembles no header, no footer and no layout.**

**And the source test proves it**: no header or footer text is assembled,
and no field list is duplicated.

### 2. A failed print is shown as NOT PRINTED — never as a silent success

> *"**A failed print is shown as *not printed*, never as a silent success.**
> This is the client-side half of B-7 … the view shows the print job's
> error, keeps the ticket available for a later attempt, and **never
> renders the ticket as printed when the job did not reach `DONE`**."*

**And the reverse failure — a printed job shown as pending — is equally
wrong**, so **the displayed state is always the job's state as reported
by the API**.

**So the view's printed/not-printed rendering is driven by the job's
state**, and it is **never** the click's optimism.

### 3. The print job's state is VISIBLE while it is in flight

> *"The print job's state is polled or streamed while it is in flight, so
> the operator sees 'printing' rather than a dead button. **The view does
> not optimistically declare success on the click.**"*

**So the job's state is fetched by its id** — and the four states
(`QUEUED`, `PRINTING`, `DONE`, `FAILED`) are each rendered distinctly.

### 4. A reprint is MARKED and needs a REASON

> *"the reprint is visibly marked as a reprint, and **it cannot be raised
> until a non-empty reason has been supplied**"* (FR-17, FRD FR-28, FR-21).

**So the reprint action is disabled without a reason** — visible before the
press — and the marking is shown.

## The architecture

```text
src/007-weighingms-ui/
├── api/
│   └── endpoints.ts       + the summary, the ticket, the print, the job, the reprint
├── state/
│   └── completion-store.ts  Zustand — the summary, the ticket, the job
└── screens/completion/
    ├── CompletionScreen.tsx
    ├── BatchSummaryView.tsx
    ├── TicketPreview.tsx
    └── PrintPanel.tsx
```

## The tests

| Suite | What it proves |
|---|---|
| **Component — the summary** | The batch id, the counts, the total, the elapsed time, the operator and the verdict are shown — **as the API reported them**. |
| **Component — the detail** | Every component is listed with its target, actual, unit, lot, container, scale and **zone at confirmation**. |
| **Component — the preview** | The preview is the **API's ticket** — and the client composes no header, no footer and no layout. |
| **Component — the print** | The job's state is shown while it is in flight; a **failed** print is shown as **not printed** with its error; the ticket stays available for a later attempt. |
| **Component — the reprint** | The action is **disabled without a reason**; with one it is raised and **marked**. |
| **Component — the source** | No operator-facing literal; **no ticket composition**; no float parsing. |
| **Component — the targets** | Every action's touch target is **≥ 15 mm**. |

## What this bolt does NOT do

- **The peripheral degraded states** — story `005`.
- **The end-to-end Playwright suite** — the last UI bolt.
