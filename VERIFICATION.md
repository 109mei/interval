# INTERVAL verification

## Current release checks

2026-10-09 UTC. `npm test` passes 4,258 tests across 46 files. `npm run build` passes TypeScript, client and Worker builds, and asset packaging. The optional 3D bundle retains the existing over-500-kB advisory.

## Behavior covered

- A plain URL opens the home screen. CPU and shared-device play require an explicit Start; invitations require Join confirmation. Existing room URLs retain authenticated recovery.
- New games contain only the two fixed cores. Summons are restricted to the owner's three ranks; the central rank is excluded. Existing persisted room positions are preserved.
- Lifetime labels use turns, with the piece owner's turns counted. Newborn pieces retain their purchased lifetime on the summon turn.
- Local and CPU games can pause at home and resume during the same page session. Stale CPU replies, room responses and rendering callbacks cannot replace the active session or board.
- Error cleanup releases busy locks. Recovery retains uncertain receipts for the correct room and does not replay them into another room.
- The 3D module loads only when requested. A usable 2D board remains available during loading, with the current position, selection and keyboard square preserved through upgrade or fallback.
- Tests cover legal actions, exact costs and expiry, CPU choices, API validation, repeated inputs, focus, accessibility labels, motion cancellation, disposal and mocked-network recovery.

## Reproducible coverage

- [30 scenario groups](docs/REVIEW-30-CYCLES.md)
- [500 additional automated scenarios](docs/REVIEW-500-SCENARIOS.md)
- [Performance measurements](docs/PERFORMANCE.md)
- [200 post-optimization scenarios](docs/REVIEW-200-SCENARIOS.md)
- [Synthetic player perspectives](docs/PERSONA-QA.md)

The scenario counts are distinct from reruns, assertion counts, manual playthroughs and publications. Named test contracts are included with the tests.

## Evidence limits

These checks do not prove that the reported physical-phone freeze is resolved. Physical touch, actual WebGL/GPU output or frame rate, exact 390×844 layout, native screen-reader speech and simultaneous independent production friend sessions remain unverified. DOM, CPU-scene and mocked-network checks are not human research. Browser observations apply only to the specific published version actually inspected.

No P2P or STUN/TURN service, new paid service, asset purchase, schema migration or audience change is part of this release.
