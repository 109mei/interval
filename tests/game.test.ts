import { describe, it, expect } from "vitest";
import { createGame, applyAction, previewAction } from "../src/game/engine";
import { isLegal, legalActions, PRICES } from "../src/game/rules";
import type { GameState, Piece, Kind, Action } from "../src/game/types";
const p = (
  id: string,
  kind: Kind,
  square: number,
  side: "white" | "black" = "white",
  remaining = 4,
): Piece => ({ id, kind, square, side, remaining, summonedPly: -1 });
const state = (
  pieces: Piece[] = [],
  extra: Partial<GameState> = {},
): GameState => ({
  pieces,
  cores: { white: 3, black: 45 },
  grain: { white: 20, black: 20 },
  turn: "white",
  ply: 2,
  consecutivePasses: 0,
  outcome: null,
  ...extra,
});
const next = (s: GameState, a: Action) => {
  const r = applyAction(s, a);
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.error);
  return r.state;
};
describe("core-only opening and own-half summons", () => {
  it("starts with only the two fixed cores and unchanged economy", () => {
    expect(createGame()).toEqual({
      pieces: [],
      cores: { white: 3, black: 45 },
      grain: { white: 16, black: 12 },
      turn: "white",
      ply: 0,
      consecutivePasses: 0,
      outcome: null,
    });
    expect(PRICES).toEqual({ bastion: 1, carver: 3, leaper: 2, link: 1 });
  });
  for (const side of ["white", "black"] as const)
    it.each(Array.from({ length: 49 }, (_, square) => square))(
      `${side} summons at square %i match only its own three ranks`,
      (to) => {
        const s = state([], { turn: side });
        const expected =
          to !== 3 && to !== 45 && (side === "white" ? to <= 20 : to >= 28);
        const before = JSON.stringify(s);
        const enumerated = legalActions(s);
        for (const kind of ["bastion", "carver", "leaper", "link"] as const)
          for (let duration = 1; duration <= 5; duration++) {
            const action: Action = { type: "summon", kind, duration, to };
            expect(isLegal(s, action)).toBe(expected);
            expect(
              enumerated.some(
                (a) =>
                  a.type === "summon" &&
                  a.kind === kind &&
                  a.duration === duration &&
                  a.to === to,
              ),
            ).toBe(expected);
            expect(previewAction(s, action) !== null).toBe(expected);
            const result = applyAction(s, action);
            expect(result.ok).toBe(expected);
            if (result.ok) {
              expect(result.state.pieces).toHaveLength(1);
              expect(result.state.pieces[0]).toMatchObject({
                side,
                kind,
                square: to,
                remaining: duration,
              });
            } else expect(result.state).toBe(s);
          }
        expect(JSON.stringify(s)).toBe(before);
      },
    );
  it.each(["white", "black"] as const)(
    "%s cannot summon over either side's piece in its new third rank",
    (side) => {
      const to = side === "white" ? 20 : 28;
      for (const occupant of ["white", "black"] as const) {
        const s = state([p("occupant", "bastion", to, occupant)], {
          turn: side,
        });
        const action: Action = {
          type: "summon",
          kind: "bastion",
          duration: 1,
          to,
        };
        expect(isLegal(s, action)).toBe(false);
        expect(legalActions(s)).not.toContainEqual(action);
        expect(applyAction(s, action).state).toBe(s);
      }
    },
  );
});
describe("turn economy", () => {
  it("first_income_once", () => {
    const s = createGame();
    expect(s.grain).toEqual({ white: 16, black: 12 });
    expect(next(s, { type: "pass" }).grain.black).toBe(16);
  });
  it("capture_weighted_unlimited", () => {
    const s = state([p("a", "carver", 16), p("b", "carver", 25, "black", 4)]);
    const r = next(s, { type: "move", pieceId: "a", to: 25 });
    expect(r.grain.white).toBe(32);
    expect(s.grain.white).toBe(20);
  });
  it("income_unlimited", () => {
    expect(
      next(state([], { grain: { white: 24, black: 24 } }), { type: "pass" })
        .grain.black,
    ).toBe(28);
  });
  it("attacker_price_does_not_set_reward", () => {
    const s = state([
      p("a", "leaper", 23),
      p("step", "bastion", 24, "black"),
      p("b", "carver", 25, "black", 4),
    ]);
    expect(next(s, { type: "move", pieceId: "a", to: 25 }).grain.white).toBe(
      32,
    );
  });
  it.each([1, 5])("duration_%i", (duration) => {
    let s = next(state(), { type: "summon", kind: "carver", duration, to: 10 });
    const id = s.pieces[0].id;
    expect(s.pieces[0].remaining).toBe(duration);
    expect(s.grain.white).toBe(20 - duration * 3);
    for (let i = 0; i < duration; i++) {
      s = next(s, { type: "pass" });
      s = next(s, {
        type: i === 0 ? "pass" : "summon",
        ...(i === 0 ? {} : { kind: "bastion", duration: 1, to: i % 2 }),
      } as Action);
      if (i < duration - 1)
        expect(s.pieces.find((p) => p.id === id)?.remaining).toBe(
          duration - i - 1,
        );
    }
    expect(s.pieces.find((p) => p.id === id)).toBeUndefined();
  });
  it("all_owned_age_and_swap", () => {
    const s = state([
      p("a", "link", 22),
      p("b", "bastion", 23),
      p("c", "leaper", 24),
      p("e", "bastion", 31, "black"),
    ]);
    const r = next(s, { type: "swap", pieceId: "a", allyId: "b" });
    expect(r.pieces.map((p) => p.remaining)).toEqual([3, 3, 3, 4]);
    expect(r.pieces.map((p) => p.square)).toEqual([23, 22, 24, 31]);
  });
  it("capture_before_expiry", () => {
    const s = state([p("a", "carver", 36, "white", 1)]);
    const r = next(s, { type: "move", pieceId: "a", to: 45 });
    expect(r.outcome).toEqual({ kind: "win", winner: "white" });
    expect(r.pieces[0].remaining).toBe(1);
    expect(r.grain.black).toBe(20);
  });
  it("natural_expiry_no_reward", () => {
    const r = next(
      state([
        p("a", "bastion", 22, "white", 1),
        p("b", "bastion", 23, "white", 1),
      ]),
      { type: "pass" },
    );
    expect(r.pieces).toHaveLength(0);
    expect(r.grain.white).toBe(20);
  });
  it("draw_passes", () => {
    let s = createGame();
    for (let i = 0; i < 6; i++) s = next(s, { type: "pass" });
    expect(s.outcome).toEqual({ kind: "draw", reason: "passes" });
  });
  it("draw_limit_and_pass_reset", () => {
    const s = state([], { ply: 199, consecutivePasses: 5 });
    const r = next(s, { type: "summon", kind: "bastion", duration: 1, to: 0 });
    expect(r.consecutivePasses).toBe(0);
    expect(r.outcome).toEqual({ kind: "draw", reason: "limit" });
  });
  it("win_over_draw_limit", () => {
    expect(
      next(state([p("a", "carver", 36, "white", 1)], { ply: 199 }), {
        type: "move",
        pieceId: "a",
        to: 45,
      }).outcome?.kind,
    ).toBe("win");
  });
  it("preview_is_nonmutating", () => {
    const s = state([
      p("a", "carver", 16, "white", 1),
      p("b", "carver", 25, "black", 4),
    ]);
    const before = JSON.stringify(s);
    expect(
      previewAction(s, { type: "move", pieceId: "a", to: 25 }),
    ).toMatchObject({ cost: 0, reward: 12, grainAfter: 32, expires: ["a"] });
    expect(JSON.stringify(s)).toBe(before);
  });
});
describe("movements", () => {
  it("carver_all_directions", () => {
    const a = legalActions(state([p("a", "carver", 24)]))
      .filter((a) => a.type === "move")
      .map((a) => a.to)
      .sort((a, b) => a - b);
    expect(a).toEqual([9, 11, 15, 16, 18, 19, 29, 30, 32, 33, 37, 39]);
  });
  it("carver_corner_and_intermediate_block", () => {
    const s = state([
      p("a", "carver", 24),
      p("x", "bastion", 25),
      p("y", "bastion", 31),
    ]);
    expect(legalActions(s).some((a) => a.type === "move" && a.to === 33)).toBe(
      false,
    );
  });
  it.each([
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])("leaper direction %i %i", (dx, dy) => {
    const mid = 24 + dx + 7 * dy,
      to = 24 + 2 * dx + 14 * dy;
    const s = state([
      p("a", "leaper", 24),
      p("step", "bastion", mid, "black"),
      p("target", "link", to, "black"),
    ]);
    const r = next(s, { type: "move", pieceId: "a", to });
    expect(r.pieces.some((p) => p.id === "step")).toBe(true);
    expect(r.pieces.some((p) => p.id === "target")).toBe(false);
  });
  it("no_step_no_leap", () => {
    expect(
      legalActions(state([p("a", "leaper", 24)])).some(
        (a) => a.type === "move",
      ),
    ).toBe(false);
  });
  it("bastion_stationary", () => {
    expect(
      legalActions(state([p("a", "bastion", 24)])).some(
        (a) => a.type === "move",
      ),
    ).toBe(false);
  });
  it("link_cannot_swap_core", () => {
    expect(
      applyAction(state([p("a", "link", 10)]), {
        type: "swap",
        pieceId: "a",
        allyId: "core-white",
      }).ok,
    ).toBe(false);
  });
  it("board_edges_no_wrap", () => {
    const s = state([p("a", "leaper", 6), p("x", "bastion", 7)]);
    expect(legalActions(s).some((a) => a.type === "move")).toBe(false);
  });
  it("no_opening_core_capture", () => {
    expect(legalActions(createGame()).every((a) => a.type !== "move")).toBe(
      true,
    );
  });
});
describe("validation", () => {
  it.each([0, 6, 1.5, NaN])("invalid_duration_%s", (duration) => {
    const s = createGame();
    const r = applyAction(s, {
      type: "summon",
      kind: "bastion",
      duration,
      to: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
  });
  it.each([-1, 49, 1.5, NaN, 3, 45])("invalid_summon_square_%s", (to) => {
    expect(
      applyAction(createGame(), {
        type: "summon",
        kind: "bastion",
        duration: 1,
        to,
      }).ok,
    ).toBe(false);
  });
  it("reject_enemy_rows_and_insufficient_grain", () => {
    expect(
      applyAction(createGame(), {
        type: "summon",
        kind: "bastion",
        duration: 1,
        to: 30,
      }).ok,
    ).toBe(false);
    expect(
      applyAction(state([], { grain: { white: 0, black: 0 } }), {
        type: "summon",
        kind: "bastion",
        duration: 1,
        to: 0,
      }).ok,
    ).toBe(false);
  });
  it("unknown_piece_and_own_landing", () => {
    expect(
      applyAction(createGame(), { type: "move", pieceId: "missing", to: 12 })
        .ok,
    ).toBe(false);
    expect(
      applyAction(state([p("a", "carver", 16), p("b", "link", 25)]), {
        type: "move",
        pieceId: "a",
        to: 25,
      }).ok,
    ).toBe(false);
  });
  it("reject_duplicate_occupancy", () => {
    const s = state([p("a", "carver", 24), p("b", "link", 24)]);
    expect(applyAction(s, { type: "pass" }).ok).toBe(false);
  });
  it("reject_finished", () => {
    expect(
      applyAction(state([], { outcome: { kind: "win", winner: "white" } }), {
        type: "pass",
      }).ok,
    ).toBe(false);
  });
});
