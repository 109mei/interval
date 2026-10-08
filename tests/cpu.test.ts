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
it("cpu converts deployment into play and beats a player who only passes", () => {
  let s = createGame();
  let movements = 0;
  let captures = 0;
  for (let i = 0; i < 100 && !s.outcome; i++) {
    const a =
      s.turn === "white" ? ({ type: "pass" } as Action) : chooseCpuAction(s)!;
    const r = applyAction(s, a);
    if (!r.ok) throw Error("illegal CPU action");
    if (a.type === "move" || a.type === "swap") movements++;
    captures += r.events.filter((e) => e.type === "capture").length;
    s = r.state;
  }
  expect(movements).toBeGreaterThan(0);
  expect(s.outcome).toEqual({ kind: "win", winner: "black" });
}, 30000);
it("cpu does not donate a fresh expensive attacker to a visible leaper", () => {
  const s: GameState = {
    ...createGame(),
    ply: 21,
    turn: "black",
    grain: { white: 0, black: 16 },
    pieces: [
      p("cheap", "leaper", 24, "white", 5),
      p("step", "bastion", 31, "white", 5),
    ],
  };
  const a = chooseCpuAction(s)!;
  expect(a).not.toMatchObject({
    type: "summon",
    kind: "carver",
    duration: 5,
    to: 38,
  });
  const r = applyAction(s, a);
  if (!r.ok) throw Error();
  const rewards = legalActions(r.state).map((reply) => {
    const n = applyAction(r.state, reply);
    return n.ok
      ? n.events
          .filter((e) => e.type === "capture")
          .reduce((v, e) => v + e.amount, 0)
      : 0;
  });
  expect(Math.max(...rewards)).toBeLessThan(10);
});
it("cpu sees a forced next-turn core capture, including its final lifetime", () => {
  const s: GameState = {
    ...createGame(),
    ply: 20,
    grain: { white: 16, black: 16 },
    pieces: [p("attacker", "carver", 31, "white", 2)],
  };
  const a = chooseCpuAction(s)!;
  expect(a.type).toBe("move");
  if (a.type !== "move") throw Error();
  expect([37, 39]).toContain(a.to);
  const r = applyAction(s, a);
  if (!r.ok) throw Error();
  for (const reply of legalActions(r.state)) {
    const n = applyAction(r.state, reply);
    if (!n.ok) throw Error();
    expect(
      legalActions(n.state).some((win) => {
        const w = applyAction(n.state, win);
        return (
          w.ok &&
          w.state.outcome?.kind === "win" &&
          w.state.outcome.winner === "white"
        );
      }),
    ).toBe(true);
  }
});
it("CPU takes a terminal draw rather than a move that immediately loses its core", () => {
  const s: GameState = {
    ...createGame(),
    ply: 21,
    consecutivePasses: 5,
    grain: { white: 100, black: 0 },
    pieces: [p("threat", "carver", 9, "black", 2)],
  };
  expect(chooseCpuAction(s)).toEqual({ type: "pass" });
});
it("CPU uses a Link exchange to give a Leaper a forced core capture", () => {
  const s: GameState = {
    ...createGame(),
    ply: 20,
    grain: { white: 16, black: 16 },
    pieces: [
      p("link", "link", 31, "white", 2),
      p("leaper", "leaper", 30, "white", 2),
      p("bridge", "bastion", 38, "black", 3),
    ],
  };
  const action = chooseCpuAction(s)!;
  expect(action).toEqual({ type: "swap", pieceId: "link", allyId: "leaper" });
  const moved = applyAction(s, action);
  if (!moved.ok) throw Error("illegal CPU exchange");
  for (const reply of legalActions(moved.state)) {
    const after = applyAction(moved.state, reply);
    if (!after.ok) throw Error("illegal reply");
    expect(
      legalActions(after.state).some((candidate) => {
        const result = applyAction(after.state, candidate);
        return (
          result.ok &&
          result.state.outcome?.kind === "win" &&
          result.state.outcome.winner === "white"
        );
      }),
    ).toBe(true);
  }
});
