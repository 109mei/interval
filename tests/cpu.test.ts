import { it, expect } from "vitest";
import { chooseCpuAction } from "../src/cpu/choose-action";
import { createGame, applyAction } from "../src/game/engine";
import { isLegal, legalActions } from "../src/game/rules";
import type { GameState, Piece, Action } from "../src/game/types";
const p = (
  id: string,
  kind: Piece["kind"],
  square: number,
  side: Piece["side"],
  remaining = 3,
): Piece => ({ id, kind, square, side, remaining, summonedPly: -1 });
it("cpu_legal_and_deterministic", () => {
  const s = createGame();
  const a = chooseCpuAction(s)!;
  expect(isLegal(s, a)).toBe(true);
  expect(chooseCpuAction(s)).toEqual(a);
});
it("cpu_takes_core", () => {
  const s: GameState = {
    ...createGame(),
    pieces: [p("a", "carver", 36, "white", 1)],
  };
  expect(chooseCpuAction(s)).toEqual({ type: "move", pieceId: "a", to: 45 });
});
it("cpu_blocks_immediate_loss", () => {
  const s: GameState = {
    ...createGame(),
    turn: "black",
    grain: { white: 10, black: 16 },
    pieces: [p("threat", "carver", 36, "white")],
  };
  const a = chooseCpuAction(s)!;
  const r = applyAction(s, a);
  expect(r.ok).toBe(true);
  if (r.ok)
    expect(
      legalActions(r.state).some((b) => {
        const t = applyAction(r.state, b);
        return t.ok && t.state.outcome?.kind === "win";
      }),
    ).toBe(false);
});
it("cpu_accounts_for_expiry", () => {
  const s: GameState = {
    ...createGame(),
    turn: "black",
    grain: { white: 10, black: 16 },
    pieces: [
      p("threat", "carver", 36, "white"),
      p("wall", "bastion", 43, "black", 1),
    ],
  };
  const r = applyAction(s, chooseCpuAction(s)!);
  if (!r.ok) throw Error();
  expect(
    legalActions(r.state).some((a) => {
      const n = applyAction(r.state, a);
      return n.ok && n.state.outcome?.kind === "win";
    }),
  ).toBe(false);
});
it("cpu_finished_null", () => {
  expect(
    chooseCpuAction({
      ...createGame(),
      outcome: { kind: "draw", reason: "passes" },
    }),
  ).toBeNull();
});
it("self_play_terminates", () => {
  let s = createGame();
  for (let i = 0; i < 200 && !s.outcome; i++) {
    const a = chooseCpuAction(s)!;
    const r = applyAction(s, a);
    expect(r.ok).toBe(true);
    if (!r.ok) throw Error();
    s = r.state;
    expect(s.grain.white).toBeGreaterThanOrEqual(0);
    expect(new Set(s.pieces.map((p) => p.square)).size).toBe(s.pieces.length);
  }
  expect(s.outcome).not.toBeNull();
}, 20000);
