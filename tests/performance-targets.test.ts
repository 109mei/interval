import { afterEach, expect, it, vi } from "vitest";
import { createGame, applyAction } from "../src/game/engine";
import * as rules from "../src/game/rules";
import { boardTargets, type TargetKind } from "../src/render/board-targets";
import type { GameState, Piece, Selection } from "../src/game/types";

afterEach(() => vi.restoreAllMocks());

const piece = (
  id: string,
  kind: Piece["kind"],
  square: number,
  side: Piece["side"] = "white",
): Piece => ({ id, kind, square, side, remaining: 3, summonedPly: -1 });

// Characterize the original all-actions projection, independently of the
// optimized selection path. Preserve entry order as well as target classes.
function reference(s: GameState, selection: Selection) {
  const selected = s.pieces.find((p) => p.id === selection.pieceId);
  const inspectOnly =
    !!selected && (selection.inspectOnly || selected.side !== s.turn);
  const actions = inspectOnly
    ? rules.pieceActions({ ...s, turn: selected.side }, selected)
    : rules.legalActions(s);
  const kinds = new Map<number, TargetKind>();
  for (const action of actions) {
    if (
      action.type === "summon" &&
      action.kind === selection.summon?.kind &&
      action.duration === selection.summon.duration
    )
      kinds.set(action.to, "summon");
    if (action.type === "move" && action.pieceId === selection.pieceId)
      kinds.set(
        action.to,
        action.to === s.cores[rules.opposite(selected!.side)] ||
          s.pieces.some(
            (p) => p.square === action.to && p.side !== selected!.side,
          )
          ? "capture"
          : "move",
      );
    if (action.type === "swap" && action.pieceId === selection.pieceId)
      kinds.set(s.pieces.find((p) => p.id === action.allyId)!.square, "swap");
  }
  return { kinds: [...kinds], targets: [...kinds.keys()], inspectOnly };
}

it("idle board targets do not enumerate unused legal actions", () => {
  const all = vi.spyOn(rules, "legalActions");
  const individual = vi.spyOn(rules, "pieceActions");
  const result = boardTargets(createGame(), {
    pieceId: null,
    candidate: null,
  });
  expect([...result.targets]).toEqual([]);
  expect(all).not.toHaveBeenCalled();
  expect(individual).not.toHaveBeenCalled();
});

it("selected piece targets do not allocate unrelated moves and summons", () => {
  const s = {
    ...createGame(),
    pieces: [piece("selected", "carver", 16), piece("other", "leaper", 8)],
  };
  const selection = { pieceId: "selected", candidate: null };
  const expected = reference(s, selection);
  const all = vi.spyOn(rules, "legalActions");
  const individual = vi.spyOn(rules, "pieceActions");
  const result = boardTargets(s, selection);
  expect([...result.kinds]).toEqual(expected.kinds);
  expect(all).not.toHaveBeenCalled();
  expect(individual).toHaveBeenCalledExactlyOnceWith(s, s.pieces[0]);
});

it("target projection remains equivalent across generated states and selections", () => {
  const states: GameState[] = [
    createGame(),
    {
      ...createGame(),
      pieces: [
        piece("link", "link", 16),
        piece("ally", "leaper", 17),
        piece("carver", "carver", 37),
        piece("enemy", "carver", 25, "black"),
      ],
    },
  ];
  let s = createGame(),
    seed = 20261008;
  for (let i = 0; i < 48 && !s.outcome; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const actions = rules.legalActions(s);
    const result = applyAction(s, actions[seed % actions.length]);
    if (!result.ok) throw Error("generated action must be legal");
    s = result.state;
    states.push(s);
  }
  for (const s of states) {
    const selections: Selection[] = [
      { pieceId: null, candidate: null },
      { pieceId: "missing", candidate: null },
      ...s.pieces.flatMap((p) => [
        { pieceId: p.id, candidate: null },
        { pieceId: p.id, candidate: null, inspectOnly: true },
      ]),
      ...rules.KINDS.flatMap((kind) =>
        [1, 2, 3, 4, 5].flatMap((duration) => [
          { pieceId: null, candidate: null, summon: { kind, duration } },
          {
            pieceId: s.pieces[0]?.id ?? null,
            candidate: null,
            summon: { kind, duration },
          },
        ]),
      ),
    ];
    for (const selection of selections) {
      const result = boardTargets(s, selection);
      expect({
        kinds: [...result.kinds],
        targets: [...result.targets],
        inspectOnly: result.inspectOnly,
      }).toEqual(reference(s, selection));
    }
  }
});

it("terminal and invalid states retain original playable and inspection targets", () => {
  const active: GameState = {
    ...createGame(),
    pieces: [piece("selected", "carver", 16)],
  };
  const states: GameState[] = [
    { ...active, outcome: { kind: "draw", reason: "limit" } },
    { ...active, grain: { white: -1, black: 12 } },
    { ...active, pieces: [...active.pieces, piece("duplicate", "link", 16)] },
  ];
  for (const s of states)
    for (const inspectOnly of [false, true]) {
      const selection = { pieceId: "selected", candidate: null, inspectOnly };
      const result = boardTargets(s, selection);
      expect({
        kinds: [...result.kinds],
        targets: [...result.targets],
        inspectOnly: result.inspectOnly,
      }).toEqual(reference(s, selection));
    }
});
