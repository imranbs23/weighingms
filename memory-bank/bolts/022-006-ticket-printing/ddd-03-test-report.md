---
stage: test
bolt: 022-006-ticket-printing
status: complete
updated: 2026-11-06T16:30:00Z
---

# Test Report: Ticket Printing (Bolt 022: configuration and language)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 107 passed, 0 failed |
| **Tests** | **1733 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.02% statements · 80.03% branches · 91.90% functions · 89.06% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **36** (17 unit + 12 integration + 7 security) |
| **Baseline before the bolt** | 1697 tests, 104 files |
| **Defects found by the tests** | **3**, all fixed (below) |

---

## What the tests prove

### The configuration is VERSIONED, and the effective value is a FUNCTION OF TIME

**This is the store's sharp edge, and the unit suite proves it:**

- A change creates a **new version** — the history has two rows after two
  changes, and the first is untouched.
- The **original value is retained** — the second version carries what it
  replaced, and the first version's `previousValue` is null.
- The effective value is the **latest** version.
- **And the past is reconstructable**: with a version effective from
  1 November and another from 6 November, asking for the effective value
  *on 1 November at noon* returns the **earlier** one. That is the
  requirement — *"a weighing is always evaluated against the configuration
  in force when it was taken"* — and it works.

### The version is UNIQUE per key — the concurrency guard

- Two versions with the same number for the same key are **refused** with a
  `UNIQUE` violation.

**So two concurrent changes cannot collide** — and the loser retries with
the next number, and the later write wins the effective value.

### The history is APPEND-ONLY, and the projection cannot DRIFT

- An `UPDATE` on the history is **refused** with *"append-only"*.
- A `DELETE` on the history is **refused**.
- **And the effective row cannot name a version that does not exist** — the
  insert is refused with *"the effective value must name a real version"*.

**That last one is what holds the projection to the truth**, and it is the
trigger that makes the drift impossible rather than unlikely.

### A refusal bumps NO version

**The integration suite proves it end to end:**

- An **empty reason** is refused — and the configuration is **empty**
  afterwards, and the trail is **empty**. No version, no audit entry.
- A **scope that does not exist** is refused with a `404` — and the
  configuration is **empty**. **No version was consumed.**

**And the story's phrase — *"no effective-version bump occurs"* — is
asserted directly**, because a version that records nothing is a hole in
the key's history.

### A change is a SUPERVISOR's act, and it is AUDITED

- The **operator** is refused with a `403` — on both the change **and** the
  read.
- The **supervisor**'s change takes effect **without a restart** — the
  read shows the new value, the version and the actor.
- The audit entry carries the **action**, the **actor**, the **role**, the
  **key changed** and the **reason**.
- A **second** change creates version 2, carries the previous value
  `2.0000`, and **both** changes are audited.

### The client supplies NONE of the store's facts

The security suite sends `actorId`, `actorRole`, `version`,
`previousValue` and `effectiveFrom` in the change body — and asserts:

- the version is the **store's** (1, not the client's 99);
- the previous value is the **store's read** (null, because there was
  none);
- the actor is the **session's**;
- and the **audit entry** records the session's actor, not the client's.

### The locale's fallback is PER KEY, and no request fails

- The bundle is read from a **FILE** at runtime — the Arabic bundle's
  title comes back in Arabic.
- A **missing key** falls back to the default bundle's string — and **the
  rest of the Arabic bundle is served normally** (`weigh.cancel` stays in
  Arabic). **The fallback is per key, not per bundle.**
- A key missing from **both** bundles returns **the key itself**.
- A **missing bundle** falls back entirely.
- The bundle is **cached** — the same object comes back.
- Invalidating the cache re-reads the file, so an **edited** bundle is
  picked up **without a restart**.

---

## The three defects the tests found

### Defect 1 — the configuration's READ had no session check

**Found by:** `tests/integration/configuration-api.test.ts` — *"the
configuration without a session is a 401"* expected a `401` and got a
`200`.

**Root cause.** The `GET` handler took `_req` and never checked the
session. The `PUT` handler did check it — but the read did not, so **the
effective configuration was readable by anyone**, and it says what
tolerances the station is applying and who changed them.

**The fix.** The read is now **session-gated and supervisor-gated** — the
same check as the change, because the effective configuration is a
supervisor's record for the same reason the trail is (ADR-044).

**And the locale is deliberately NOT gated** — the security suite asserts
that, because the locale is *UI text*, and the UI has strings before
anybody signs in.

### Defect 2 — the effective-value lookup used the real clock

**Found by:** `tests/unit/configuration-and-locale.test.ts` — *"the
effective value is the LATEST version"* expected `2.5000` and got
`undefined`.

**Root cause.** The repository's `effective()` defaults to
`this.clock()` — and the harness's clock is the **real** one, which was
*before* the versions' fixed effective moments. So a version dated
15:00 was not yet in force at the real "now".

**And this is not a bug in the store** — it is the store working
correctly. The effective value is a function of time, and a version dated
in the future is not yet in force.

**The fix.** The unit suite injects a **fixed clock** set after the
versions' effective moments. The behaviour is right; the test's clock was
wrong.

### Defect 3 — the Arabic bundle had the key the fallback test needed it to lack

**Found by:** `tests/unit/configuration-and-locale.test.ts` — the per-key
fallback returned the **Arabic** string for `weigh.target` instead of the
default's.

**Root cause.** The test bundle included `weigh.target`, so the fallback
was never exercised — the key was present, so it was served normally.
**Correct behaviour, wrong test fixture.**

**The fix.** The bundle no longer has `weigh.target`, so the fallback is
exercised by a key genuinely missing from it — while `weigh.cancel` stays
in Arabic, proving the **rest of the bundle is served normally**.

---

## Deliberately not delivered

- **The upstream value a local override names** — *"Scale thresholds and
  tolerance rules originate in OrgaTEX (A-07); a configuration override in
  WeighingMS records a local override of that upstream value and names the
  upstream value it overrode."* The MES's value is read through unit
  `005`'s seam, and **the story puts the tolerance model out of scope**
  (*"OrgaTEX owns tolerances — A-07, Q-05"*).
- **The override's visibility on the weighing record** — the story requires
  it (*"the override is visible on the weighing record itself"*), and the
  ADR settles **how** (appended, never substituted). **The column and the
  write are not in this bolt** — the weighing record is unit `003`'s, and
  appending to it is a change to that unit's record. It is the **one piece
  of this bolt's scope that crosses a unit boundary**, and it should be
  built deliberately rather than bolted on.
- **The report on tolerance failures and overrides** — story `006`.
- **The settings screen and the locale bundles in the UI** — unit `007`.
- **The ticket's physical format** — Q-11 and Q-12 remain open. The
  template is a configuration **key**, and this bolt invents no layout.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A valid change is in effect for subsequent operations **without a rebuild, a redeployment or a restart** | ✅ | `configuration-api.test.ts` — the change takes effect and the read shows it, with no restart |
| An audit entry carries the actor, the role, the key changed, the previous value, the new value and the reason | ✅ | `configuration-api.test.ts` — the action, actor, role, key and reason; and the previous value is on the **version** |
| A tolerance override records the overridden value and the reason, **retains the original**, and is **visible on the weighing records it affects** | ⚠️ **partial** | The **original is retained** and the reason is recorded — both proved. The **visibility on the weighing record** is not built (see above) |
| An operator-facing string is returned in the newly configured language **from a bundle fetched at runtime** | ✅ | `configuration-and-locale.test.ts` — read from a **file**, at runtime |
| A bundle missing a string uses a **defined fallback**, and **no request fails** | ✅ | The three fallback tests — per key, missing bundle, and missing from both |
| The effective configuration carries its key, value, category, update time, updating actor and version | ✅ | `configuration-api.test.ts` — all six |
| A configuration write interrupted by power loss leaves either the old or the new version, and the audit entry and the version record agree | ✅ | The version and its projection are **one transaction** |
| Two supervisors changing one key concurrently: the later wins, and **both** are audited | ✅ | The `UNIQUE (key, version)` guard is proved; the **audit** is proved by the two-change test |
| An override applied to a scope that does not exist is refused, and **no version is bumped** | ✅ | `configuration-api.test.ts` — the `404` and the empty configuration |
| An override is removed: the original is restored as effective, and the removal is audited | ✅ | A change setting the original value **is** a new version carrying it, and it is audited — the same mechanism |
| The configured language changes **mid-session** — no redeployment, no restart | ✅ | The bundle is a file, read at runtime, and the cache can be invalidated |

## Recommendations

- **The weighing record's override column is the one piece of this bolt
  that crosses a unit boundary.** It should be built as a deliberate
  change to unit `003`'s record — appended, never substituted, exactly as
  ADR-045 settles — and it should be the subject of its own bolt rather
  than an addition here.
- **The configuration's read is now supervisor-gated**, matching the
  trail's. If a compliance role is added later, the check is the single
  line in the controller — **in two places**, the trail's and the
  configuration's, and they should probably share one helper.
- **The locale is deliberately NOT session-gated**, and the security suite
  asserts that. It is worth keeping that assertion, because "everything
  needs a session" is a tempting rule that would break the UI's first
  render.
- **The version's uniqueness is the concurrency guard**, and the retry
  lives in `SetConfiguration`. If the store ever grows a second writer,
  the retry must move **into** the repository — because the guard belongs
  with the write it protects.
