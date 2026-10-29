# Tech Stack

## Overview

WeighingMS is built as a TypeScript full-stack application: a React SPA for the 15" operator terminal, and a Node/Express service that hosts the Dummy APIs standing in for OrgaTEX, the weighing scales, the barcode scanner and the ticket printer. TypeScript with `strict` mode plus fixed-point decimal arithmetic is chosen because the BRD forbids floating-point for quantities (NFR-16) and the domain is dominated by exact decimal rules — tolerance bands, surplus compensation, tare subtraction.

## Languages

TypeScript (strict mode), running on Node.js 20+ for the API service and in the browser for the SPA.

Rationale: The BRD's hardest correctness constraints are all about exact quantities — `target_qty`, `actual_qty`, `tolerance_min`/`tolerance_max` are `decimal(12,4)` in the BRD data model, and NFR-16 states "Weight arithmetic uses fixed-point decimal; floating point is not permitted for quantities". TypeScript's static types catch unit/value mix-ups across the weighing domain (grams vs kilograms, target vs actual), while `decimal.js` provides the fixed-point arithmetic the BRD requires. A single language across API and UI also keeps the Dummy API types and the client call sites in sync.

## Framework

- **UI**: React 19 with Vite
- **API**: Express 4 (Node.js)
- **State management**: Zustand
- **Validation**: Zod (API boundary schemas)

Rationale: The supplied prototype is a three-screen single-page application with a live-updating weighing readout, so React is the natural match. Vite gives fast hot-module-replacement during bolt-by-bolt construction, which matters given the workbook's execution model of many small approved bolts. Express serves the four Dummy APIs with a deliberately minimal surface; every OrgaTEX interaction in the product is confined to a single adapter component (IR-07), so the framework's specifics are contained behind one boundary. Zustand was chosen over a heavier store because the only genuinely dynamic state is the live weight stream, and Zustand's selector-based subscriptions avoid re-rendering the whole tree at 10 Hz (NFR-01, ≤200 ms lag). Zod validates every API payload at the boundary, which keeps the Dummy APIs honest about their contracts.

### Service topology

The API service and the UI are served as **separate processes on separate ports**, with CORS enabled on the API:

```text
React SPA (Vite)  ──XHR / EventSource──>  Express API
   :5173                                    :3000
                                            ├─ /api/batches       (Dummy OrgaTEX)
                                            ├─ /api/scales        (Dummy Scale)
                                            ├─ /api/scan          (Dummy Scanner)
                                            └─ /api/tickets       (Dummy Printer)
```

Rationale: This mirrors the real deployment topology, where the station frontend and the OrgaTEX-facing integration would not necessarily share an origin. It also makes the "Dummy integrations are real development artifacts" rule (Workbook Rule 5) structurally enforceable — the SPA has no embedded fixture data and can only obtain data over the network.

### Live weight transport

The Dummy Scale streams weight over **Server-Sent Events** at 10 Hz:

```text
GET /api/scales/:scaleId/weight      (text/event-stream)
data: {"weight":93.42,"stable":false,"timestamp":"..."}
```

Rationale: IR-10 requires "a continuous weight stream from each scale indicator at no less than 10 readings per second", and NFR-01 budgets 200 ms total lag (100 ms sampling interval, 100 ms for transport, processing and render). SSE gives server-to-client push over plain HTTP with automatic browser reconnection and no extra infrastructure, matching the one-way nature of a weight readout. Polling was rejected because it spends part of the latency budget on request overhead and cannot distinguish a disconnected indicator from a stationary weight.

## Authentication

Local operator and supervisor directory: badge ID plus PIN, stored in the WeighingMS database. Two roles — `OPERATOR` and `SUPERVISOR` — with the supervisor role required for tolerance override, manual scale reselection and calibration bypass (FR-35).

Rationale: BRD NFR-12 requires "Privileged actions require authentication; credentials never shared between roles", and FR-35 requires supervisor authentication for privileged actions with all privileged actions written to the audit trail (FR-36). FCI's own directory is an open question in the Product Brief (A-09 — "WeighingMS, or FCI directory"), so the local directory is a self-contained implementation that satisfies the role separation without assuming an SSO contract that does not exist. Credentials are never shared: each operator has their own badge ID, and supervisor actions record the authorising identity.

## Infrastructure & Deployment

Single Node.js process for the API service (Express), serving the Dummy APIs and the persisted weighing records from a local SQLite database. The React SPA is served as a static build by the same Express process in production mode, and by Vite's dev server in development mode. Runs on Windows/Linux/macOS with no container orchestration, no cloud dependency and no external services — the entire product is self-contained and demonstrable offline.

Rationale: The real external systems are unavailable in this environment (Workbook section 0), so the product must run standalone with no network dependency or credential provisioning. NFR-03 requires weighing to remain available during an OrgaTEX or network outage, and NFR-05 requires a confirmed weighing to survive immediate power loss; a local SQLite database with write-through persistence satisfies both without an external dependency. SQLite was selected over a server database because the BRD's data model (BRD §9.2) is a fixed relational schema with no need for concurrent multi-tenant writes, and a single station is the confirmed V1 scope (A-11).

### Database

SQLite via `better-sqlite3`, with fixed-precision decimal columns stored as TEXT to preserve exact decimal semantics (no IEEE-754 rounding on disk). Migrations are applied at startup. Records are append-only: DR-02 requires confirmed records to be immutable, with corrections written as new records referencing the original.

### API shape

JSON over HTTP, with a single `/api` prefix per Dummy service:

| Dummy service | Endpoints |
|---|---|
| Dummy OrgaTEX | `GET /api/batches`, `GET /api/batches/:batchId`, `GET /api/batches/:batchId/recipe`, `POST /api/batches/:batchId/consumption` |
| Dummy Scale | `GET /api/scales`, `GET /api/scales/:scaleId/status`, `GET /api/scales/:scaleId/weight` (SSE), `POST /api/scales/:scaleId/tare` |
| Dummy Scanner | `POST /api/scan` |
| Dummy Printer | `POST /api/tickets` |

Rationale: These are **training contracts**, not claims about the real OrgaTEX interface. The BRD's own unresolved questions (A-01, A-02) mean no real contract may be assumed, and the Product Brief's illustrative REST shape is explicitly marked "for FCI/SETEX to correct". Every one of these endpoints sits behind the adapter boundary required by IR-07, so replacing the Dummy OrgaTEX with the real interface touches one component.

## Package Manager

npm (v11), as bundled with Node.js 20+.

Rationale: The specs.md framework and the workbook's prescribed commands (`npx specsmd@latest install`, `npx specsmd@latest dashboard`) are npm-based, so npm avoids a second package manager in the same repository and keeps the documented commands working as written. pnpm was the framework's general default recommendation, but it offers no material advantage for this single-package repository and would add a prerequisite the workbook does not assume.

## Testing

- **Unit / integration**: Vitest, with Supertest for API endpoint tests
- **End-to-end**: Playwright (Chromium), covering the complete workflow from batch selection through ticket generation
- **Decimal correctness**: explicit unit tests on tolerance boundary values (93.4 / 93.5 / 94.0 / 94.5 / 94.6 g) using the decimal library, to prove fixed-point behaviour at the boundaries

Rationale: The workbook (Step 29) explicitly requires a Playwright suite and an end-to-end video. Vitest shares Vite's transform pipeline with the app, so no second build tool is introduced. Boundary-value unit tests are mandatory because the BRD's tolerance acceptance criteria (AC-04) hinge on exact inclusive/exclusive comparison at the band edges, which is precisely where a float implementation would silently fail.

## Decision Relationships

- **TypeScript strict + decimal.js** is not interchangeable with the BRD data model: `decimal(12,4)` fields and NFR-16's no-floating-point rule require fixed-point arithmetic end to end, including in the API payloads and the persisted rows.
- **Express + the adapter boundary** implement IR-07 together: because all four Dummy services are HTTP contracts behind one service, swapping the Dummy OrgaTEX for the real interface is a contained change.
- **SSE + Zustand** implement NFR-01 together: server push removes polling overhead from the latency budget, and selector-based subscriptions keep a 10 Hz stream from re-rendering the whole screen.
- **SQLite append-only + immutable records** implement DR-01/DR-02 together: the 5-year retention requirement and the immutability requirement are both satisfied by writing new correction records rather than mutating confirmed ones.
- **Separate API port + CORS** mirrors the eventual production topology, so the training build does not need rework when the real OrgaTEX interface is connected.

## Open Items Carried Forward

These are unresolved in the Product Brief and are explicitly **not** assumed by this stack:

- A-01: whether OrgaTEX exposes a documented REST API at all, and with what shape
- A-02: whether OrgaTEX accepts external consumption postings
- A-05: the real scale indicator protocol and whether continuous streaming is possible
- A-09: whether FCI supplies its own operator directory, or WeighingMS masters it
- A-15: actual daily batch volume, which determines whether one station suffices

The stack must not preclude any of these being resolved differently.
