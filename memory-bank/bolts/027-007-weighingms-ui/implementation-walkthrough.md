---
stage: implement
bolt: 027-007-weighingms-ui
created: 2026-11-07T01:30:00Z
---

# Implementation Walkthrough: Review and Print (Bolt 027)

## What was built

**The completion view** — the summary, the per-component detail, the ticket
preview, and the print and reprint actions.

```text
src/007-weighingms-ui/
├── api/
│   └── endpoints.ts   + the summary, the ticket, the print, the job, the reprint
└── screens/completion/
    ├── CompletionScreen.tsx
    └── components.tsx   the summary, the detail, the preview, the print panel
```

## The four rules, and where each is enforced

### 1. The client NEVER composes the ticket

**The preview renders the API's ticket** — its identity, its lines, its
outcome, its template — and the client assembles **no** header, **no**
footer and **no** layout.

**And the source test proves it**: no `ticketHeader`, `ticketFooter`,
`renderTicket`, `composeTicket`, `ticketFields`, `TICKET_COLUMNS` or
`ticketLayout` anywhere in `screens/`.

**Because the reason is structural**: *"A client that assembled the ticket
from its own field list would freeze that list into the build and turn
every template change into a release."*

### 2. A failed print is shown as NOT PRINTED

**The printed state is the JOB's state** — `job.state === 'DONE'` — and
never the click's optimism.

**So a `FAILED` job renders:**
- the state,
- the **error**,
- `data-printed="false"` on the panel,
- and **no** "printed" confirmation.

**And a `DONE` job renders `data-printed="true"`** — because the reverse
failure, a printed job shown as pending, is equally wrong.

### 3. The job's state is VISIBLE while it is in flight

**The job's state is rendered with its `data-state`** — so `QUEUED`,
`PRINTING`, `DONE` and `FAILED` are each distinguishable, and the operator
sees "printing" rather than a dead button.

### 4. The reprint is MARKED and needs a REASON

**The reprint action is disabled without a reason** — so the requirement
is visible **before** the press — and it goes with the request.

**And the marking is the API's**: `isReprint`, `reprintOf` and the reason
all come from the job the API reports.

## The API the client uses — and it already existed

| The client calls | The body's ONLY field |
|---|---|
| `GET /api/batch/:batchId/summary` | — |
| `GET /api/tickets/:ticketId` | — |
| `POST /api/tickets` | — |
| `POST /api/tickets/:ticketId/print` | — |
| `POST /api/tickets/:ticketId/reprint` | `reason` |
| `GET /api/print-jobs/:jobId` | — |

**And the summary's own fields are the ones the story names** — the batch
id, the counts, the total, the elapsed time, the operator, the verdict,
the write-back state, the release statement and the target machine.

## What the client does NOT do

- **It does not compose the ticket.** It renders the API's.
- **It does not reassemble the summary.** The verdict and the total are
  received values.
- **It does not declare a print successful on the click.** It renders the
  job's state.
- **It does not sum a quantity.** It formats the API's string.
