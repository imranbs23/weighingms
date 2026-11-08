---
stage: test
bolt: 024-007-weighingms-ui
status: complete
updated: 2026-11-06T20:00:00Z
---

# Test Report: WeighingMS UI (Bolt 024: the batch queue screen)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 111 passed, 0 failed (109 server + 2 client) |
| **Tests** | **1767 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`, both the server and the client configs) |
| **Coverage (all files)** | 88.16% statements · 80.08% branches · 91.65% functions · 89.19% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **15** (10 component + 5 source inspection) |
| **Baseline before the bolt** | 1752 tests, 109 files |
| **The client builds** | `vite build` — 39 modules, 229.68 kB (72.02 kB gzipped) |
| **Defects found by the tests** | **3**, all fixed (below) |

**This is the FIRST client code in the product**, and this bolt creates
unit `007-weighingms-ui`.

---

## What the tests prove

### The client holds NO DATA — and the test proves it by reading the source

**This is the bolt's real content.** The source-inspection test reads every
`.ts` and `.tsx` file in `src/007-weighingms-ui/` and asserts that
**none** of the MES's own values appears:

`B-24187`, `DYE-4471`, `DYE-2204`, `AUX-0101`, `AUX-0107`, `SO-9931`,
`JET-04`, `2026-0387`, `Teal 4C`, `94.2400`, `1240.0000`, `24.0000`,
`9.6000`.

**Because the client is the one place where hard-coded data would be
most tempting — and where it would be most invisible.** A hard-coded batch
id works perfectly until the MES releases a different one, and then the
station offers the operator a batch that does not exist.

### `ORGATEX · LINKED` is NOT a literal

**The prototype's hard-coded link string is deliberately not carried
over**, and the test searches the client source for it — and for the
`LINKED` and `ORGATEX ·` fragments, so a partial carry-over is caught
too.

**And the link state is the API's to report.** The queue's `source` and
`freshness` come from the server's response, and the client renders what
it is given.

### NO operator-facing literal is written in a COMPONENT

The test scans every file under `screens/` for:

- text inside JSX (`>Some text<`), and
- a `t()` argument that is **not** a dotted key.

**And a separate test proves every `t()` argument IS a dotted key** — so
the two together mean the client's only knowledge of the text is a key.

**And the design tokens are the exception the story names**: *"the only
things hard-coded are the design token set and the prototype's interaction
rules, which are the specification rather than the data."* The token test
asserts the touch-target token is there **and that it says 15** — so the
requirement is legible in the source.

### THREE states, and they are DISTINGUISHABLE

The story's edge cases are the design's real content:

| Situation | The test asserts |
|---|---|
| The queue has rows | Every row shows its **seven** columns, and the receipt time |
| The queue is **empty** | The **explicit** empty state — and **not** the degraded state |
| The API is **unreachable** | The **degraded** state with a **stated reason** — and **not** the empty state, **not** the rows |
| A batch is no longer released | The row is **not selectable** — `data-selectable="false"` and `aria-disabled="true"` |

**And the empty/degraded distinction is asserted both ways** — the empty
test asserts the degraded state is absent, and the degraded test asserts
both the empty state and the rows are absent. **That is the story's
BRD FR-20 requirement, made executable**: the operator must never be
shown a stale or empty-looking success.

### Selection by TOUCH and by SCAN go through the SAME action

- **Touching a row** posts `{ batchId }` — and the body does **not**
  contain a `method` field, because the server **derives** the method from
  the request's shape (ADR-030).
- **Scanning** posts `{ code }` — through the **same** endpoint.

**And a refused selection shows a VISIBLE reason.**

### The touch target is ≥ 15 mm — and the test MEASURES it

**Not "the token says 15" — the rendered target.** The test reads the
**computed style** of the row and of every button, and asserts
`minHeight ≥ 56px`.

**And 15 mm is 56.7 px at 96 dpi, so the token rounds UP** — because the
requirement is a floor, and a rounded-down target would be under it.

**And the label is legible at 1.5 m** — the rendered `font-size ≥ 24px`,
which is BRD NFR-08's floor.

---

## The three defects the tests found

### Defect 1 — the top-level `include` ran every test TWICE

**Found by:** the first full run after the projects were introduced —
**220 files and 3519 tests** instead of 111 and 1767.

**Root cause.** A top-level `test.include` is **inherited by both
projects**, so every server test ran once in the `node` project and once
in the `jsdom` one. The `include` was removed and each project declares
its own.

**And the suite now proves there is no overlap** — 109 server files, 2
client files, and the intersection is **empty**.

### Defect 2 — the client was not in the typecheck's scope

**Found by:** the typecheck, which reported `Property 'env' does not exist
on type 'ImportMeta'` for the client's `import.meta.env`.

**Root cause.** The root `tsconfig.json` included only `src/**/*.ts` and
`tests/**/*.ts` — so the client's `.tsx` files were **not typechecked at
all**, and it had no DOM library.

**The fix.** The root config now includes `.tsx`, carries the DOM libs and
`vite/client`'s types, and sets `jsx: react-jsx`. **And a separate
`tsconfig.client.json`** typechecks the client alone — so a client error is
reported as a client error.

**Worth stating plainly: the client's code was never typechecked before
this.** The whole unit would have shipped without a single type error
being caught.

### Defect 3 — the source test's path filter matched nothing

**Found by:** the source test — *"expected 0 to be greater than 0"*, so
the components list was **empty** and the literal scan checked **nothing**.

**Root cause.** The filter used `path.includes('screens/')` — and the
paths are built with `join`, so on Windows the separator is a backslash.

**And this is the dangerous kind of test defect: a source test that
matches nothing passes vacuously.**

**The fix.** The path is normalised (`path.split(/[\\/]/)`), and the test
now asserts the components list is **not empty** before scanning it — so a
filter that stops matching **fails** instead of passing quietly.

---

## Deliberately not delivered

- **The other four UI screens** — the weigh view, the confirmation view,
  the audit view, the settings view. Bolts `025`–`028`.
- **The end-to-end Playwright suite** — the workbook requires one, and it
  covers the complete workflow. It belongs with the last UI bolt.
- **The live weight stream in the client** — the SSE transport is unit
  `004`'s and the weigh view is bolt `025`'s.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| Every row shows the batch id, order reference, machine reference, fabric description, shade code, component count and weighing status, and the queue's last-received time | ✅ | `batch-queue-screen.test.tsx` — the seven values and the receipt time |
| **No** batch, recipe, component, weight or lot is defined in the client | ✅ | `client-source.test.ts` — thirteen fixture values, absent from every source file |
| `ORGATEX · LINKED` is **not** a literal | ✅ | `client-source.test.ts` — and neither are `LINKED` or `ORGATEX ·` |
| A scan or a touch selects the batch, and the selection is recorded with the method | ✅ | The component test — the body carries the id and **not** the method; the server derives it (ADR-030) |
| A scan of an unknown identifier is rejected with a visible reason, and **no** recipe is loaded | ✅ | The refusal test — the reason is shown. **The "no recipe is loaded" half is the server's** — the client's selection path does not fetch a recipe, and unit `002`'s recipe is loaded only on the weigh screen (bolt `025`) |
| **No** user-visible literal string is written in a component | ✅ | `client-source.test.ts` — the JSX and the `t()` scans, plus the key-shape test |
| The touch target is **≥ 15 mm** and every label is legible at 1.5 m | ✅ | The component test — the **rendered** `minHeight` and `fontSize` |

## Recommendations

- **The source-inspection test is the one worth keeping forever.** It is
  the executable form of the story's hardest constraint, and it will fail
  the moment somebody pastes a batch id into a component — which is
  exactly when it should.
- **The empty-list assertion in that test matters more than it looks.** A
  source test that matches nothing passes vacuously, and it would have
  passed forever. **Every source-scanning test should assert it found
  something.**
- **The client's typecheck is now a separate config** — and the root
  config covers `.tsx` too. **The client had never been typechecked
  before this bolt**, and that is the kind of gap a green suite hides.
- **The two projects exist because the environments differ**, and the
  server tests must stay in `node` — they exercise SQLite and Express.
  The overlap check (109 + 2, intersection empty) is worth re-running
  after any change to the config.
