# Thirty scenario groups

The 30 named automated scenario groups cover first entry, deliberate start, rule explanations, affordability, symmetric summon zones, lifetime/expiry, CPU decisions, interrupted purchases, display preferences, focus, room recovery and request cancellation.

## Corrections covered

- Mode guidance remains accurate when opening rules from home.
- Start and Resume place keyboard focus in the active view, including transitions out of a waiting lobby.
- Explicit 2D entry shows the correct display-switch action.
- Cancelled reconnect preparation cannot start a stale follow-on room read.
- Malformed service responses produce safe error wording.
- Test cleanup cancels pending animation work before removing its DOM fixture.

## Reproduce

Run `npm test -- tests/review-home-cycles.test.ts tests/review-network-cycles.test.ts tests/review-rule-resource-cycles.test.ts`.

These 30 groups are included in the current full suite of 4,258 passing tests. They are not 30 publications or 30 physical-device playthroughs. Local DOM, engine and mocked-network results do not establish GPU, phone-touch or real independent friend-session behavior.
