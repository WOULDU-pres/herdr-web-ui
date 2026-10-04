# PR #368 review-fix evidence

Code: `7750a41ef14a9647b6a8e5e516ad025a5fa27040`, after merging upstream `6992d0a`.

All captures use owned test workspaces in an isolated herdr session. No live user terminal is shown.

- `waiting.png`: a second web bridge waits and offers **Open here**.
- `taken.png`: after the click, the displaced bridge waits and offers **Open here**, with no takeover diagnostic painted.
- `ui-regression.log`: the focused `checkTakeOver` browser check from `scripts/take-over-regression.ts`, followed by browser/server cleanup; process exited **0**. This file now records the focused check, not the full UI suite.
- `races-before.log`: both requested race regressions fail before the fixes.
- `take-over-contract.log`: all five new lifecycle contract tests pass after the fixes.
- `tui-result.json`: real herdr 0.9.3 measurement. An ordinary standalone attach exits 1 when displaced. The concurrent herdr TUI stays alive and displays fresh output from the new attachment. TUI keyboard input was not part of the successful measurement.
- `validation.txt`: suite summaries and limitations, including the full-browser and file-viewer failures. Do not interpret this evidence as a clean full browser suite pass.

Environment: WSL/Linux, Bun 1.4.2, Node 22.23.2 (the bundle-pinned runtime), herdr 0.9.3, Chromium 153. Core commands were `bun run generate:types --check`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:integration`, `bun run build:remote` and `bun run test:ssh`. The focused browser driver creates a temporary state directory and local server, calls `checkTakeOver`, closes the browser/server and removes its state.
