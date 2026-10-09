import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { applyAction, createGame, previewAction } from "../src/game/engine";
import {
  isLegal,
  legalActions,
  movePaths,
  pieceActions,
  PRICES,
  validState,
} from "../src/game/rules";
import { chooseCpuAction } from "../src/cpu/choose-action";
import {
  expiryExplanation,
  outcomeNotice,
  transitionText,
} from "../src/ui/feedback";
import type { Action, GameState, Kind, Piece, Side } from "../src/game/types";

// The numbers and coordinate oracle below come from the written game contract.
// No production price, move, or lifetime helper computes expected outcomes.
const PRICE = { bastion: 1, carver: 3, leaper: 2, link: 1 } as const;
const ledger = JSON.parse(
  readFileSync(
    new URL("../docs/review500/strategy-cases.json", import.meta.url),
    "utf8",
  ),
) as { id: string; expected: string }[];
const registered = new Set<string>();
function scenario(id: string, run: () => void) {
  if (registered.has(id)) throw Error(`Duplicate scenario ${id}`);
  registered.add(id);
  const record = ledger.find((entry) => entry.id === id);
  if (!record) throw Error(`Missing scenario evidence ${id}`);
  it(`${id} — ${record.expected}`, run, 30000);
}
function p(
  id: string,
  kind: Kind,
  side: Side,
  square: number,
  remaining: number,
): Piece {
  return { id, kind, side, square, remaining, summonedPly: -1 };
}
function state(
  pieces: Piece[] = [],
  overrides: Partial<GameState> = {},
): GameState {
  return {
    ...createGame(),
    ply: 20,
    grain: { white: 20, black: 20 },
    pieces,
    ...overrides,
  };
}
function step(s: GameState, a: Action) {
  const r = applyAction(s, a);
  if (!r.ok) throw Error(`Fixture action rejected: ${JSON.stringify(a)}`);
  return r;
}
function reject(s: GameState, a: Action) {
  const before = JSON.stringify(s);
  expect(isLegal(s, a)).toBe(false);
  expect(previewAction(s, a)).toBeNull();
  const r = applyAction(s, a);
  expect(r.ok).toBe(false);
  expect(r.state).toBe(s);
  expect(JSON.stringify(s)).toBe(before);
}
function independentDestinations(s: GameState, mover: Piece): number[] {
  const x = mover.square % 7,
    y = Math.floor(mover.square / 7);
  const occupied = new Set([...s.pieces.map((q) => q.square), 3, 45]);
  const forbidden = new Set([
    s.cores[mover.side],
    ...s.pieces.filter((q) => q.side === mover.side).map((q) => q.square),
  ]);
  const result: number[] = [];
  for (let to = 0; to < 49; to++) {
    if (forbidden.has(to)) continue;
    const tx = to % 7,
      ty = Math.floor(to / 7),
      dx = tx - x,
      dy = ty - y;
    if (mover.kind === "carver") {
      let clear = false;
      // Horizontal first: exactly one horizontal step, then one or two vertical.
      if (Math.abs(dx) === 1 && [1, 2].includes(Math.abs(dy))) {
        const first = tx + y * 7;
        clear ||=
          !occupied.has(first) &&
          (Math.abs(dy) === 1 || !occupied.has(tx + (y + Math.sign(dy)) * 7));
      }
      // Vertical first: exactly one vertical step, then one or two horizontal.
      if (Math.abs(dy) === 1 && [1, 2].includes(Math.abs(dx))) {
        const first = x + ty * 7;
        clear ||=
          !occupied.has(first) &&
          (Math.abs(dx) === 1 || !occupied.has(x + Math.sign(dx) + ty * 7));
      }
      if (clear) result.push(to);
    } else if (
      mover.kind === "leaper" &&
      [0, 2].includes(Math.abs(dx)) &&
      [0, 2].includes(Math.abs(dy)) &&
      (dx || dy)
    ) {
      if (occupied.has(x + dx / 2 + (y + dy / 2) * 7)) result.push(to);
    }
  }
  return result;
}
function independentLegal(s: GameState, a: Action): boolean {
  if (s.outcome) return false;
  if (a.type === "pass") return true;
  if (a.type === "summon")
    return (
      Number.isInteger(a.duration) &&
      a.duration >= 1 &&
      a.duration <= 5 &&
      Number.isInteger(a.to) &&
      a.to >= 0 &&
      a.to < 49 &&
      (s.turn === "white" ? a.to <= 20 : a.to >= 28) &&
      a.to !== 3 &&
      a.to !== 45 &&
      !s.pieces.some((q) => q.square === a.to) &&
      s.grain[s.turn] >= PRICE[a.kind] * a.duration
    );
  const mover = s.pieces.find((q) => q.id === a.pieceId && q.side === s.turn);
  if (!mover) return false;
  if (a.type === "move")
    return independentDestinations(s, mover).includes(a.to);
  const ally = s.pieces.find((q) => q.id === a.allyId && q.side === s.turn);
  return (
    mover.kind === "link" &&
    !!ally &&
    Math.abs((mover.square % 7) - (ally.square % 7)) +
      Math.abs(Math.floor(mover.square / 7) - Math.floor(ally.square / 7)) ===
      1
  );
}
function cpu(s: GameState) {
  const before = JSON.stringify(s),
    start = performance.now();
  const a = chooseCpuAction(s);
  expect(a).not.toBeNull();
  expect(independentLegal(s, a!)).toBe(true);
  expect(JSON.stringify(s)).toBe(before);
  // A generous regression guard for controlled Node fixtures, not a mobile benchmark.
  expect(performance.now() - start).toBeLessThan(5000);
  return a!;
}

scenario("S001", () => {
  const s = createGame();
  expect(s.pieces).toEqual([]);
  expect(s.cores).toEqual({ white: 3, black: 45 });
  expect(s.grain).toEqual({ white: 16, black: 12 });
  const r = step(s, { type: "pass" });
  expect(r.state.grain).toEqual({ white: 16, black: 16 });
  expect(r.state.pieces).toEqual([]);
  expect(r.state.turn).toBe("black");
});
scenario("S002", () => {
  const summons = legalActions(createGame()).filter(
    (a): a is Extract<Action, { type: "summon" }> =>
      a.type === "summon" && a.kind === "bastion" && a.duration === 1,
  );
  expect(summons.map((a) => a.to)).toEqual([
    0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  ]);
  expect(
    step(createGame(), { type: "summon", kind: "bastion", duration: 1, to: 20 })
      .state.grain.white,
  ).toBe(15);
});
scenario("S003", () => {
  const s = step(createGame(), { type: "pass" }).state;
  const summons = legalActions(s).filter(
    (a): a is Extract<Action, { type: "summon" }> =>
      a.type === "summon" && a.kind === "link" && a.duration === 1,
  );
  expect(summons.map((a) => a.to)).toEqual([
    28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 46, 47,
    48,
  ]);
  expect(
    step(s, { type: "summon", kind: "link", duration: 1, to: 28 }).state.grain
      .black,
  ).toBe(15);
});
scenario("S004", () => {
  for (const turn of ["white", "black"] as const)
    for (let to = 21; to <= 27; to++)
      reject(state([], { turn }), {
        type: "summon",
        kind: "bastion",
        duration: 1,
        to,
      });
});
scenario("S005", () => {
  for (const [turn, to] of [
    ["white", 3],
    ["black", 45],
  ] as const)
    reject(state([], { turn }), {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to,
    });
  reject(state([p("paid-wall", "bastion", "white", 14, 1)]), {
    type: "summon",
    kind: "link",
    duration: 2,
    to: 14,
  });
});
for (const [id, kind, duration, cost] of [
  ["S006", "bastion", 5, 5],
  ["S007", "carver", 4, 12],
  ["S008", "leaper", 3, 6],
  ["S009", "link", 2, 2],
] as const)
  scenario(id, () => {
    const s = createGame(),
      a: Action = { type: "summon", kind, duration, to: 14 };
    expect(previewAction(s, a)).toMatchObject({
      cost,
      reward: 0,
      grainAfter: 16 - cost,
      expires: [],
    });
    const r = step(s, a);
    expect(r.state.grain).toEqual({ white: 16 - cost, black: 16 });
    expect(r.state.pieces).toHaveLength(1);
    expect(r.state.pieces[0]).toMatchObject({
      kind,
      remaining: duration,
      square: 14,
    });
    expect(r.events.map((e) => [e.type, e.amount])).toEqual([
      ["summon", cost],
      ["income", 4],
    ]);
    expect(PRICES[kind]).toBe(PRICE[kind]);
  });
scenario("S010", () =>
  reject(state([], { grain: { white: 14, black: 20 } }), {
    type: "summon",
    kind: "carver",
    duration: 5,
    to: 20,
  }),
);
scenario("S011", () => {
  const r = step(state([], { grain: { white: 15, black: 20 } }), {
    type: "summon",
    kind: "carver",
    duration: 5,
    to: 20,
  });
  expect(r.state.grain).toEqual({ white: 0, black: 24 });
  expect(r.state.pieces[0].remaining).toBe(5);
});
scenario("S012", () => {
  const r = step(
    state([], { turn: "black", grain: { white: 999999, black: 600 } }),
    { type: "pass" },
  );
  expect(r.state.grain).toEqual({ white: 1000003, black: 600 });
  expect(validState(r.state)).toBe(true);
});
scenario("S013", () => {
  const s = state(
    [
      p("jump", "leaper", "white", 23, 2),
      p("pad", "link", "black", 24, 4),
      p("prize", "carver", "black", 25, 5),
    ],
    { grain: { white: 995, black: 20 } },
  );
  const r = step(s, { type: "move", pieceId: "jump", to: 25 });
  expect(r.state.grain).toEqual({ white: 1010, black: 24 });
  expect(r.state.pieces.find((q) => q.id === "pad")).toEqual(
    p("pad", "link", "black", 24, 4),
  );
  expect(r.state.pieces.find((q) => q.id === "prize")).toBeUndefined();
});
scenario("S014", () => {
  const s = state([
    p("old1", "bastion", "white", 0, 1),
    p("old2", "carver", "white", 8, 2),
    p("old5", "link", "white", 9, 5),
  ]);
  const r = step(s, { type: "summon", kind: "leaper", duration: 1, to: 14 });
  expect(r.state.pieces.map((q) => [q.kind, q.remaining])).toEqual([
    ["carver", 1],
    ["link", 4],
    ["leaper", 1],
  ]);
  expect(r.events.find((e) => e.type === "expire")?.pieceIds).toEqual(["old1"]);
});
scenario("S015", () => {
  const enemy = [
    p("enemy1", "leaper", "black", 28, 1),
    p("enemy5", "carver", "black", 35, 5),
  ];
  const r = step(state(enemy), {
    type: "summon",
    kind: "bastion",
    duration: 1,
    to: 14,
  });
  expect(r.state.pieces.filter((q) => q.side === "black")).toEqual(enemy);
  expect(expiryExplanation(r.state, enemy[0])).toMatch(/^この黒/);
});
scenario("S016", () => {
  let s = step(createGame(), {
    type: "summon",
    kind: "bastion",
    duration: 1,
    to: 14,
  }).state;
  const id = s.pieces[0].id;
  expect(s.pieces[0].remaining).toBe(1);
  s = step(s, { type: "pass" }).state;
  expect(s.pieces[0].remaining).toBe(1);
  expect(expiryExplanation(s, s.pieces[0])).toMatch(/^この白/);
  const r = step(s, { type: "pass" });
  expect(r.state.pieces).toEqual([]);
  expect(r.events[0]).toMatchObject({ type: "expire", pieceIds: [id] });
});
scenario("S017", () => {
  let s = step(createGame(), {
    type: "summon",
    kind: "link",
    duration: 5,
    to: 14,
  }).state;
  const id = s.pieces[0].id;
  for (let ownEnds = 1; ownEnds <= 5; ownEnds++) {
    s = step(s, {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: ownEnds % 2 ? 48 : 47,
    }).state;
    expect(s.pieces.find((q) => q.id === id)?.remaining).toBe(6 - ownEnds);
    s = step(s, { type: "pass" }).state;
    expect(s.pieces.find((q) => q.id === id)?.remaining).toBe(
      ownEnds === 5 ? undefined : 5 - ownEnds,
    );
  }
  expect(s.outcome).toBeNull();
});
scenario("S018", () => {
  const old = {
    ...p("historical-stamp", "link", "white", 14, 1),
    summonedPly: 20,
  };
  const r = step(state([old]), {
    type: "summon",
    kind: "bastion",
    duration: 2,
    to: 15,
  });
  expect(r.state.pieces.map((q) => q.kind)).toEqual(["bastion"]);
  expect(r.state.pieces[0].remaining).toBe(2);
});
scenario("S019", () => {
  const s = state([p("costly", "carver", "white", 14, 1)]);
  const r = step(s, { type: "pass" });
  expect(r.state.grain).toEqual({ white: 20, black: 24 });
  expect(r.events.map((e) => e.type)).toEqual(["expire", "income"]);
  expect(transitionText(s, r.state)).toContain("1体が退場");
  expect(transitionText(s, r.state)).not.toContain("捕獲");
});
scenario("S020", () => {
  const s = state([
    p("wall", "bastion", "white", 14, 1),
    p("blade", "carver", "white", 15, 1),
    p("hop", "leaper", "white", 16, 1),
    p("chain", "link", "white", 17, 1),
  ]);
  const r = step(s, { type: "pass" });
  expect(r.state.pieces).toEqual([]);
  expect(r.events.filter((e) => e.type === "expire")).toHaveLength(1);
  expect(r.events[0].pieceIds).toEqual(["wall", "blade", "hop", "chain"]);
  expect(previewAction(s, { type: "pass" })?.expires).toEqual([
    "wall",
    "blade",
    "hop",
    "chain",
  ]);
});
scenario("S021", () => {
  const s = state([
    p("chain", "link", "white", 14, 1),
    p("wall", "bastion", "white", 15, 3),
  ]);
  const r = step(s, { type: "swap", pieceId: "chain", allyId: "wall" });
  expect(r.state.pieces).toEqual([p("wall", "bastion", "white", 14, 2)]);
  expect(r.events.map((e) => e.type)).toEqual(["swap", "expire", "income"]);
  expect(transitionText(s, r.state)).toContain("位置交換");
});
scenario("S022", () => {
  const s = state([
    p("jump", "leaper", "white", 23, 1),
    p("pad", "bastion", "white", 24, 1),
    p("victim", "carver", "black", 25, 3),
  ]);
  const copy = JSON.stringify(s);
  Object.freeze(s.cores);
  Object.freeze(s.grain);
  s.pieces.forEach(Object.freeze);
  Object.freeze(s.pieces);
  Object.freeze(s);
  const r = step(s, { type: "move", pieceId: "jump", to: 25 });
  expect(r.state.pieces).toEqual([]);
  expect(r.state.grain).toEqual({ white: 29, black: 24 });
  expect(JSON.stringify(s)).toBe(copy);
});
scenario("S023", () =>
  reject(state([p("rival", "carver", "black", 24, 3)]), {
    type: "move",
    pieceId: "rival",
    to: 32,
  }),
);
scenario("S024", () => {
  for (const duration of [0, 6, 1.5, -1, NaN, Infinity])
    reject(createGame(), { type: "summon", kind: "carver", duration, to: 14 });
});
scenario("S025", () => {
  const s = state([
    p("blade", "carver", "white", 24, 3),
    p("east", "bastion", "black", 25, 3),
    p("north", "bastion", "white", 31, 3),
  ]);
  reject(s, { type: "move", pieceId: "blade", to: 32 });
});
scenario("S026", () => {
  for (const to of [-1, 49, 7.5, NaN, Infinity])
    reject(createGame(), { type: "summon", kind: "bastion", duration: 1, to });
});
scenario("S027", () => {
  const s = state([], { outcome: { kind: "draw", reason: "limit" }, ply: 200 });
  reject(s, { type: "pass" });
  reject(s, { type: "summon", kind: "bastion", duration: 1, to: 0 });
  expect(legalActions(s)).toEqual([]);
});
scenario("S028", () => {
  const s = state([
    p("jump", "leaper", "white", 23, 1),
    p("pad", "bastion", "white", 24, 1),
    p("victim", "carver", "black", 25, 3),
  ]);
  const a: Action = { type: "move", pieceId: "jump", to: 25 };
  expect(previewAction(s, a)).toMatchObject({
    reward: 9,
    grainAfter: 29,
    expires: ["jump", "pad"],
  });
  const r = step(s, a);
  expect(r.events.map((e) => e.type)).toEqual([
    "capture",
    "move",
    "expire",
    "income",
  ]);
  expect(r.state.pieces).toEqual([]);
  expect(transitionText(s, r.state)).toContain("捕獲 +9糧");
});
scenario("S029", () => {
  const s = state([
    p("blade", "carver", "white", 36, 1),
    p("old-wall", "bastion", "white", 0, 1),
  ]);
  const a: Action = { type: "move", pieceId: "blade", to: 45 };
  const r = step(s, a);
  expect(r.state.outcome).toEqual({ kind: "win", winner: "white" });
  expect(r.state.pieces.map((q) => q.remaining)).toEqual([1, 1]);
  expect(r.state.grain).toEqual({ white: 20, black: 20 });
  expect(r.events.map((e) => e.type)).toEqual(["move", "finish"]);
  expect(previewAction(s, a)?.expires).toEqual([]);
  expect(outcomeNotice(r.state.outcome)).toContain("勝利");
});
scenario("S030", () => {
  const s = state([p("blade", "carver", "black", 12, 1)], {
    turn: "black",
    ply: 199,
    consecutivePasses: 5,
  });
  const r = step(s, { type: "move", pieceId: "blade", to: 3 });
  expect(r.state.outcome).toEqual({ kind: "win", winner: "black" });
  expect(r.state.ply).toBe(200);
  expect(r.state.pieces[0].remaining).toBe(1);
  expect(r.events.map((e) => e.type)).toEqual(["move", "finish"]);
});
for (const [id, kind, remaining, reward] of [
  ["S031", "carver", 3, 9],
  ["S032", "leaper", 5, 10],
  ["S033", "bastion", 1, 1],
  ["S034", "link", 4, 4],
] as const)
  scenario(id, () => {
    const s = state([
      p("blade", "carver", "white", 24, 3),
      p("victim", kind, "black", 32, remaining),
    ]);
    const a: Action = { type: "move", pieceId: "blade", to: 32 };
    expect(previewAction(s, a)?.reward).toBe(reward);
    const r = step(s, a);
    expect(r.state.grain).toEqual({ white: 20 + reward, black: 24 });
    expect(r.state.pieces).toEqual([p("blade", "carver", "white", 32, 2)]);
    expect(r.events[0]).toMatchObject({
      type: "capture",
      amount: reward,
      pieceIds: ["victim"],
    });
  });
scenario("S035", () => {
  for (const square of [0, 6, 42, 48, 7, 13, 21, 27, 24]) {
    const mover = p("blade", "carver", "white", square, 3),
      s = state([mover]);
    expect([...movePaths(s, mover).keys()].sort((a, b) => a - b)).toEqual(
      independentDestinations(s, mover),
    );
    for (const a of pieceActions(s, mover))
      expect(independentLegal(s, a)).toBe(true);
  }
});
scenario("S036", () => {
  const mover = p("blade", "carver", "white", 24, 3);
  const s = state([mover, p("east-block", "bastion", "black", 25, 3)]);
  expect(movePaths(s, mover).get(32)).toEqual([[31, 32]]);
  expect(
    step(s, { type: "move", pieceId: "blade", to: 32 }).state.pieces.find(
      (q) => q.id === "blade",
    )?.square,
  ).toBe(32);
});
scenario("S037", () => {
  const mover = p("blade", "carver", "white", 24, 3);
  const blocked = state([mover, p("bend-block", "bastion", "black", 32, 3)]);
  reject(blocked, { type: "move", pieceId: "blade", to: 39 });
  const clear = state([mover]);
  expect(movePaths(clear, mover).get(39)).toEqual([[25, 32, 39]]);
  expect(
    step(clear, { type: "move", pieceId: "blade", to: 39 }).state.pieces[0]
      .square,
  ).toBe(39);
});
scenario("S038", () => {
  const s = state([
    p("jump", "leaper", "white", 23, 3),
    p("pad", "bastion", "white", 24, 3),
  ]);
  const r = step(s, { type: "move", pieceId: "jump", to: 25 });
  expect(r.state.pieces).toEqual([
    p("jump", "leaper", "white", 25, 2),
    p("pad", "bastion", "white", 24, 2),
  ]);
  expect(r.events.some((e) => e.type === "capture")).toBe(false);
});
scenario("S039", () => {
  const s = state([
    p("jump", "leaper", "white", 23, 3),
    p("pad", "carver", "black", 24, 5),
  ]);
  const r = step(s, { type: "move", pieceId: "jump", to: 25 });
  expect(r.state.pieces.find((q) => q.id === "pad")).toEqual(
    p("pad", "carver", "black", 24, 5),
  );
  expect(r.state.grain.white).toBe(20);
  expect(
    previewAction(s, { type: "move", pieceId: "jump", to: 25 })?.reward,
  ).toBe(0);
});
scenario("S040", () => {
  const s = state([p("jump", "leaper", "white", 2, 3)]);
  expect(movePaths(s, s.pieces[0]).get(4)).toEqual([[3, 4]]);
  const r = step(s, { type: "move", pieceId: "jump", to: 4 });
  expect(r.state.cores).toEqual({ white: 3, black: 45 });
  expect(r.state.outcome).toBeNull();
});
scenario("S041", () => {
  const s = state([p("jump", "leaper", "white", 23, 3)]);
  reject(s, { type: "move", pieceId: "jump", to: 25 });
  expect(movePaths(s, s.pieces[0]).size).toBe(0);
});
scenario("S042", () => {
  const s = state([
    p("chain", "link", "white", 10, 3),
    p("orth", "carver", "white", 11, 3),
    p("diagonal", "bastion", "white", 18, 3),
    p("enemy", "bastion", "black", 9, 3),
  ]);
  expect(pieceActions(s, s.pieces[0])).toEqual([
    { type: "swap", pieceId: "chain", allyId: "orth" },
  ]);
  reject(s, { type: "swap", pieceId: "chain", allyId: "diagonal" });
  reject(s, { type: "swap", pieceId: "chain", allyId: "enemy" });
  reject(s, { type: "move", pieceId: "chain", to: 3 });
});
scenario("S043", () => {
  const s = state(
    [
      p("winner", "carver", "white", 36, 1),
      p("valuable", "carver", "black", 28, 5),
    ],
    { grain: { white: 200, black: 200 } },
  );
  expect(cpu(s)).toEqual({ type: "move", pieceId: "winner", to: 45 });
});
scenario("S044", () => {
  const s = state(
    [
      p("winner", "leaper", "black", 17, 1),
      p("pad", "bastion", "white", 10, 1),
    ],
    { turn: "black" },
  );
  expect(cpu(s)).toEqual({ type: "move", pieceId: "winner", to: 3 });
});
scenario("S045", () => {
  const s = state([], { grain: { white: 0, black: 0 } });
  expect(cpu(s)).toEqual({ type: "pass" });
  expect(step(s, { type: "pass" }).state.grain).toEqual({ white: 0, black: 4 });
});
scenario("S046", () => {
  for (const outcome of [
    { kind: "win", winner: "white" },
    { kind: "draw", reason: "passes" },
    { kind: "draw", reason: "limit" },
  ] as const)
    expect(chooseCpuAction(state([], { outcome }))).toBeNull();
});
scenario("S047", () => {
  const s = state(
    [p("jump", "leaper", "black", 30, 2), p("pad", "bastion", "white", 23, 2)],
    { turn: "black", grain: { white: 0, black: 2 } },
  );
  const before = JSON.stringify(s),
    a = cpu(s);
  expect(cpu(s)).toEqual(a);
  expect(cpu(s)).toEqual(a);
  expect(JSON.stringify(s)).toBe(before);
});
scenario("S048", () => {
  const s = state([p("threat", "carver", "white", 36, 3)], {
    turn: "black",
    grain: { white: 0, black: 1 },
  });
  const action = cpu(s),
    next = step(s, action).state;
  expect(action).toMatchObject({ type: "summon", duration: 1, to: 43 });
  expect(
    independentDestinations(
      next,
      next.pieces.find((q) => q.id === "threat")!,
    ),
  ).not.toContain(45);
});
scenario("S049", () => {
  const s = state(
    [
      p("threat", "leaper", "black", 17, 1),
      p("doomed-pad", "bastion", "white", 10, 1),
    ],
    { grain: { white: 0, black: 0 } },
  );
  const a = cpu(s);
  expect(a).toEqual({ type: "pass" });
  const next = step(s, a).state;
  expect(independentDestinations(next, next.pieces[0])).not.toContain(3);
});
scenario("S050", () => {
  const s = state([p("threat", "carver", "black", 9, 2)], {
    consecutivePasses: 5,
    grain: { white: 100, black: 0 },
  });
  for (const candidate of legalActions(s)) {
    if (candidate.type !== "summon") continue;
    const after = step(s, candidate).state;
    expect(
      independentDestinations(
        after,
        after.pieces.find((q) => q.id === "threat")!,
      ),
    ).toContain(3);
  }
  expect(cpu(s)).toEqual({ type: "pass" });
  expect(step(s, { type: "pass" }).state.outcome).toEqual({
    kind: "draw",
    reason: "passes",
  });
});
scenario("S051", () => {
  const s = state([], { turn: "black", grain: { white: 0, black: 1 } });
  const a = cpu(s);
  if (a.type === "summon") {
    expect(["bastion", "link"]).toContain(a.kind);
    expect(a.duration).toBe(1);
    expect(a.to).toBeGreaterThanOrEqual(28);
  } else expect(a).toEqual({ type: "pass" });
  expect(step(s, a).state.grain.black).toBeGreaterThanOrEqual(0);
});
scenario("S052", () => {
  const s = state([p("attacker", "carver", "white", 31, 2)], {
    grain: { white: 0, black: 0 },
  });
  const a = cpu(s);
  expect(a.type).toBe("move");
  if (a.type !== "move") throw Error("Expected advance toward a forced win");
  expect([37, 39]).toContain(a.to);
  const advanced = step(s, a).state;
  expect(advanced.pieces[0].remaining).toBe(1);
  for (const reply of legalActions(advanced)) {
    const next = step(advanced, reply).state;
    expect(
      independentDestinations(
        next,
        next.pieces.find((q) => q.id === "attacker")!,
      ),
    ).toContain(45);
  }
});
scenario("S053", () => {
  let s = createGame();
  const income = { white: 4, black: 0 },
    spent = { white: 0, black: 0 };
  for (let ply = 0; ply < 200; ply++) {
    const side = ply % 2 ? "black" : "white",
      round = Math.floor(ply / 2),
      to = side === "white" ? round % 2 : 48 - (round % 2);
    const r = step(s, { type: "summon", kind: "bastion", duration: 1, to });
    spent[side]++;
    if (ply < 199) income[side === "white" ? "black" : "white"] += 4;
    expect(r.events.filter((e) => e.type === "income")).toHaveLength(
      ply === 199 ? 0 : 1,
    );
    expect(r.state.grain).toEqual({
      white: 12 + income.white - spent.white,
      black: 12 + income.black - spent.black,
    });
    expect(r.state.pieces.filter((q) => q.side === side)).toHaveLength(1);
    expect(r.state.pieces.every((q) => q.remaining === 1)).toBe(true);
    expect(r.state.outcome).toEqual(
      ply === 199 ? { kind: "draw", reason: "limit" } : null,
    );
    s = r.state;
  }
  expect(s.grain).toEqual({ white: 312, black: 312 });
  expect(s.pieces).toHaveLength(2);
  reject(s, { type: "pass" });
});
scenario("S054", () => {
  let s = createGame();
  const cash = { white: 16, black: 12 },
    contracts: { side: Side; kind: Kind; square: number; left: number }[] = [];
  const buys = [
    ["bastion", 1],
    ["link", 2],
    ["leaper", 1],
    ["carver", 1],
    ["bastion", 5],
  ] as const;
  for (let ply = 0; ply < 200; ply++) {
    const side: Side = ply % 2 ? "black" : "white",
      [kind, duration] =
        buys[(Math.floor(ply / 2) + (side === "black" ? 2 : 0)) % buys.length];
    const squares = Array.from({ length: 21 }, (_, i) =>
      side === "white" ? i : i + 28,
    );
    const to = squares.find(
      (q) => q !== 3 && q !== 45 && !contracts.some((c) => c.square === q),
    )!;
    const a: Action = { type: "summon", kind, duration, to };
    expect(previewAction(s, a)?.grainAfter).toBe(
      cash[side] - PRICE[kind] * duration,
    );
    cash[side] -= PRICE[kind] * duration;
    for (const c of contracts) if (c.side === side) c.left--;
    for (let i = contracts.length - 1; i >= 0; i--)
      if (contracts[i].left === 0) contracts.splice(i, 1);
    contracts.push({ side, kind, square: to, left: duration });
    if (ply < 199) cash[side === "white" ? "black" : "white"] += 4;
    s = step(s, a).state;
    expect(s.grain).toEqual(cash);
    expect(
      s.pieces.map((q) => [q.side, q.kind, q.square, q.remaining]),
    ).toEqual(contracts.map((c) => [c.side, c.kind, c.square, c.left]));
    expect(validState(s)).toBe(true);
  }
  expect(s.outcome).toEqual({ kind: "draw", reason: "limit" });
  expect(s.grain).toEqual({ white: 152, black: 152 });
});
scenario("S055", () => {
  let s = state([
    p("wl", "link", "white", 14, 5),
    p("ww", "bastion", "white", 15, 5),
    p("bl", "link", "black", 33, 5),
    p("bw", "bastion", "black", 34, 5),
  ]);
  const originalSquares = s.pieces.map((q) => q.square);
  for (let i = 0; i < 8; i++) {
    s = step(s, {
      type: "swap",
      pieceId: i % 2 ? "bl" : "wl",
      allyId: i % 2 ? "bw" : "ww",
    }).state;
    expect(s.outcome).toBeNull();
    expect(s.consecutivePasses).toBe(0);
  }
  expect(s.pieces.map((q) => q.square)).toEqual(originalSquares);
  expect(s.pieces.map((q) => q.remaining)).toEqual([1, 1, 1, 1]);
  expect(s.grain).toEqual({ white: 36, black: 36 });
});
scenario("S056", () => {
  let s = createGame();
  for (let i = 0; i < 5; i++) s = step(s, { type: "pass" }).state;
  expect(s.outcome).toBeNull();
  expect(s.consecutivePasses).toBe(5);
  s = step(s, { type: "summon", kind: "link", duration: 1, to: 28 }).state;
  expect(s.consecutivePasses).toBe(0);
  for (let i = 0; i < 5; i++) {
    s = step(s, { type: "pass" }).state;
    expect(s.outcome).toBeNull();
  }
  const before = { ...s.grain },
    r = step(s, { type: "pass" });
  expect(r.state.outcome).toEqual({ kind: "draw", reason: "passes" });
  expect(r.state.grain).toEqual(before);
  expect(r.events.map((e) => e.type)).toEqual(["finish"]);
});
scenario("S057", () => {
  const s = state([p("old", "carver", "black", 30, 1)], {
    turn: "black",
    ply: 199,
  });
  const r = step(s, { type: "pass" });
  expect(r.state.outcome).toEqual({ kind: "draw", reason: "limit" });
  expect(r.state.pieces).toEqual([]);
  expect(r.state.grain).toEqual({ white: 20, black: 20 });
  expect(r.events.map((e) => e.type)).toEqual(["expire", "finish"]);
  expect(outcomeNotice(r.state.outcome)).toContain("200手");
});
scenario("S058", () => {
  const r = step(state([], { turn: "black", ply: 199, consecutivePasses: 5 }), {
    type: "pass",
  });
  expect(r.state.outcome).toEqual({ kind: "draw", reason: "passes" });
  expect(r.state.ply).toBe(200);
  expect(r.state.consecutivePasses).toBe(6);
  expect(outcomeNotice(r.state.outcome)).toContain("6回連続");
  expect(r.events.map((e) => e.type)).toEqual(["finish"]);
});
scenario("S059", () => {
  const s = createGame(),
    a: Action = { type: "summon", kind: "carver", duration: 3, to: 14 },
    snapshot = JSON.stringify(s);
  for (let i = 0; i < 100; i++)
    expect(previewAction(s, a)).toMatchObject({
      cost: 9,
      grainAfter: 7,
      reward: 0,
      expires: [],
    });
  expect(JSON.stringify(s)).toBe(snapshot);
  const r = step(s, a);
  expect(r.state.grain).toEqual({ white: 7, black: 16 });
  expect(r.events.filter((e) => e.type === "income")).toHaveLength(1);
  expect(r.state.ply).toBe(1);
});
scenario("S060", () => {
  let s = createGame(),
    moved = 0,
    actions = 0;
  const cash = { white: 16, black: 12 };
  while (!s.outcome && actions < 60) {
    const side = s.turn,
      a = side === "white" ? { type: "pass" as const } : cpu(s);
    if (a.type === "summon") cash[side] -= PRICE[a.kind] * a.duration;
    if (a.type === "move") {
      moved++;
      const victim = s.pieces.find((q) => q.square === a.to);
      if (victim) cash[side] += PRICE[victim.kind] * victim.remaining;
    }
    const r = step(s, a);
    if (!r.state.outcome) cash[side === "white" ? "black" : "white"] += 4;
    expect(r.state.grain).toEqual(cash);
    expect(r.events.filter((e) => e.type === "income")).toHaveLength(
      r.state.outcome ? 0 : 1,
    );
    s = r.state;
    actions++;
  }
  expect(moved).toBeGreaterThan(0);
  expect(s.outcome).toEqual({ kind: "win", winner: "black" });
  expect(actions).toBeLessThan(60);
});
if (registered.size !== 60 || ledger.length !== 60)
  throw Error(
    `Expected exactly 60 named scenarios; got ${registered.size} tests / ${ledger.length} records`,
  );
