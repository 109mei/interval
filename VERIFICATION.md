# Verification record

2026-10-07. INTERVAL friend multiplayer release candidate.

## Executed checks
- 90 Vitest unit/integration tests passed across eight files.
- TypeScript check and production client/Worker build passed.
- SQLite-backed API tests run the generated D1 SQL migration and exercise separate host/guest credentials, join races, both-ready start, same-version competing commands, duplicate/replayed commands, altered command rejection, stale state, authoritative rule validation, expiry before cleanup, leave, result preservation, CSRF, malformed/oversized bodies, and unavailable storage.
- Browser-client tests cover monotonic polling versions, hidden-tab polling pause, reconnection, retry with the exact same command ID, and create-response-loss recovery.
- UI DOM tests cover summon, spend, move, pass confirmation, draw, restart, legal placement highlights, and state-preserving 3D-to-2D fallback.

These are executable integration tests, not a substitute for deployed D1/browser tests. The SQLite adapter models D1 batch transactions but is not the production D1 service.

## Browser limitations
The earlier local Chromium launch was denied by the cloud OS socket restriction; the existing cloud browser also rejected the local development URL. Those denied routes were not retried or bypassed. At this checkpoint, real 390×844 layout, touch, GPU rendering and two isolated production browser sessions are not claimed as verified. Any deployed verification is recorded separately in the release handoff.

## Remaining limits
- CPU is a basic one-ply opponent; game balance is not certified.
- Initial client JavaScript includes Three.js (~602 KB, ~158 KB gzip before final build).
- Rooms expire after 24 hours. Clearing the browser cookie loses the seat. Expired database rows are removed in bounded batches as API traffic arrives; there is no scheduled cleanup contract.
- Polling is 1.2–2.5 seconds while visible with backoff; it is not continuous push networking.
- Application rate and room caps mitigate ordinary abuse but do not replace platform-level traffic controls or guarantee unlimited included capacity.
- No names, accounts, chat, directory, third-party analytics, paid API or purchased asset is added.
