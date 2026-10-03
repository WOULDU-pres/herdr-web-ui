# Native chat session binding

Captured from an isolated Herdr session, synthetic Claude native records, the real
HTTP backend and the built React client. No model request or live-user pane write.

- `desktop.png`: 1280 x 800, hookless Claude pane 1.
- `mobile.png`: 390 x 844, hookless Claude pane 2 in the same directory.
- Each pane displays only its own native conversation, without the terminal fallback.
- Capture backend: Bun 1.4 Chrome-backed WebView.

The source commit is 2939c8d, based on origin/main bb7ef50.
Generated types, typecheck, build, unit tests (1085 pass, 3 skip), clean-environment
integration tests (182 pass), final focused tests (37 pass), remote bundle build and
real isolated SSH integration passed.

An inherited personal OMO/SENPI agent-directory setting caused an existing OmO holder
test to fail on both this branch and untouched main. It passed when those personal
settings were unset for the isolated suite; the OmO test was not changed.
