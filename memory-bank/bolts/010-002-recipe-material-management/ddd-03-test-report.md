---
stage: test
bolt: 010-002-recipe-material-management
status: complete
updated: 2026-11-05T23:20:00Z
---

# Test Report: Recipe & Material Management (Bolt 010: the recipe load)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 64 passed, 0 failed |
| **Tests** | **1271 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 92.51% statements · 87.15% branches · 93.88% functions · 93.38% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **70** (35 unit + 7 composition-root + 18 integration + 10 security) |
| **Baseline before the bolt** | 1201 tests, 60 files |
| **Defects found by the tests** | **2**, both fixed (below) |

### Unit 002's own coverage

| Area | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `application/use-cases` | 96.29 | 100 | 75 | 96.29 |
| `domain/entities` | 100 | 100 | 100 | 100 |
| `domain/events` | 0 | 0 | 0 | 0 |
| `domain/services` | 93.54 | 90 | 100 | 96.42 |
| `domain/value-objects` | 87.87 | 93.75 | 78.57 | 90.32 |
| `infrastructure` | 100 | 100 | 100 | 100 |
| `presentation/controllers` | 96.66 | 94.44 | 100 | 96.66 |

---

## What the tests prove

### The seam is the real one

The integration and security suites bind the **real** `RecipeReader` over the
**real** Dummy OrgaTEX — no stub, no fixture. So every component that came
back arrived through the contact, the validation, the reader's cache and the
seam's failure handling.

### The recipe's shape

- The components arrive in **recipe sequence** — and the order is the
  *sequence*, not the order the MES happened to send them.
- **Every quantity is a string.** Never a JSON number.
- An **absent tolerance is `null`** — never a band of zero.
- An **absent name or swatch is `null`** — never a fabricated one.
- The **counter is derived** from the states: `0 of 5` at load.
- Every component starts **`PENDING`**.
- The **freshness is passed through** from unit 005, unchanged.
- Two components with the **same dyestuff code** are both listed — the
  recipe is not de-duplicated.
- A recipe with **zero components** is a `200` with `0 of 0`, not an error.

### The failures are distinguishable

- A batch the MES does not know is a **404** — never a 503.
- An unreachable MES is a **503** whose body has **no `recipe` key at all**,
  so it can never be mistaken for an empty recipe.
- A malformed batch id is a **400**.
- No session is a **401**.

### The read-only rule is structural

There is **no write verb** on `/api/recipe/:batchId`. `POST`, `PUT`, `PATCH`
and `DELETE` all answer `404` — not a "not yet implemented", but a surface
that does not exist.

### The security properties

- The endpoint requires an operator session, and **not** a supervisor —
  reading authorises nothing.
- The **diagnostic never reaches the client**: the 503 body carries the
  reason code and nothing else, and the MES's own error text does not
  appear in it.
- The **swatch cannot carry a style injection**: the prototype concatenates
  the colour into a CSS `background` declaration, so only `#rgb` and
  `#rrggbb` can become a colour at all.
- A **malformed payload is refused whole** — a bad swatch, a
  five-decimal-place target and an exponent-shaped target each fail the
  **entire** read, and no part of it is served.

---

## The two defects the tests found

Both were fixed at the **root cause**, not in the test.

### Defect 1 — a MISSING scale class was an UNKNOWN one

**Found by:** `tests/integration/recipe-api.test.ts` — *"carries the display
facts the MES supplied"*, and then by the typechecker when the edge case
was written.

**Symptom.** The story's edge case says a component missing a scale class
must *"render with an explicit 'scale class unavailable' marker"* — which
means the component is **listed** and carries the absence. But the seam
carried `scaleClass` as a plain `string`, and the reader refused anything
outside the vocabulary. So a component with **no class at all** was
refused by the reader, and the whole recipe failed.

**Root cause.** The seam had one field for two different facts. `null`
meant *"the MES expressed no class"*, and the reader could not tell that
apart from *"the MES expressed a class I do not recognise"* — so it treated
the first as the second and refused it.

**The fix.** The two facts are now separate:

- `RawComponent.scaleClass` is `string | null`. **`null` is MISSING** — the
  component is real, it simply cannot be weighed yet, and it is carried
  through so the rail can say so explicitly.
- A class that is **present** but outside the vocabulary is **UNKNOWN**, and
  it is still **refused**, and the whole read still fails.

The reader gained one method, `buildScaleClass`, and the distinction is now
expressed in the type rather than in a comment.

**Why the refusal still stands.** An *unknown* class is a silent wrong
answer waiting to happen: a component weighed on a device chosen without
the constraint that was supposed to apply. Dropping the constraint is quiet,
and a quiet wrong target is the failure this product exists to prevent. So
the unknown class still fails the whole read — but the **missing** class no
longer does.

### Defect 2 — the Dummy MES's seed recipe carried no display facts

**Found by:** `tests/integration/recipe-api.test.ts` — *"carries the display
facts the MES supplied"*.

**Symptom.** The endpoint returned `name: null` and `swatchColour: null`
for every component, so the rail could never render a name or a swatch.

**Root cause.** The seed recipe in the Dummy MES's world predates the
seam's optional fields. The seam extension was applied to the port, the
entity and the reader, but the **seed data** — the training artefact — was
not updated with it.

**The fix.** The seed recipe now carries the prototype's own names and
colours (`docs/customize-weighing-station.html`, the `components[]` array):
`Remazol Brill. Blue RSPL` / `#1f4fa8`, `Remazol Red RB` / `#b8253a`,
`Remazol Yellow RGB` / `#d9a520`, `Sodium Sulphate` / `#c9d2dc`, and
`Soda Ash` / `#e4eaf0`.

**Why it matters.** The Dummy MES is a **training artefact** — Workbook
Rule 5: *"Do not hard-code fake data directly into the UI. Use APIs."* A
training artefact that teaches the wrong shape teaches the wrong thing to
every future bolt.

---

## Deliberately not delivered

- **The dyestuff master read** (BRD IR-03). The name and the colour are
  modelled as **optional** and carried through when the MES supplies them.
  A separate master read is **bolt 011's** scope — and it would mean a
  second contact and a second cache for one component's display facts
  (ADR-032).
- **The component's `ACTIVE` state.** This bolt sets every component to
  `PENDING`. **Which** component becomes active is unit `003`'s progression
  rule, and this bolt does not decide it.
- **The persistence of anything.** The recipe is not persisted (ADR-031),
  and this bolt writes nothing at all.
- **The recipe's identity in the weighing session.** The BRD's
  `WEIGHING_SESSION` references a `recipe_id`, and the MES's recipes are
  versioned. The seam carries no recipe id or version, so this bolt records
  what the seam gives and does not invent one. Carried to unit `003`.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| The recipe is fetched through the adapter, in recipe sequence | ✅ | `recipe-api.test.ts` — the real seam, the sequence asserted |
| Each component shows swatch, name, code, scale class, target with unit and state | ✅ | `recipe-api.test.ts` — every field asserted; `null` when absent |
| The counter shows the components weighed against the total | ✅ | `recipe-api.test.ts` — `0 of 5`; `recipe-domain.test.ts` — derived, never stored |
| The recipe is read-only | ✅ | `recipe-api.test.ts` + `recipe-security.test.ts` — no write verb exists |
| A failure is distinguishable, and no partial list is served | ✅ | `recipe-security.test.ts` — the 503 has no `recipe` key; a bad payload fails the whole read |
| Displayed within 3 s of the selection | ✅ by construction | One contact, in process, no network hop — `recipe-composition-root.test.ts` asserts exactly one read per load |

## Recommendations

- **Bolt 011** must decide the dyestuff master's home. If it is a separate
  read, ADR-032 is revisited — and the display facts become a **join**, not
  a copy.
- **Unit 003** owns the `ACTIVE` progression and the session's reference to
  the recipe. If it needs a recipe id or a version, the seam must grow
  them — the MES's contract is still unconfirmed (A-01).
- **The freshness window stays unit `005`'s.** If a future bolt wants a
  longer window for the recipe, that is a **second** threshold for one
  question, and ADR-031 refuses it.
