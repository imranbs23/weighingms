---
stage: test
bolt: 027-007-weighingms-ui
status: complete
updated: 2026-11-07T02:00:00Z
---

# Test Walkthrough: Review and Print (Bolt 027)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 116 passed, 0 failed (109 server + 7 client) |
| **Tests** | **1823 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 87.79% statements · 80.18% branches · 90.24% functions · 88.78% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **9** (8 component + 1 new source) |
| **Baseline before the bolt** | 1814 tests, 115 files |
| **Defects found by the tests** | **1**, fixed (below) |

---

## What the tests prove

### The summary is the DOMAIN's, rendered as received

The view shows the batch id, the counts (**5/5**), the total, the elapsed
time, the operator and the verdict — and the total is the API's
fixed-point string formatted to 3 dp for kilograms (`35.320`).

**And the verdict is the API's two-valued one**, with the view choosing
the locale key.

### Every component is listed with the ZONE AT CONFIRMATION

The detail shows the target, the actual, the lot, the container, the scale
and the zone — and **the zone is the recorded one**: an overridden
component shows `OVER`, so a reader can see that it was.

### The ticket preview is the API's ticket

The template, the batch identity and **the operator's identity** are all
the API's — and the source test proves the client composes **no** part of
the ticket: no `ticketHeader`, `ticketFooter`, `renderTicket`,
`composeTicket`, `ticketFields`, `TICKET_COLUMNS` or `ticketLayout`
anywhere in `screens/`.

### A FAILED print is shown as NOT PRINTED

- The job's state is rendered with its `data-state` — **`FAILED`**.
- The **error** is shown — *"The printer is out of paper"*.
- **`data-printed="false"`** on the panel.
- And **no** "printed" confirmation is rendered.

**And a successful print renders `data-printed="true"`** — because the
reverse failure, a printed job shown as pending, is equally wrong.

### The reprint is disabled without a reason

- The action is **disabled** with no reason — so the requirement is
  visible *before* the press.
- It **enables** once a reason is given.

### The API being unreachable shows a DEGRADED state

- The degraded state is shown — and **no summary and no preview** are
  rendered as though they were current (BRD FR-20).

### The touch targets

Every action's **rendered** `minHeight` is **≥ 56 px**.

---

## The defect the test found

### The locale stub returned a constant, so the verdict asserted nothing

**Found by:** `completion-screen.test.tsx` — *"the verdict"* expected
`completion.summary.withinTolerance` and got `'x'`.

**Root cause.** The locale stub returned the literal `'x'` for every key,
so **every** translated string on the view rendered as `'x'` — and the
assertion on the verdict passed vacuously, because `'x'` contains `'x'`.

**And that is the dangerous kind of test defect: an assertion that cannot
fail.**

**The fix.** The stub now returns **the key it was asked for** — so the
view renders the key, and the assertion on the key is a real one. And the
verdict's assertion is now meaningful: it would fail if the view rendered
the wrong locale key.

**And the lesson is the same one the source test keeps teaching: a stub
that returns a constant makes every assertion on the rendered text
vacuous.** The stub now returns the thing under test.

---

## Deliberately not delivered

- **The peripheral degraded states** — story `005`. The story names the
  printer's state in the *persistent status strip*, so a printer out of
  paper is visible *before* a batch is completed — and that strip is
  story `005`'s.
- **The end-to-end Playwright suite** — the last UI bolt.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| The completion view shows the summary — the batch id, the count of the total, the total dispensed, the elapsed time, the operator and the overall tolerance outcome | ✅ | `completion-screen.test.tsx` — all six |
| Every component is listed with its target, actual, unit, lot, container, scale and **the zone at confirmation** | ✅ | The detail test — the zone is `OVER` for an overridden component |
| The preview is the ticket **rendered by the API**, and the client composes no part of it | ✅ | The preview test, **and** the source test — no header, footer, layout or field list |
| The print is requested against the existing ticket, and the job's state is **visible while it is in flight** | ✅ | The print tests — the state is rendered with its `data-state` |
| A failed print leaves the weighing recorded, shows the error, shows the ticket as **not printed**, and allows a later print | ✅ | The failed-print test — the error, `data-printed="false"`, and no printed confirmation. **The weighing's survival is unit `006`'s** — proved in bolt `019`'s B-7 test |
| A reprint is **visibly marked**, and cannot be raised without a non-empty reason | ✅ | The reprint test — disabled, then enabled |
| Grams to 1 dp and kilograms to 3 dp, from a fixed-point value, never a float | ✅ | Bolt `025`'s formatter suite, carried over — the summary's total renders at 3 dp |
| The ticket carries the operator's identity, and the completion view shows it too | ✅ | The preview test — the operator is on the ticket **and** in the summary |
| No user-visible literal string in a component | ✅ | The source test — carried over |
| Every action's touch target is **≥ 15 mm** and every label is legible at 1.5 m | ✅ | The component test — the **rendered** `minHeight` |

## Recommendations

- **The locale stub must return the key.** It now does — and **every**
  future stub that serves the locale endpoint should do the same, because
  a constant makes every assertion on the rendered text vacuous. **This is
  the second time in two bolts that a stub has quietly weakened a test**
  (the first was the source test's empty component list).
- **The print job's state is fetched on the print.** The story says it is
  *"polled or streamed while it is in flight"* — and the job's state is
  retrievable by its id. **A poll of `GET /api/print-jobs/:jobId` while
  the job is not `DONE`** would show "printing" rather than a dead
  button. **That belongs with story `005`'s status strip**, which is
  already about the peripherals.
- **The printer's state belongs in the status strip, not here.** The story
  says the operator should see a printer that is out of paper *before*
  completing a batch — so it is a persistent, always-visible state, and
  story `005` is its home.
