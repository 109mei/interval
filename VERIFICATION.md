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

## Version 4: repeated-match and interrupted-flow review
2026-10-08. Three evidence-led review/fix/retest cycles covered returning guests, fresh rooms, delayed network/clipboard responses, storage restrictions and keyboard play. Rules, CPU weights, prices, lifetimes, capture rewards, room API/schema and audience are unchanged.

- Guest leave and rematch now rebuild the friend dialog from the current invitation state, so a previous invitation cannot hide fresh-room creation or describe the wrong seat.
- Cancelled setup checks its session generation before sending create/join requests. An uncertain creation retains its receipt for retry; a conclusively expired receipt can be replaced. Storage read/write/removal failures no longer prevent same-page retry or force the next room to reuse the previous creation receipt. Persistence across reload still depends on browser storage being available.
- Entering a room restores only that room's pending command. A failed recovery of room A cannot cause room A's leave/action/ready receipt to execute in room B. The old room's stored receipt remains available for later recovery.
- Manual invitation-copy fields and labels reset between rooms. Late clipboard completion cannot expose the departed room's invitation.
- Both board renderers keep one keyboard tab stop after pointer/focus changes and consume arrow keys at board edges. Keyboard summon, pass, confirm and cancel move focus to visible relevant controls; ordinary pointer activation does not trigger these focus jumps.
- 139 unit/integration tests pass, including failing-before-fix regressions and real-main UI coverage. TypeScript and production client/Worker build pass. Independent re-review found no further actionable issues in the covered setup, recovery, leave/rematch, clipboard and keyboard flows.
- Independent engine review checked 18,800 occupied-board positions against a separate movement oracle and 500 legal-play simulations (100,000 plies) without an invariant failure. A further 442 sampled forced-next-turn wins were recognized by the CPU. These are bounded checks, not an exhaustive proof or balance certification.
- Added a lasting CPU regression showing a Link exchange enabling a Leaper's forced core capture. Deterministic self-play can still repeat a 16-ply pattern and reach the existing 200-ply draw limit; no artificial randomness or piece quota was introduced.

Actual browser observations and release IDs are recorded in the release handoff. Physical iPhone touch, exact 390×844 layout, GPU 3D rendering and two independent production browser profiles remain unverified. The previously blocked direct API and DevTools routes were not retried or bypassed.

## Version 5: post-publication experience pass
2026-10-08. The version 4 public cloud-browser pass verified keyboard-only summon → legal square → preview → commit (white grain 16→7), keyboard pass confirmation, room creation/readiness/reload recovery, and leave → distinct new room → leave. Both browser-created test rooms were explicitly closed. Narrow screenshots showed the board and controls without clipping. This was the cloud browser's 2D fallback, not touch or GPU verification. Native back/forward inspection was blocked at the tab's previous non-HTTP new-tab entry; no bypass was attempted. Exit URL/invitation clearing is covered in the UI regression suite.

That pass found two further UI issues. Choosing again with the keyboard now returns focus to the board or summon control, and a room awaiting recovery identifies itself as friend play rather than local two-player. Three regressions failed before these changes and pass afterward. The full suite now passes 142 tests, with TypeScript and production client/Worker builds passing. Multiplayer state and game rules are unchanged from version 4.

## Version 6: differentiated persona cycles
2026-10-08. Four explicitly synthetic personas and reusable tasks are retained in docs/PERSONA-QA.md. Three evaluation stages included fresh beginner, strategy, interrupted one-hand-layout and friend-session scenarios. They are not real user research.

- Invalid summon retaps remove old actionable purchases; invalid moves retain a usable selected piece and explain the error. Zero-target states distinguish cost shortage from immobility.
- Expiry wording identifies the owner and this/next turn. Link text explains normal aging. Previews name expiring pieces and disclose immediate draws alongside wins.
- Read-only opponent inspection displays reference movement/exchange squares without authorizing an action. Both renderers consume the same target helper; 3D outline visibility is CSS-checked, not GPU-verified.
- Rules keep an accessible close header while scrolling. Ready consequences are visible before commitment; stale-ready and room-cap guidance describe the actual recovery choices.
- Successful guest joins clear explicitly abandoned local warm-up games; failed/cancelled joins preserve them.
- Fail-first regressions reproduce old candidate retention, silent deselection, misleading expiry/Link/draw/inspection, zero-target guidance, and guest warm-up resurrection. The full suite, TypeScript and production client/Worker builds are run against the final source. Pre-fix defects were observed in the live cloud browser; post-publication browser evidence is recorded in the release handoff.

No rule/pricing/CPU-weight/API/schema/audience changes. Physical phone touch, exact390×844, GPU and two independent production profiles remain unverified. Previously denied direct API/DevTools routes were not retried.

## Version 7: meaningful action feedback
2026-10-08. Commit-time summon, legal-path movement, jump, exchange, capture, expiry and core-capture cues are implemented in both board renderers. The game state stays authoritative and inputs are not delayed by animation. Newer commits cancel earlier visual generations. JS frame loops settle within580ms, stop on hidden pages/reduced motion/disposal, and do not run when idle.

Regression coverage includes destination expiry, capture-before-expiry, three Link lifetime combinations, preserved newborn lifetime, pre-expiry legal paths, ambiguous online state recovery, duplicate delivery, reset during multiple phases, CPU-speed supersession, static reduced-motion rerenders, core visibility, retained Three model identity, shadow disposal and asynchronous rendering fallback. Independent reviewer-authored scene tests reproduced two additional lifecycle defects before the fixes. The same public audience, game rules, prices, grain behavior, CPU strategy, API and schema are preserved. No audio feature or external asset/service is introduced.

Scene tests use real Three geometry with mocked WebGL rendering. They are not GPU/performance verification. Public cloud browser uses2D fallback; physical touch, exact390×844 and independent production friend profiles remain unverified. Denied browser/API routes and the existing room cap are not bypassed. QA screenshots remain local-only and excluded from publication.

Final pre-publication checks:192 Vitest tests across19 files passed, including10 independent reviewer-authored Three scene/lifecycle checks. TypeScript and both production builds passed. The pre-existing >500KB client bundle warning remains; no GPU frame-rate claim is made.

## Version 8: second motion evaluation cycle
2026-10-08. Fresh public2D browser scenarios verified actual moving pieces, lifetime badges, capture/expiry locations, terminal core removal and clean settlement. They also exposed reduced-motion text covering the new piece; transparent outline cues now preserve the visible piece and lifetime. An independent real-main resume scenario reproduced same-id/different-kind Three geometry reuse; model identity now includes kind/side. Fixed-pixel separation prevents3D role/lifetime badge overlap on narrow layouts. Durable regressions cover all three findings. No game, protocol, schema, price, audience or paid-service changes.
