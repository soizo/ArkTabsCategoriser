# Streaming and background task lifecycle

- [x] Reproduce duplicated reasoning fields and inspect timeout/port lifetime.
- [x] User approved: 120-second inactivity timeout, reconnectable singleton background task pinned to its original window, explicit cancellation before commit, temporary keepalive, session-only summaries, and contextual model statuses.
- [x] Add failing regressions and fix stream selection, idle deadlines, cancellation, and cleanup.
- [x] Add background state/reconnect/stop, session recovery, window pinning, and tests.
- [x] Update popup/options statuses and EN/ZH copy; verify browser interactions.
- [x] Run full verification, review focused diff, and update operating documentation.
  - `npm run verify && git diff --check`: 206 tests across 17 files, typecheck, and Chrome production build passed.
  - `tests/task-ui.browser.js` passed: contextual load/test/error feedback, separate save status, permission/provider race, reopen/reconnect without another start, reasoning replay and elapsed time, Stop, commit lock, completion replay, EN/ZH, keyboard focus, 44px targets, and narrow layouts.
  - Existing `tests/options.browser.js` passed again, preserving prompt migration, Knowledge, copy, restore, and save behavior.
  - Viewport inspection confirmed readable Chinese model feedback at 320px and a visible, keyboard-focused Stop button within the popup's first 600px.
  - Session diagnostics reported no blocking errors. No live provider calls or real extension settings were used; Chrome's actual worker-termination policy is not simulated by the UI harness.

# Categorisation response recovery

- [x] Inspect the shared parser, provider callers, tests, and recent history.
- [x] Clarify extraction ambiguity, diff format, repair scope, and retry limits with the user.
  - Extract raw JSON, fenced or `---`-delimited JSON, and JSON surrounded by prose.
  - Accept only one distinct fully valid result; model may select a candidate by ID to resolve ambiguity.
  - Repair syntax and schema/tab-ID errors using exact, uniquely matching search/replace edits; revalidate afterward.
  - Allow incomplete JSON with recognisable categorisation structure; fail immediately when no repairable candidate exists.
  - Allow at most two additional model calls per batch, including disambiguation and failed patches.
  - Original decision: each call had a 60-second timeout. Superseded by the approved 120-second inactivity policy above.
- [x] Present the bounded design and regression-test coverage in chat.
- [x] Obtain explicit design approval before implementation.
- [x] Implement test-first and run relevant verification.
  - Failing regression baselines reproduced extraction, recovery, timeout, and repair-edge defects before their fixes.
  - `npm run verify`: 185 tests passed across 13 files; typecheck and Chrome production build passed.
  - Primary language diagnostics and session blocking-error checks passed; `git diff --check` passed.
  - Provider requests were mocked; no paid/live-model calls were made.
  - Implementation and operating limits are documented in `README.md`.

## Prompt requirements and Knowledge

- [x] Inspect the current global prompt settings, persistence, and options controls.
- [x] Clarify the three-part prompt model with the user.
  - Editable classification requirements, prefilled with default classification rules.
  - Optional free-text Knowledge for domains, terminology, and background.
  - Read-only, copyable final prompt preview, updated from both inputs.
  - Precedence: application constraints > classification requirements > Knowledge.
- [x] Present the bounded design and verification scope in chat.
- [x] Obtain explicit design approval before implementation.
- [x] Implement with regression coverage for persistence/migration, prompt composition, and options interactions; run relevant verification.
  - `npm run verify`: 194 tests across 14 files, typecheck, and Chrome production build passed; `git diff --check` passed.
  - `tests/options.browser.js` passed in a local built page with mocked extension APIs and clipboard: migration, live preview, shared drafts, copy/failure, restore, blank-input rejection, save/reload/clear, EN/ZH, keyboard focus, 44px targets, and 320px overflow.
  - Visual viewport checks confirmed the existing design at desktop and mobile widths; measured prompt labels, controls, and help text exceeded 4.5:1 contrast (minimum 5.83:1).
  - Mechanical UI detector was degraded to regex because optional parser modules were unavailable; native browser measurements and visual checks supplied the relevant evidence instead.
  - Runtime batch instructions are a separate application-constraints section, not part of Knowledge.
  - No live model requests or real extension settings were used in verification. Temporary preview server stopped.
