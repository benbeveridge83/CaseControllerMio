# E-Filing Mount (V326)

Mounts the mock-only e-filing panel into the matter dashboard.

## What changed

- `mio-v326-efiling-mount.js` — Vite transform that injects the panel mount into
  `src/App.jsx` (matter dashboard, Filings tab).
- `src/efiling/mioEfilingRuntime.js` — wires the mock provider and the in-memory
  repository together and resolves the feature flags.
- `tests/efiling-mount.test.js` — unit tests for the runtime and the transform.
- `vite.config.js` — registers the transform.

## Safety

- Mock provider + in-memory repository only. Tyler is never constructed or called.
- Stage and Production submission remain disabled (`TYLER_EFM_STAGE_ENABLED` and
  `TYLER_EFM_PRODUCTION_ENABLED` default to `false`).
- Gated behind `EFILING_ENABLED` (defaults to `true` for the mock-only workflow;
  set `VITE_EFILING_ENABLED=false` to hide the panel).

## Manual test

`node --test tests/mio-efiling-*.test.js tests/efiling-mount.test.js`, then open the
matter dashboard → Filings tab. The panel shows the "Mock provider — no live filing
occurs" label and the Stage/Production submit buttons are disabled.
