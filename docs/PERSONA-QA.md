# Synthetic player perspectives

The test scenarios use fictional perspectives to vary tasks and constraints. They are not interviews, real users or evidence of human enjoyment.

- Nao, a first-time player: home, mode selection, explicit Start, rules and affordability.
- Ren, a strategy-focused player: symmetric rules, captures, lifetime timing, previews and CPU responses.
- Mika, an interrupted or motion-sensitive player: revised purchases, repeated inputs, display settings, focus, pause and resume.
- Sora, a friend-session player: invitation confirmation, readiness, recovery, uncertain responses, expiry and cancellation.

Coverage includes [30 scenario groups](REVIEW-30-CYCLES.md), [500 additional automated cases](REVIEW-500-SCENARIOS.md), and [200 post-optimization cases](REVIEW-200-SCENARIOS.md). Public case contracts retain IDs, preconditions, interaction sequences and expected results. The executable assertions are in the corresponding test files.

Physical-device touch, native screen-reader speech, GPU rendering/performance and simultaneous independent production friend sessions are not established by this automated coverage.
