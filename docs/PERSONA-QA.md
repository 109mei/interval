# INTERVAL: synthetic player evaluation

These are deliberately invented review personas, not real participants, interviews, or empirical user-research results. They make repeated task-based evaluation reproducible. A scenario pass means the named checks were exercised in code/DOM or the browser as noted; it does not establish enjoyment for actual people.

## Personas and reusable tasks

### Nao: new tabletop player
- Experience: turn-taking games, unfamiliar with timed pieces or indirect movement.
- Attention: will give the opening about 45 seconds before trying an action.
- Goal: understand the win condition and complete the first five decisions without reading every rule.
- Tasks: inspect the starting wall; summon a Carver; compare affordable durations; try a destination, including an illegal straight move; predict expiry on a move or pass.
- Frustration criteria: silent loss of selection, misleading expiry wording, no obvious recovery from an invalid tap.
- Pass criteria: win/next action are visible; invalid input spends nothing and preserves a usable path; the piece's actual last turn is predictable before confirmation.

### Ren: experienced strategy player
- Experience: chess/puzzles, plans two moves ahead; no assumption of familiar chess-piece rules.
- Attention: patient if the UI provides trustworthy decision information.
- Goal: compare purchase cost, capture reward and expiry risk, then deliberately use Link/Leaper support.
- Tasks: inspect enemy geometry; check a blocked Carver and a Leaper pad; calculate capture value when own mover expires; compare one-life vs two-life support; cancel a sixth-pass draw; check core capture at the move limit.
- Frustration criteria: hidden tactical consequences, contradictory lifecycle descriptions, terminal decisions without warning.
- Pass criteria: reference geometry cannot become an executable opponent move; actual cost/reward/expiry and terminal result agree with the rules; support choices remain meaningful without changing prices or mechanics.

### Mika: interrupted one-hand phone player
- Experience: browser games, prefers direct taps.
- Attention: short interrupted sessions; simulated right-thumb constraints.
- Goal: select, reselect, inspect rules and confirm without accidentally spending on an old target.
- Tasks: valid summon square → invalid square → another valid square; menu interruption at confirmation; scroll to the bottom of rules and return; repeat after a display change.
- Frustration criteria: stale actionable purchases, disappearing escape controls, scrolling between mutually dependent information.
- Pass criteria: invalid retap removes the old purchase; chosen type/duration survive; closing rules preserves the proposal; close target remains visible while rules scroll.
- Physical one-hand/touch ergonomics require actual-device testing and are not claimed here.

### Sora: social friend-play host/guest
- Experience: casual online games; wants to play while chatting remotely.
- Attention: impatient with unexplained waiting and setup.
- Goal: start together, understand readiness/turn/role, return after interruption and arrange another match.
- Tasks: host alone; guest arrives with host ready; simultaneous readiness; uncertain Ready reply; resume; finished match → new-room limit → recover.
- Frustration criteria: unexplained irreversible Ready, stale-version instruction referring to an unrelated board, recovery that recommends an unusable finished room.
- Pass criteria: consequences are visible before readiness; refreshed state explains the next step; uncertain commands retain the original receipt; room-limit guidance preserves security limits and offers a usable alternative.

## Cycle 1: observed issues and fixes

Baseline: v5, Sites source 4719512, matching GitHub tree 5c0d404.

- Nao: illegal c2→c3 move silently deselected the Carver and removed legal targets (live cloud-browser observation). Selection now survives with an explicit invalid-move hint. A one-life Carver on its current turn falsely said “next own turn” (live cloud-browser observation); lifecycle text now names the owner and current/next turn accurately.
- Ren: opponent targets were absent because rendering used only current-turn actions (source/DOM evidence). Distinct dashed reference targets now expose current movement/exchange geometry without granting actions. Link falsely said duration stayed unchanged; description now says no extension and normal end-turn aging. Expiry previews name the affected pieces. Draw previews now disclose sixth-pass or 200th-move outcomes.
- Mika: valid c2 then invalid c3 left the prior purchase enabled while replacing its exact destination with an error (live cloud-browser observation). Invalid summon retap now clears the candidate/ghost while retaining kind/duration. Scrolling rules put the sole close button outside the viewport (live cloud-browser measurement: close top −622 px); the header is now sticky with a minimum 44 px close control.
- Sora: stale Ready errors used board-action wording; they now name readiness and the next button. Readiness consequences are explained before the button. Host-room cap guidance now includes finished/closed rooms and suggests friend-hosting or expiry; caps/protocol are unchanged.

Evidence: six new real-main UI regressions failed for the intended gaps before changes, then passed; eight new checks including friend readiness/cap paths brought the suite to 150 passing tests. Fresh independent persona re-evaluation and publication checks are recorded below as they complete.

## Evidence limits
- Browser observations use the supported cloud browser and its 2D fallback. Physical iPhone/touch, exact 390×844 and GPU rendering are not verified.
- No real human playtest or enjoyment/satisfaction measurements are asserted.
- Concurrent friend sessions and injected network failures use server/client fixtures unless explicitly recorded as browser evidence.
- Direct API and DevTools routes previously denied are not retried. No paid services/assets, new public audience, Actions, rule/pricing changes, or destructive operations are part of these cycles.

## Cycle 2: fresh tasks, not just regression replay

- Nao's fresh affordability/immobility matrix found misleading advice to use highlights when none existed. Main guidance now distinguishes budget shortage, blocked/immobile pieces, and valid destinations; changing duration clears stale error text. A new regression failed before the fix.
- Sora's fresh warm-up → accept invitation → finish → capped rematch path revealed that an explicitly abandoned local match could return. Successful guest join now resets the local controller like successful hosting already did. The independent regression failed before the fix; failed/cancelled joins still preserve local play.
- Ren's independent five-case execution checked last-life capture value (+9 for a remaining-3 Carver), both own expiries, core-win precedence at ply199, blocked enemy inspection, pad disappearance, and the duration-2 Link/Leaper plan. They passed. A 3D CSS visibility issue was found during integration and corrected: reference outlines remain visible without pointer interaction. This is DOM/CSS evidence, not GPU rendering.
- Mika's independent four-case interruption matrix passed: repeat valid→occupied-invalid→menu→close→new-valid, display rebuild/fallback, move reselection, and six named expiries. Sticky-header offset was simplified to top:0 to avoid clipping the close target; actual post-publication visual checks remain separate.

## Cycle 3: bounded closure checks

- Nao: three new real-main DOM scenarios passed for a fully boxed Carver, repeated affordable/unaffordable duration changes, and opponent→own piece selection. No remaining concrete actionable finding in these tasks.
- Sora: nine independent client/DOM checks passed, including successful reset, declined abandonment, ROOM_FULL, network error, cancelled preparation, uncertain receipt, concurrent-ready recovery and rematch cap recovery. No further concrete actionable finding in these tasks.
- Ren/Mika: corrected strategic and interrupted-flow checks above remain passing. Code-backed checks cannot establish human enjoyment, physical-thumb comfort or GPU fidelity.

The project retains the critical scenarios in tests/ui-personas.test.ts, tests/ui-social-persona.test.ts, tests/strategy-persona.test.ts and tests/online.test.ts. Original engine rules, prices, reward formula, no-cap grain, CPU weights and multiplayer API/schema are unchanged. Publication will use the same public Site and GitHub-first exact-tree verification.

## Cycle 4: action motion and effects

2026-10-08. Baseline inspection found that gameplay actions were instantaneous in both renderers. Motion now communicates the committed action rather than selection: Carvers follow a legal bend from the pre-action board, Leapers lift over the unchanged pad, and Links move both identities. Capture precedes expiry at the committed destination. A final-life core capture keeps its winner alive and removes the losing core.

- Nao: summon with simultaneous retirement, canceled previews, and pre-expiry path geometry are retained as regressions. Newborn duration is unchanged.
- Ren: all one/both-expiring Link combinations, last-life capture reward, Leaper pad behavior, and ply200 core-win precedence are checked against the real engine.
- Mika: frames are bounded to580ms; interruption at0/140/300/420/550ms, reset, page hiding, disposal, display fallback and reduced motion are tested. Badges travel with pieces; static final-state labels remain available with reduced motion.
- Sora: identical state deliveries cannot replay motion. Online movement is reconstructed only for a unique engine-consistent action. A life1 Carver can have12 destinations producing the same snapshot; those ambiguous cases and skipped plies settle directly instead of fabricating a route. A provable one-survivor Link exchange is now named as an exchange in history.

Independent review found and reproduced intermediate implementation defects: overlong feedback, missing moving life badges, simultaneous capture/expiry, asynchronous renderer failure escaping fallback, reduced-motion duplicate renders hiding the committed summon, and post-disposal timer creation. Focused failing tests preceded their fixes. Real Three scene tests use a mocked WebGLRenderer, so they verify model identity, losing-core removal, frame/fallback lifecycle and owned resource cleanup, not GPU fidelity or frame rate. Fresh cloud-browser rendered evidence is recorded separately after publication.

## Cycle 5: fresh rendered and cross-session evaluation

- Public cloud browser,510×757,2D fallback: observed an actual in-flight c2→b4 Carver with its lifetime badge; summon feedback; capture +9 at c6 with a separate wall retirement; standalone expiry; last-life c6→d7 victory; one remaining core and surviving winner; and zero effects/hidden authoritative pieces after settlement. A new match and an intervening menu visit were exercised. This is rendered browser evidence for2D only.
- Mika's reduced-motion browser pass verified no moving proxies or hidden final pieces, then found the static summon chip obscured the piece/lifetime. Reduced-motion cues are now transparent outlines; the permanent action history still supplies the words and values. A computed-style regression failed before this change.
- Sora's independently executed local warm-up→rejoin an already-playing invitation exposed a retained Carver model under a Leaper label because both sessions used the same generated id. Model reuse now also checks kind and side and disposes the old geometry. Both a direct scene case and the real-main join case are retained as regressions; both failed before the fix.
- A narrow3D overlay source review found percentage-based role/lifetime spacing could overlap on a308px board. Both idle and moving labels now share the same projection anchor with pixel-aware separation. This is scene/CSS evidence; GPU rendering remains unverified.

## Cycle 6: broad reproducible contracts and independent visual review

2026-10-08. The approximately 3,000-case campaign is documented in [QUALITY-3000.md](QUALITY-3000.md). Four synthetic personas map to 623 interaction tasks: Nao71, Ren40, Mika420, Sora92. These are scenario labels, not additional participants or test counts.

- Nao: selected summon kind was not programmatically expressed, and empty/illegal CPU worker replies could strand the black turn. Both were reproduced with failing tests; selected-state semantics and the existing-strategy fallback resolve them.
- Ren: 40 side/kind/lifetime inspection tasks passed, alongside independently-oracled capture, exchange, expiry, terminal and resource accounting. Neither prices nor strategy were adjusted to make the tests pass.
- Mika: interrupted/revised purchases, invalid targets and controller-token boundaries passed. Actual narrow cloud-browser observation found cost facts below the viewport and a32px cancel target; price/balance is now beside duration and cancel has a44px minimum. Final layout remains a separate browser check.
- Sora: 92 role/readiness/rejection/receipt scenarios passed using DOM and mocked-client fixtures. Definitive refusals remain different from uncertain replies; recovery preserves the exact original operation receipt. No new production room was created while the existing daily quota remained in force.
- Model review: 400 geometry/material/resource/software-projection contracts passed, then visual inspection of software-projected mesh comparison caught the black Carver's blade collapsing edge-on. Existing projection contracts were strengthened around the distinctive blade and both Link facings, failed on the intermediate version, and passed after correction. GPU shading remains unverified.
