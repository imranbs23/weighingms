# FR reference convention — READ BEFORE WRITING OR EDITTING ANY STORY

WeighingMS carries **two different sets of functional requirements**, and they
use **different numbering formats**. Confusing them is the single most likely
way to introduce a silent traceability defect.

| Set | Format | Range | Source of truth | Example |
|---|---|---|---|---|
| **Our own** requirements | `FR-1` … `FR-23` (**no leading zero**) | 23 | `requirements.md` | `FR-9`, `FR-19`, `FR-23` |
| **The BRD's** requirements | `FR-01` … `FR-37` (**zero-padded**) | 37 | `docs/brief.md` | `BRD FR-09`, `BRD FR-23` |

`requirements.md` already disambiguates by **always writing `BRD FR-xx`** when
it cites the BRD's set. **The stories must do the same.**

## The rule

- When you cite **our own** requirement, write it bare: `FR-9`.
- When you cite **the BRD's** requirement, **always** prefix it: `BRD FR-09`.

Never write a bare zero-padded `FR-09`. It is ambiguous with our own `FR-9`
and a reviewer cannot tell which set you meant.

## Other prefixes in use

- `BRD BR-nn` — a BRD **business rule** (the BRD also has a BR register).
- `BRD IR-nn` — a BRD **integration requirement**.
- `BRD NFR-nn` — a BRD **non-functional requirement**.
- `NFR-n` — **our own** non-functional requirement group (unpadded, as in
  `requirements.md`).
- `AC-nn` — **our own** acceptance criterion.
- `C-nn` — a **confirmed requirement** from `requirements.md`.
- `A-nn` — an **assumption** from `requirements.md`.
- `Q-nn` — a **BRD-sourced** open question.
- `PQ-nn` — a **prototype-sourced** open question.
- `CQ-nn` — a **context-sourced** open question.

## Example

> - [ ] **Given** the zone is `OK`, **When** the operator confirms, **Then** a
>   `WeighingRecord` is written with the zone at confirmation (`OK`)
>   (FR-10, BRD FR-13, BRD BR-11, AC-07).

That reads as: our FR-10 (confirmation gating), the BRD's FR-13 (confirmation
recording), the BRD's business rule 11, and our acceptance criterion 7.
