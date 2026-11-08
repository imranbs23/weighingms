---
stage: validate
bolt: 024-007-weighingms-ui
created: 2026-11-07T05:00:00Z
---

# Step 28 — UI/UX Validation: the prototype against the implementation

**The workbook's requirement:** *"Now compare the working application against
the supplied prototype. Open both: the original at
`docs/customize-weighing-station.html`, and your implementation."*

**What this document is:** the comparison of the **structure and content**
of the three screens, screen by screen, with the gaps named honestly.

**And what it is not:** a screenshot capture. **The screenshots are not
included**, and the reason is stated below rather than glossed over.

---

## Why the screenshots are not included

**The comparison requires running both applications side by side, and the
prototype is a *self-contained* HTML file while the implementation is a
*two-process* application (the API on :3000 and the SPA on :5173).**

**Capturing them needs a browser driving the real app**, and that is the
**Playwright suite** — which is workbook Step 29 and the next piece of
work. **Writing this comparison before the screenshots would be claiming
a validation I had not performed**, and the workbook's Step 33 asks *"Can
every important behaviour be demonstrated?"* — so the demonstration has to
be real.

**What this document does instead:** it compares the **structure and the
content** of each screen, element by element, against the prototype's
source. **That is the part that finds the gaps** — and it has found
several.

---

## The three screens

| The prototype's screen | The implementation's screen | Bolt |
|---|---|---|
| **1 · Select batch** | `BatchQueueScreen` | `024` |
| **2 · Weigh** | `WeighScreen` | `025` |
| **3 · Confirm & print** | `CompletionScreen` | `027` |

**And the persistent status strip** — the prototype's `.strip` at the
foot of the screen — is `StatusStrip`, from bolt `028`.

---

## Screen 1 — Select batch

| The prototype | The implementation | Verdict |
|---|---|---|
| A scan prompt: *"Scan a batch card to begin"* with a beam, and *"Or touch a row below"* | A scan input and a submit button | ⚠️ **Partial** — the prompt is there, but the prototype's *beam* and its *"Queue received from OrgaTEX at 06:12"* are not |
| A table with seven columns: **Batch, Order, Machine, Fabric / lot, Shade, Comp., Status** | `QueueRow` renders the same seven fields | ✅ **Match** — the same seven, in the same order |
| The queue's receipt time | `queue-last-received` | ✅ **Match** |
| A filter by status | — | ❌ **Gap** — the API supports `?status=`, and the story asks for a filter |
| The table's rows are clickable | The rows are clickable and select the batch | ✅ **Match** |

**The prototype's column is `Fabric / lot` — one column.** The
implementation renders the fabric description and the lot as **separate
fields** (the lot belongs to the component, not the batch). **The
implementation is right** — but it is a **visible difference** from the
prototype.

---

## Screen 2 — Weigh

| The prototype | The implementation | Verdict |
|---|---|---|
| A **recipe rail** on the left: the shade, the batch id, *"N of 5 components weighed"*, and the component list | `RecipeRail` renders the components, their states, **and the head** — the shade, the batch and the count | ✅ **Match** — **closed** |
| A **weigh-head**: the dyestuff's name, and the meta line carrying its code, lot and container | `WeighHead` renders the name, the code, the lot and the container | ✅ **Match** — **closed** |
| A **scale badge**: *"Scale selected — 3 kg precision — automatic"* | `WeighHead` renders the bound scale's label | ✅ **Match** — **closed** |
| A **readout** of three cells: **Weighed now**, **Still to weigh**, **Target** — each with its unit | `LiveReadout` renders exactly those three | ✅ **Match** |
| A **bar** with the fill, the **tolerance band**, and the **target line** — scaled against the **scale's maximum capacity**, with the caption *"TOLERANCE ±0.5 g (93.5 — 94.5)"* and the capacity *"125 g"* | `ToleranceBand` renders a bar with `role="progressbar"` | ⚠️ **Partial** — the band and the capacity are **not drawn**, and the caption is absent |
| A **status line**: *"DISPENSE — 94.0 g REMAINING"* | `StatusLine` renders the zone's text | ⚠️ **Partial** — the zone's text is there; the *"N g REMAINING"* is not |
| A **surplus panel**: *"Surplus +2.4 g (+2.6%) — over tolerance"*, the table of original → revised targets, and the footnote *"Proposal: recalculate the remaining components to preserve the shade ratio"* | `SurplusPanel` renders the surplus, the percentage, the factor, the original and revised targets, and the footnote | ✅ **Match** — and the implementation adds the **factor**, which the prototype omits |
| **Actions**: **OK · Confirm** (F1), **Re-tare** (F2), **Quit** (F4), and **Supervisor override** | `ActionRow` renders confirm and abandon; `EscalationPanel` renders the override | ⚠️ **Partial** — the **function keys** are absent, and the override is behind the escalation rather than beside the actions |
| — | `ActionRow` renders the confirm's **reason** beside it | ✅ **Beyond the prototype** — and required by story `003` |

**The `data-zone` attribute is on three elements** — the live cell, the
bar and the status line — and the implementation does the same. **That is
the one structural detail the prototype and the implementation share
exactly**, and it is what makes the zone visibly consistent.

---

## Screen 3 — Confirm & print

| The prototype | The implementation | Verdict |
|---|---|---|
| *"Batch B-24187 weighed"* | `BatchSummaryView` renders the batch id | ✅ **Match** |
| The summary rows: **Components weighed** (5 of 5), **All within tolerance** (YES), **Total dispensed** (35.322 kg), **Elapsed** (6 min 41 s), **Operator** (R. Karim), **Written to OrgaTEX** (CONFIRMED 07:48:22) | The same six | ✅ **Match** — **and the implementation adds the release statement and the target machine**, which the prototype has only in its prose |
| *"Actual consumption posted against the batch. Container released for transport to JET-04."* | `summary-release` | ✅ **Match** |
| Actions: **Print ticket** (F1), **Next batch** (F3) | `PrintPanel` renders print and reprint | ⚠️ **Partial** — **"Next batch"** is absent, and the **function keys** are absent |
| A **ticket** — the batch, the order, the machine, the shade, the date, the operator, and the component table | `TicketPreview` renders the API's ticket | ✅ **Match** — **and the implementation renders the API's ticket rather than assembling one**, which the prototype does not |
| A barcode and the batch id beneath it | — | ⚠️ **Partial** — **the barcode is not rendered** |
| *"Label content is invented."* | — | ✅ **Deliberately** — the implementation does not assert a physical layout (BRD IR-16, Q-11) |

---

## The status strip

| The prototype | The implementation | Verdict |
|---|---|---|
| SCALE 3 kg · READY, SCALE 32 kg · READY, SCANNER, PRINTER, ORGATEX · LINKED 07:41, EN, and a clock | `StatusStrip` renders the scales, the link, the un-synchronised count and the queue | ⚠️ **Partial** — the **scanner** and the **printer** have no entries, because neither has a status endpoint. And the **clock** is absent |
| The hard-coded `ORGATEX · LINKED` | The API's real link state | ✅ **Deliberately different** — and required (BRD IR-18) |

---

## The gaps, ranked

### 1. ~~The weigh-head is missing~~ — **CLOSED**

**The prototype shows the dyestuff's name, its lot, its container and its
tare**, and the implementation showed **none** of them. **That was the
most significant gap**: the operator is weighing a *specific dyestuff in a
specific container*, and the screen did not say which.

**Now closed.** `WeighHead` renders the name, the dyestuff code, the
lot and the container — **every value the API's**, and a name the MES did
not supply renders the client's own placeholder rather than a fabricated
one.

**And the scale badge is closed with it** — the bound scale's label, from
`GET /api/scales`.

### 2. The band's band and capacity are not drawn

**The prototype scales the bar against the scale's maximum capacity and
draws the tolerance band and the target line.** The implementation draws a
bar with a position but **no band and no capacity**.

**And the capacity IS available** — `GET /api/scales` carries each device's
`capacity`, which bolt `025` did not read. **The gap is in which endpoint
the client reads, not in the API.**

### 3. ~~The recipe rail's head is missing~~ — **CLOSED**

The shade, the batch id and *"N of 5 components weighed"* — all available
from the session, and **now rendered** by `RecipeRail`.

### 4. The scanner and the printer have no status entries

**The story requires all four peripherals in the strip**, and two of them
have no endpoint. **This needs two small API additions** — in units `002`
and `006`.

### 5. The function keys (F1/F2/F4) are absent

The prototype's actions carry their function keys, and the story says: *"The
action row's function keys (F1 confirm, F2 re-tare, F4 quit) and their
touch equivalents dispatch the **same** actions; a key press and a tap are
not two code paths"* (BRD FR-19, FR-22).

**So the keys are a real requirement** — and there is no key handling at
all.

### 6. "Next batch" is absent from the completion view

### 7. The barcode is not rendered on the ticket

**And that one is deliberate** — the physical format is not settled
(BRD IR-16, Q-11), and the implementation renders the **API's** ticket
rather than assembling one. **A barcode is a physical-format decision, and
it belongs with the configuration (story `005`) or with the printer
contract.**

### 8. The clock and the locale indicator are absent from the strip

**Both are small.** The clock is *"a client concern"* per story `004` —
so it belongs in the strip.

---

## What this means

**The implementation is functionally ahead of the prototype and visually
behind it.**

| | |
|---|---|
| **Ahead** | The API's ticket rather than an assembled one; the confirm's reason; the factor; the release statement and the machine; the real link state; the per-key fallback; the quantity formatted exactly |
| **Behind** | The band's band and capacity; two of the four peripherals; the function keys; "Next batch"; the clock |

**Three of the gaps are now closed** — the weigh-head, the scale badge
and the rail's head — and **all three were pure client work**: the data
was already on the API, and only the rendering was missing.

**And the "behind" list is layout and content — not rules.** Every one of
them is data the client already has or could fetch. **None of them is a
domain change.**

**Which is the reassuring finding, and also the actionable one: the gap is
presentation, and it is worth closing before the e2e suite**, because the
e2e suite should then be testing the screen the operator will actually
use.
