# Verification record

2026-10-07. INTERVAL friend multiplayer release candidate.

## Executed checks
- 93 Vitest unit/integration tests passed across eight files.
- TypeScript check and production client/Worker build passed.
- SQLite-backed API tests run the generated D1 SQL migration and exercise separate host/guest credentials, join races, both-ready start, same-version competing commands, duplicate/replayed commands, altered command rejection, stale state, authoritative rule validation, expiry before cleanup, leave, result preservation, CSRF, malformed/oversized bodies, and unavailable storage.
- Browser-client tests cover monotonic polling versions, hidden-tab polling pause, reconnection, retry with the exact same command ID, and create-response-loss recovery.
- UI DOM tests cover summon, spend, move, pass confirmation, draw, restart, legal placement highlights, and state-preserving 3D-to-2D fallback.

These are executable integration tests, not a substitute for deployed D1/browser tests. The SQLite adapter models D1 batch transactions but is not the production D1 service.

## Browser limitations
The earlier local Chromium launch was denied by the cloud OS socket restriction; the existing cloud browser also rejected the local development URL. Those denied routes were not retried or bypassed. At this checkpoint, real 390×844 layout, touch, GPU rendering and two isolated production browser sessions are not claimed as verified. Any deployed verification is recorded separately in the release handoff.

## Remaining limits
- CPU uses a deterministic root shortlist, all opponent replies for evaluated candidates, and next-turn core-win checks. It is not an exhaustive solver; game balance is not certified.
- Initial client JavaScript includes Three.js (~609 KB, ~160 KB gzip; dedicated CPU worker ~6.3 KB).
- Rooms expire after 24 hours. Clearing the browser cookie loses the seat. Expired database rows are removed in bounded batches as API traffic arrives; there is no scheduled cleanup contract.
- Polling is 1.2–2.5 seconds while visible with backoff; it is not continuous push networking.
- Application rate and room caps mitigate ordinary abuse but do not replace platform-level traffic controls or guarantee unlimited included capacity.
- No names, accounts, chat, directory, third-party analytics, paid API or purchased asset is added.

## Version 2: session history reset
Three regression tests first failed with the previous local match text still present after restart, local/CPU mode changes, and entering a new friend room. A session-scoped display reset fixes those paths while preserving text through same-room polling, including a changed room version. Full 93-test suite and production build pass. The game rules and multiplayer API are unchanged.


## Version 3: play quality and recovery
2026-10-08. The original four pieces, prices, expiry timing, board, server API, schema and room privacy are unchanged.

- First-play wall selection keeps a summon path available. Each purchase explains movement before payment, identifies the exact destination, and previews the summoned piece. Both board renderers label piece roles and remaining lifetime. Result text explains the win/draw condition.
- The interface exposes current core threats and warns when a proposed move permits an immediate core capture. These cues use legal paths after expiry, rather than a guessed attack shape.
- Desktop board dimensions preserve a square; portrait layout caps the board by available height. Waiting rooms prioritize invite and ready controls instead of an inert board. Dialog Escape preserves a pending board decision. Starting a friend match asks before abandoning an active local/CPU match.
- CPU regressions cover a previous 200-summon/no-move stall, a 15-grain donation to a leaper, a forced next-turn core capture with one remaining lifetime, and a terminal draw that avoids forced defeat. Passive-opponent play now produces a core win; deterministic self-play includes real moves and captures. No paid AI service is used.
- CPU computation uses a dedicated worker. Restart/dispose terminate it; delayed old results cannot mutate or terminate a new match. A worker error or unavailable Worker API falls back to the same legal search.
- Uncertain online commands retain the original receipt ID/version in this tab through reload. Another command cannot overwrite an unresolved command. Recovery prioritizes restoring a missing room before replaying its pending receipt; failed initial recovery remains retryable. Late room creation responses do not reopen a stopped session. Successful polling clears its displayed connection error.
- 118 unit/integration tests passed in the final verification run, including failing-before-fix regressions. TypeScript and production client/Worker builds are included in release checks. Deployed browser results are recorded separately in the delivery; no exact physical-phone, GPU, or independent two-browser UI claim is made here.
