---
stage: test
bolt: 029-007-weighingms-ui
created: 2026-11-11T12:50:00Z
---

## Test Report: weighingms-ui

### Summary

- **Tests**: 1914/1914 passed. The full suite gave 126 files and 1913 tests; the UI suite run after the last fix gave 136/136, including the newest test.
- **Typecheck**: server and client clean
- **End to end**: the running app, driven through its UI alone by Playwright, completes B-24187 (5 components, 3 kg → 32 kg scale switch, OrgaTEX `CONFIRMED`, ticket printed)
- **Coverage**: not measured in this stage (`npm run test:coverage` exists); every acceptance criterion below has a named test or the Playwright run

### Test Files

- [x] `tests/integration/terminal-workflow-api.test.ts` - **new, 18 tests.** Starting a batch:
  - binds the first component's scale
  - starting again continues the same session
  - a batch with no loaded recipe is refused
  - starting requires a session

  Progression:
  - an advancing confirm binds the next component, and Sodium Sulphate gets `SCALE-B`
  - a completed batch's session is never continued
  - a new component starts from an empty platform

  Training dispense:
  - pours the recipe's target
  - overshoot lands OVER and the confirm is refused `ZONE_OVER`
  - nothing to pour without an active component
  - an invalid landing is a 400

  Re-tare:
  - zeroes the net reading
  - a dispense after a re-tare still lands in tolerance
  - an unknown scale is a 404

  Peripherals:
  - `source: DUMMY`
  - idle scales stay `UP` with the keep-alive
  - scanner READY / DISCONNECTED
  - printer READY / UNAVAILABLE with its reason
- [x] `tests/unit/weighing-session-current.test.ts` - **new, 2 tests.** The current session is the most recently started; updating an older one does not make it current again.
- [x] `tests/ui/terminal-workflow.test.tsx` - **new, 19 tests.** Workflow store:
  - a batch opens only after the recipe and the start, in that order
  - another batch in progress keeps the operator on the queue with the reason
  - a COMPLETE session opens the completion view on sign-in
  - an unfinished session is resumed
  - the completion view follows only the station's completion
  - Quit keeps the batch

  Function keys:
  - F1 / F2 / F4 call the same handlers as the buttons
  - F1 does nothing while confirm is disabled
  - every key shows its F-key and meets the 56 px touch target
  - Next batch is on F3

  Strip:
  - a CONNECTED scale is healthy and shown READY by label
  - scanner and printer entries
  - locale and clock

  Weigh view:
  - the rail is the recipe's names and targets with the session's states
  - the training bar sends only the landing
  - a gram stream on a kilogram component reads in kg
  - no training bar for a real device

  Code 128:
  - symbol width
  - modulo-103 check character
  - refuses non-code-set-B characters
- [x] `tests/integration/batch-summary-api.test.ts`, `ticket-api.test.ts`, `reprint-api.test.ts` - **changed**: run on a 20 ms sample clock (as `scale-stream.test.ts` does), because each component is now poured from an empty platform and a whole batch at 100 ms outran the 30 s timeout.
- [x] `tests/ui/completion-screen.test.tsx` - **changed**: the elapsed time is asserted in the prototype's form ("30 min 40 s" for 1840 s).
- [x] `playwright/step28-capture.spec.ts` - the Step 28 capture, which is also the end-to-end check of this bolt. (The workbook's Step 29 suite is the next piece of work.)

### Acceptance Criteria Validation

- ✅ **Selecting B-24187 opens the weigh view with five components and the first active**: Playwright run; `starting a batch` tests
- ✅ **Simulate dispense → in tolerance → confirm enabled → advances**: Playwright run (all five); `the progression` tests
- ✅ **Yellow RGB on 3 kg, Sodium Sulphate on 32 kg, badge and units change**: `screen-2-app.png`, `screen-2-app-32kg.png`; the `SCALE-B` binding test; the gram/kilogram readout test
- ✅ **Simulate overshoot → OVER, confirm disabled**: `OVERSHOOT lands OVER` test (409 `ZONE_OVER`); the surplus proposal is requested once the reading rests
- ✅ **Re-tare zeroes; Quit returns without a record; F-keys = buttons**: re-tare tests; the Quit store test; the function-key tests
- ✅ **Fifth confirm completes the batch, OrgaTEX holds the record, CONFIRMED shown**: Playwright run asserts `summary-write-back` CONFIRMED; the completed-batch test asserts `writeBack: CONFIRMED`
- ✅ **Print produces the ticket; Next batch returns to the queue**: Playwright run (print job shown); F3 test; a completed session is not continued
- ✅ **Idle scales READY; strip shows scanner, printer, OrgaTEX, locale, clock**: keep-alive test; strip tests; every screenshot's strip
- ✅ **Layout matches the prototype's structure**: `evidence/STEP-28-ui-validation/` side-by-side screenshots, `validation.md` (PASSED)
- ✅ **Typecheck clean, existing tests pass, new tests cover the items**: see Summary
- ✅ **Step 28 re-run with app screenshots for all three screens**: done

### Issues Found

Found by the new tests and the screenshots in this stage, and fixed:

1. **Session ids could collide.** Ids were the start time in base 36, so two sessions started in the same millisecond (always, under the harness's test clock) shared one, and the second's upsert would overwrite the first's row, which its weighing records refer to. Ids now carry a random suffix (`select-component.ts`). Found by the completed-batch test.
2. **Mixed units on the 32 kg scale.** The live cell showed the device's grams ("23995.9") beside kilogram targets labelled "g". When the stream's unit differs from the component's, the readout now shows the station's converted value in the component's unit (`WeighScreen.tsx`). Found in `screen-2-app-32kg.png`.

### Notes

- Overshoot is shown and blocked but not resolved: the confirm gate refuses OVER unconditionally, and the recovery in this bolt is Re-tare and pour again. The surplus business rule is the workbook's Step 24 decision.
- Lot and container are absent from the weigh-head for B-24187 because no lot capture or container assignment happens in this flow.
