# INTERVAL — local performance verification

2026-10-09 UTC. Measurements describe local compiled artifacts and automated checks.

## Scope and preserved behavior

The comparison uses the same home/rules/scenario inputs before and after optimization.

Rules, target sets, prices, lifetimes, match limits, CPU choices/search strength, validation, API requests, polling cadence, room schema and access are preserved. `src/game/rules.ts` and both CPU source files are byte-identical to that baseline. The `applyAction` implementation is also byte-identical. Preview analysis now exposes the already validated simulation for reuse; it does not skip action validation.

## Changes and measurements

Measurements use the same inputs before and after. Byte counts are compiled artifacts; renderer counts use real Three.js scenes/cameras/models with only the unavailable WebGL renderer replaced by a counter. They are not phone FPS, measured network latency or GPU-time measurements.

| Scope | Before | After |
| --- | ---: | ---: |
| Initial entry JavaScript | 631,018 bytes | 59,606 bytes |
| Initial entry gzip, Node gzipSync with identical settings | 166,229 bytes | 21,548 bytes |
| 3D renderer submissions, initial/static-state render | 3 | 1 |
| 3D renderer submissions, start transition | 5 | 1 |
| 3D renderer submissions, resize during animation | 2 | 1 |
| Empty pass, scheduled animation callbacks / timers | 1 / 1 | 0 / 0 |
| One-track 2D frame, whole-board DOM scans | 2 | 0 |
| One-track 3D frame, projected-label scans | 1 | 0 |
| Ten unchanged online polls, UI notifications | 10 | 0 |
| Same online fixture, total network calls including setup | 12 | 12 |
| Confirmation preview plus tactical warning, action validations | 2 | 1 |
| Online history plus animation, transition recoveries | 2 | 1 |

- Initial JavaScript bytes drop 90.55%. Home and explicit 2D play do not evaluate the 3D module. A requested 3D game keeps a usable 2D board while loading, then preserves the latest position, selection and keyboard square when upgrading.
- The deferred 3D chunk remains 573,797 bytes; total entry + 3D is 633,403 bytes, slightly above the former single entry. This is deferred loading, not a claim that the full Three.js dependency was made smaller. The existing over-500-kB Vite advisory remains for that optional chunk.
- Drawing buffers resize only when width or pixel ratio changes. Quality switches and real size changes still update them.
- Empty passes no longer run an empty 580-ms animation. Passes with expiry, captures, wins and other visible effects retain their original timing.
- Keyed DOM lookups remove frame-by-frame scans while still refreshing cached nodes after public renders, markup replacement, resize and cancellation.
- Every online response is still fetched and validated at the original cadence. A complete exposed-state snapshot suppresses only identical UI notifications; error recovery, pending receipts, busy state and same-version changed data still notify.
- Selected-piece target projection uses the same authoritative piece actions without allocating unrelated summons. A warmed synthetic Node benchmark (five samples × 10,000 calls, 1,000-call warmup) measured median 0.04163 → 0.00416 ms/call. Summon generation intentionally remains unchanged. This microbenchmark does not measure whole-app responsiveness.

## Regression coverage

Seven performance suites add 46 tests for lazy imports, scene submissions, empty animation scheduling, DOM scans, notification counts and reused action calculations. Additional cases cover slow or rejected loads, rapid view changes, home/resume, room exit, stale callbacks, selection, keyboard focus, first-render cues, resize, reduced motion, expiry and disposal.

The current full suite passes 4,258 tests across 46 files. `npm run build` passes TypeScript, client and Worker builds, and asset packaging. The final initial entry is approximately 60 kB after subsequent lifecycle corrections; the optional 3D chunk remains approximately 574 kB.

## Limits

These figures do not measure actual phone responsiveness, WebGL output, GPU memory, battery use or browser frame rate. The reported physical-phone freeze is not proven resolved. No CPU-search, network-cadence or game-rule change is included in the optimization measurements.
