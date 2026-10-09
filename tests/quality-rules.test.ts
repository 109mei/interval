import assert from "node:assert/strict";
import { applyAction, createGame, previewAction } from "../src/game/engine";
import {
  isLegal,
  legalActions,
  movePaths,
  pieceActions,
  PRICES,
  validState,
} from "../src/game/rules";
import type {
  Action,
  GameState,
  Kind,
  Piece,
  Side,
  Transition,
} from "../src/game/types";
import { createCaseLedger } from "./quality/case-ledger";

// These constants and destination-first oracles are independently derived from
// the rules in README.md. They deliberately do not call production geometry,
// production PRICES, legalActions, or applyAction to calculate expectations.
const PRICE: Record<Kind, number> = {
  bastion: 1,
  carver: 3,
  leaper: 2,
  link: 1,
};
const KINDS: readonly Kind[] = ["bastion", "carver", "leaper", "link"];
const SIDES: readonly Side[] = ["white", "black"];
const SQUARES = Array.from({ length: 49 }, (_, i) => i);
const PIECE_SQUARES = SQUARES.filter((q) => q !== 3 && q !== 45);
const other = (side: Side): Side => (side === "white" ? "black" : "white");
const xy = (q: number) => [q % 7, Math.floor(q / 7)] as const;
const manhattan = (a: number, b: number) => {
  const [ax, ay] = xy(a),
    [bx, by] = xy(b);
  return Math.abs(ax - bx) + Math.abs(ay - by);
};
const chebyshev = (a: number, b: number) => {
  const [ax, ay] = xy(a),
    [bx, by] = xy(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
};
const piece = (
  id: string,
  kind: Kind,
  square: number,
  side: Side,
  remaining = 4,
): Piece => ({ id, kind, square, side, remaining, summonedPly: -1 });
const fixture = (
  pieces: Piece[] = [],
  extra: Partial<GameState> = {},
): GameState => ({
  pieces,
  cores: { white: 3, black: 45 },
  grain: { white: 40, black: 40 },
  turn: "white",
  ply: 20,
  consecutivePasses: 0,
  outcome: null,
  ...extra,
});
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const sorted = (values: Iterable<number>) => [...values].sort((a, b) => a - b);
const actionKey = (a: Action) =>
  a.type === "pass"
    ? "pass"
    : a.type === "summon"
      ? `summon:${a.kind}:${a.duration}:${a.to}`
      : a.type === "move"
        ? `move:${a.pieceId}:${a.to}`
        : `swap:${a.pieceId}:${a.allyId}`;
const actionKeys = (actions: readonly Action[]) =>
  actions.map(actionKey).sort();
const occupiedSquares = (s: GameState) =>
  new Set([...s.pieces.map((p) => p.square), 3, 45]);

function oraclePaths(s: GameState, p: Piece): Map<number, number[][]> {
  const paths = new Map<number, number[][]>();
  const occupied = occupiedSquares(s);
  const [sx, sy] = xy(p.square);
  for (const to of SQUARES) {
    if (
      to === s.cores[p.side] ||
      s.pieces.some((q) => q.square === to && q.side === p.side)
    )
      continue;
    const [tx, ty] = xy(to),
      dx = tx - sx,
      dy = ty - sy;
    const candidates: number[][] = [];
    if (p.kind === "carver") {
      // Enumerate destinations by their displacement, then build each possible
      // right-angle route. Diagonals may have two independent legal routes.
      if (Math.abs(dx) === 1 && [1, 2].includes(Math.abs(dy))) {
        candidates.push(
          Array.from(
            { length: Math.abs(dy) + 1 },
            (_, step) => sx + dx + 7 * (sy + Math.sign(dy) * step),
          ),
        );
      }
      if (Math.abs(dy) === 1 && [1, 2].includes(Math.abs(dx))) {
        candidates.push(
          Array.from(
            { length: Math.abs(dx) + 1 },
            (_, step) => sx + Math.sign(dx) * step + 7 * (sy + dy),
          ),
        );
      }
      const clear = candidates.filter((path) =>
        path.slice(0, -1).every((q) => !occupied.has(q)),
      );
      if (clear.length) paths.set(to, clear);
    }
    if (
      p.kind === "leaper" &&
      [0, 2].includes(Math.abs(dx)) &&
      [0, 2].includes(Math.abs(dy)) &&
      (dx || dy)
    ) {
      const mid = sx + dx / 2 + 7 * (sy + dy / 2);
      if (occupied.has(mid)) paths.set(to, [[mid, to]]);
    }
  }
  return paths;
}

function oraclePieceActions(s: GameState, p: Piece): Action[] {
  if (p.side !== s.turn) return [];
  if (p.kind === "link")
    return s.pieces
      .filter(
        (q) =>
          q.id !== p.id &&
          q.side === p.side &&
          manhattan(q.square, p.square) === 1,
      )
      .map((q) => ({ type: "swap", pieceId: p.id, allyId: q.id }));
  return [...oraclePaths(s, p).keys()].map((to) => ({
    type: "move",
    pieceId: p.id,
    to,
  }));
}
function oracleActions(s: GameState): Action[] {
  if (s.outcome) return [];
  const occupied = occupiedSquares(s);
  const actions: Action[] = s.pieces.flatMap((p) => oraclePieceActions(s, p));
  for (const to of SQUARES) {
    const home =
      s.turn === "white" ? Math.floor(to / 7) <= 2 : Math.floor(to / 7) >= 4;
    if (occupied.has(to) || !home) continue;
    for (const kind of KINDS)
      for (let duration = 1; duration <= 5; duration++)
        if (s.grain[s.turn] >= PRICE[kind] * duration)
          actions.push({ type: "summon", kind, duration, to });
  }
  return [...actions, { type: "pass" }];
}
function normalizedPaths(paths: Map<number, number[][]>) {
  return [...paths]
    .map(([to, routes]) => ({
      to,
      routes: routes.map((r) => r.join(",")).sort(),
    }))
    .sort((a, b) => a.to - b.to);
}
type Success = Extract<Transition, { ok: true }>;

/** Compare a transition against accounting, identity, lifetime, and geometry
 * invariants. This is not a second implementation of the engine event reducer. */
function verifyTransition(s: GameState, a: Action): Success {
  const before = JSON.stringify(s),
    actionBefore = JSON.stringify(a);
  const preview = previewAction(s, a);
  const result = applyAction(s, a);
  assert.equal(result.ok, true, actionKey(a));
  assert.ok(preview);
  assert.equal(JSON.stringify(s), before, "source state must be immutable");
  assert.equal(JSON.stringify(a), actionBefore, "action must be immutable");
  const next = result.state;
  const side = s.turn,
    enemy = other(side);
  const victim =
    a.type === "move" ? s.pieces.find((p) => p.square === a.to) : undefined;
  const reward = victim ? PRICE[victim.kind] * victim.remaining : 0;
  const cost = a.type === "summon" ? PRICE[a.kind] * a.duration : 0;
  const wins = a.type === "move" && a.to === s.cores[enemy];
  const passCount = a.type === "pass" ? s.consecutivePasses + 1 : 0;
  const drawn = !wins && (passCount >= 6 || s.ply + 1 >= 200);
  assert.equal(next.ply, s.ply + 1);
  assert.equal(next.grain[side], s.grain[side] - cost + reward);
  assert.equal(next.grain[enemy], s.grain[enemy] + (wins || drawn ? 0 : 4));
  assert.deepEqual(next.cores, s.cores);
  assert.equal(next.turn, wins ? side : enemy);
  assert.deepEqual(preview.cost, cost);
  assert.deepEqual(preview.reward, reward);
  assert.equal(preview.grainAfter, next.grain[side]);
  const expired = wins
    ? []
    : s.pieces
        .filter((p) => p.side === side && p.remaining === 1)
        .map((p) => p.id)
        .sort();
  assert.deepEqual([...preview.expires].sort(), expired);
  assert.deepEqual(
    result.events
      .filter((e) => e.type === "expire")
      .flatMap((e) => e.pieceIds)
      .sort(),
    expired,
  );
  assert.equal(
    result.events.filter((e) => e.type === "income").length,
    wins || drawn ? 0 : 1,
  );
  if (!wins && !drawn)
    assert.deepEqual(result.events.at(-1), {
      type: "income",
      side: enemy,
      pieceIds: [],
      squares: [],
      amount: 4,
    });
  if (wins) assert.deepEqual(next.outcome, { kind: "win", winner: side });
  else if (drawn) assert.equal(next.outcome?.kind, "draw");
  else assert.equal(next.outcome, null);
  assert.equal(
    result.events.filter((e) => e.type === "finish").length,
    wins || drawn ? 1 : 0,
  );
  if (!wins) assert.equal(next.consecutivePasses, passCount);
  const capture = result.events.find((e) => e.type === "capture");
  if (victim) {
    assert.deepEqual(capture, {
      type: "capture",
      side,
      pieceIds: [victim.id],
      squares: [victim.square],
      amount: reward,
    });
    assert.ok(
      result.events.findIndex((e) => e.type === "capture") <
        result.events.findIndex((e) => e.type === "move"),
    );
  } else assert.equal(capture, undefined);
  for (const old of s.pieces) {
    const current = next.pieces.find((p) => p.id === old.id);
    if (old.id === victim?.id || expired.includes(old.id)) {
      assert.equal(current, undefined, `${old.id} must retire exactly once`);
      continue;
    }
    assert.ok(current, `${old.id} must survive`);
    let square = old.square;
    if (a.type === "move" && old.id === a.pieceId) square = a.to;
    if (a.type === "swap" && old.id === a.pieceId)
      square = s.pieces.find((p) => p.id === a.allyId)!.square;
    if (a.type === "swap" && old.id === a.allyId)
      square = s.pieces.find((p) => p.id === a.pieceId)!.square;
    assert.deepEqual(current, {
      ...old,
      square,
      remaining: old.remaining - (!wins && old.side === side ? 1 : 0),
    });
  }
  const newborns = next.pieces.filter(
    (p) => !s.pieces.some((old) => old.id === p.id),
  );
  if (a.type === "summon") {
    assert.equal(newborns.length, 1);
    assert.deepEqual(newborns[0], {
      id: `${side}-${s.ply}-${a.to}`,
      kind: a.kind,
      side,
      square: a.to,
      remaining: a.duration,
      summonedPly: s.ply,
    });
  } else assert.equal(newborns.length, 0);
  assert.equal(new Set(next.pieces.map((p) => p.id)).size, next.pieces.length);
  assert.equal(
    new Set(next.pieces.map((p) => p.square)).size,
    next.pieces.length,
  );
  if (!wins) assert.equal(validState(next), true);
  assert.deepEqual(
    preview.targets,
    a.type === "move" || a.type === "summon"
      ? [a.to]
      : a.type === "swap"
        ? [s.pieces.find((p) => p.id === a.allyId)!.square]
        : [],
  );
  if (a.type === "move") {
    const mover = s.pieces.find((p) => p.id === a.pieceId)!;
    assert.deepEqual(
      preview.paths.map((p) => p.join(",")).sort(),
      oraclePaths(s, mover)
        .get(a.to)!
        .map((p) => p.join(","))
        .sort(),
    );
  } else assert.deepEqual(preview.paths, []);
  return result;
}
function verifyRejected(s: GameState, a: Action) {
  const before = JSON.stringify(s),
    actionBefore = JSON.stringify(a);
  assert.equal(isLegal(s, a), false);
  assert.equal(previewAction(s, a), null);
  const result = applyAction(s, a);
  assert.equal(result.ok, false);
  assert.equal(
    result.state,
    s,
    "rejected action must return the original state",
  );
  assert.equal(JSON.stringify(s), before);
  assert.equal(JSON.stringify(a), actionBefore);
}

const { registerCase, manifest } = createCaseLedger("rules");
export const rulesCaseManifest = manifest;

// 47 playable origins × 2 owners × 2 moving roles × 4 board topologies = 752.
const patterns = [
  "clear",
  "allied-ring",
  "enemy-ring",
  "mixed-blockers",
] as const;
for (const side of SIDES)
  for (const kind of ["carver", "leaper"] as const)
    for (const origin of PIECE_SQUARES)
      for (const pattern of patterns) {
        const actor = piece("actor", kind, origin, side);
        const neighbors = PIECE_SQUARES.filter(
          (q) => q !== origin && chebyshev(q, origin) <= 2,
        );
        const blockers = neighbors
          .filter((q) =>
            pattern === "clear"
              ? false
              : pattern === "mixed-blockers"
                ? (q * 13 + origin * 7) % 5 < 2
                : chebyshev(q, origin) === 1 || (q + origin) % 3 === 0,
          )
          .map((q, i) =>
            piece(
              `block-${q}`,
              KINDS[i % 4],
              q,
              pattern === "allied-ring"
                ? side
                : pattern === "enemy-ring"
                  ? other(side)
                  : (q + origin) % 2
                    ? side
                    : other(side),
              1 + (i % 5),
            ),
          );
        const s = freeze(fixture([actor, ...blockers], { turn: side }));
        registerCase(
          {
            id: `rules.geometry.${side}.${kind}.${origin}.${pattern}`,
            category: "movement-board-and-blockers",
            inputs: { state: s, inspectedPiece: actor.id },
            assertions: [
              "Destination-first oracle exactly matches every legal route and target across all 49 squares",
              "Friendly landing/core blocked; enemy target capturable; blockers or leap pads affect only the correct path",
              "Every legal transition obeys independent accounting, lifetime, identity and preview invariants",
              "The opponent cannot execute the same inspected geometry; source and action stay immutable",
            ],
          },
          () => {
            assert.equal(validState(s), true);
            assert.deepEqual(
              normalizedPaths(movePaths(s, actor)),
              normalizedPaths(oraclePaths(s, actor)),
            );
            assert.deepEqual(
              actionKeys(pieceActions(s, actor)),
              actionKeys(oraclePieceActions(s, actor)),
            );
            const targets = new Set(oraclePaths(s, actor).keys());
            for (const to of SQUARES) {
              const action: Action = freeze({
                type: "move",
                pieceId: actor.id,
                to,
              });
              assert.equal(
                isLegal(s, action),
                targets.has(to),
                `destination ${to}`,
              );
              if (targets.has(to)) verifyTransition(s, action);
              else verifyRejected(s, action);
            }
            const enemyTurn = freeze({ ...s, turn: other(side) });
            assert.deepEqual(pieceActions(enemyTurn, actor), []);
            for (const to of targets)
              verifyRejected(enemyTurn, {
                type: "move",
                pieceId: actor.id,
                to,
              });
          },
        );
      }

// Every board square, each owner and each price/role. Core and enemy/dead zones
// are tested as destinations rather than assumed excluded by a helper.
for (const side of SIDES)
  for (const kind of KINDS)
    for (const to of SQUARES) {
      // The exact-price duration-three case at this square is already registered
      // by the affordability matrix. Do not count the same scenario twice.
      if (to === (side === "white" ? 9 : 39)) continue;
      const duration = 3,
        cost = PRICE[kind] * duration;
      const s = freeze(
        fixture([], { turn: side, grain: { white: cost, black: cost } }),
      );
      const action: Action = freeze({ type: "summon", kind, duration, to });
      const expected =
        to !== 3 && to !== 45 && (side === "white" ? to < 21 : to >= 28);
      registerCase(
        {
          id: `rules.summon-board.${side}.${kind}.${to}`,
          category: "summon-board-boundaries",
          inputs: { state: s, action },
          assertions: [
            "All and only unoccupied own-half three-rank destinations are legal; the central rank is excluded",
            "Exact purchase cost, newborn protection, next-turn income, preview and immutability agree",
          ],
        },
        () => {
          assert.equal(isLegal(s, action), expected);
          assert.equal(
            legalActions(s).some((a) => actionKey(a) === actionKey(action)),
            expected,
          );
          if (expected) verifyTransition(s, action);
          else verifyRejected(s, action);
        },
      );
    }
for (const side of SIDES)
  for (const kind of KINDS)
    for (let duration = 1; duration <= 5; duration++)
      for (const delta of [-1, 0, 1]) {
        const budget = PRICE[kind] * duration + delta;
        const s = freeze(
          fixture([], { turn: side, grain: { white: budget, black: budget } }),
        );
        const action: Action = freeze({
          type: "summon",
          kind,
          duration,
          to: side === "white" ? 9 : 39,
        });
        registerCase(
          {
            id: `rules.affordability.${side}.${kind}.d${duration}.delta${delta}`,
            category: "price-duration-budget-thresholds",
            inputs: { state: s, action, expectedCost: PRICE[kind] * duration },
            assertions: [
              "Original four prices remain fixed",
              "One grain below exact cost rejects; exact and plus-one budgets buy without hidden fees",
              "All five durations retain newborn lifetime",
            ],
          },
          () => {
            assert.deepEqual(PRICES, PRICE);
            assert.equal(isLegal(s, action), delta >= 0);
            assert.equal(
              legalActions(s).some((a) => actionKey(a) === actionKey(action)),
              delta >= 0,
            );
            if (delta >= 0) verifyTransition(s, action);
            else verifyRejected(s, action);
          },
        );
      }
for (const side of SIDES)
  for (const kind of KINDS)
    for (let duration = 1; duration <= 5; duration++)
      for (const occupant of SIDES) {
        const to = side === "white" ? 9 : 39;
        const s = freeze(
          fixture([piece("occupant", "bastion", to, occupant)], { turn: side }),
        );
        const action: Action = freeze({ type: "summon", kind, duration, to });
        registerCase(
          {
            id: `rules.summon-occupied.${side}.${kind}.d${duration}.${occupant}`,
            category: "summon-occupancy",
            inputs: { state: s, action },
            assertions: [
              "Neither friendly nor enemy occupancy can be overwritten or purchased as a capture",
              "Rejection spends nothing, ages nothing, emits no preview and returns original state",
            ],
          },
          () => verifyRejected(s, action),
        );
      }

// Links: 47 origins × 2 owners × three surrounding affiliation topologies.
for (const side of SIDES)
  for (const origin of PIECE_SQUARES)
    for (const pattern of ["allied", "enemy", "mixed"] as const) {
      const actor = piece("link", "link", origin, side, 2);
      const neighbors = PIECE_SQUARES.filter(
        (q) => q !== origin && chebyshev(q, origin) === 1,
      ).map((q, i) =>
        piece(
          `neighbor-${q}`,
          KINDS[i % 4],
          q,
          pattern === "allied"
            ? side
            : pattern === "enemy"
              ? other(side)
              : i % 2
                ? side
                : other(side),
          1 + (i % 5),
        ),
      );
      const s = freeze(
        fixture([actor, ...neighbors], { turn: side, consecutivePasses: 5 }),
      );
      registerCase(
        {
          id: `rules.link.${side}.${origin}.${pattern}`,
          category: "link-adjacency-and-exchange",
          inputs: { state: s, actor: actor.id },
          assertions: [
            "Only orthogonally adjacent allies can exchange; diagonals, enemies, core IDs and self are rejected",
            "Both identities change squares and age normally without extension, cost or capture",
            "An exchange cancels a prior five-pass streak and does not mutate source",
          ],
        },
        () => {
          const expected = oraclePieceActions(s, actor);
          assert.deepEqual(
            actionKeys(pieceActions(s, actor)),
            actionKeys(expected),
          );
          assert.equal(movePaths(s, actor).size, 0);
          const keys = new Set(actionKeys(expected));
          for (const allyId of [
            actor.id,
            "core-white",
            "core-black",
            "missing",
            ...neighbors.map((p) => p.id),
          ]) {
            const action: Action = freeze({
              type: "swap",
              pieceId: actor.id,
              allyId,
            });
            if (keys.has(actionKey(action))) verifyTransition(s, action);
            else verifyRejected(s, action);
          }
          for (const to of SQUARES)
            assert.equal(
              isLegal(s, { type: "move", pieceId: actor.id, to }),
              false,
            );
        },
      );
    }

for (const side of SIDES)
  for (const attacker of ["carver", "leaper"] as const)
    for (const victimKind of KINDS)
      for (let victimLife = 1; victimLife <= 5; victimLife++)
        for (const attackerLife of [1, 5]) {
          const pieces = [
            piece(
              "attacker",
              attacker,
              attacker === "carver" ? 16 : 23,
              side,
              attackerLife,
            ),
            piece("victim", victimKind, 25, other(side), victimLife),
            piece("idle-expiry", "bastion", 0, side, 1),
          ];
          if (attacker === "leaper")
            pieces.push(piece("pad", "bastion", 24, other(side), 3));
          const s = freeze(
            fixture(pieces, { turn: side, grain: { white: 101, black: 203 } }),
          );
          const action: Action = freeze({
            type: "move",
            pieceId: "attacker",
            to: 25,
          });
          registerCase(
            {
              id: `rules.capture.${side}.${attacker}.${victimKind}.v${victimLife}.a${attackerLife}`,
              category: "capture-price-times-remaining",
              inputs: {
                state: s,
                action,
                expectedReward: PRICE[victimKind] * victimLife,
              },
              assertions: [
                "Reward is victim price times pre-capture lifetime, independent of attacker role and lifetime",
                "Capture occurs before attacker/idle expiry and is never capped",
                "Leaper pad survives unchanged and only destination victim disappears",
                "Preview, event reward and resource balance agree without source mutation",
              ],
            },
            () => {
              const result = verifyTransition(s, action);
              assert.equal(
                result.state.pieces.some((p) => p.id === "attacker"),
                attackerLife > 1,
              );
              if (attacker === "leaper")
                assert.equal(
                  result.state.pieces.find((p) => p.id === "pad")?.remaining,
                  3,
                );
            },
          );
        }

for (const side of SIDES)
  for (const kind of KINDS)
    for (let duration = 1; duration <= 5; duration++) {
      const peers = SIDES.flatMap((owner) =>
        Array.from({ length: 5 }, (_, index) =>
          piece(
            `${owner}-old-${index + 1}`,
            KINDS[index % 4],
            (owner === "white" ? 14 : 28) + index,
            owner,
            index + 1,
          ),
        ),
      );
      const s = freeze(fixture(peers, { turn: side }));
      const action: Action = freeze({
        type: "summon",
        kind,
        duration,
        to: side === "white" ? 0 : 48,
      });
      registerCase(
        {
          id: `rules.lifecycle.${side}.${kind}.d${duration}`,
          category: "newborn-and-complete-lifetime",
          inputs: { state: s, action, ownerTurnsUntilExpiry: duration },
          assertions: [
            "Every pre-existing own lifetime ages on summon while enemy lifetimes stay unchanged",
            "Newborn keeps its full purchased duration during its birth turn and opponent turns",
            "Exactly duration later owner turns retire the untouched newborn with no natural-expiry reward",
            "Other actions reset pass streak so all five-turn lifetimes are genuinely exercised",
          ],
        },
        () => {
          let current = verifyTransition(s, action).state;
          const id = `${side}-${s.ply}-${action.type === "summon" ? action.to : -1}`;
          assert.equal(
            current.pieces.find((p) => p.id === id)?.remaining,
            duration,
          );
          for (let ownerTurn = 1; ownerTurn <= duration; ownerTurn++) {
            current = verifyTransition(
              freeze(current),
              freeze({ type: "pass" }),
            ).state;
            assert.equal(
              current.pieces.find((p) => p.id === id)?.remaining,
              duration - ownerTurn + 1,
            );
            const to =
              side === "white" ? 1 + (ownerTurn % 2) : 46 + (ownerTurn % 2);
            current = verifyTransition(
              freeze(current),
              freeze({ type: "summon", kind: "bastion", duration: 1, to }),
            ).state;
            assert.equal(
              current.pieces.find((p) => p.id === id)?.remaining,
              ownerTurn === duration ? undefined : duration - ownerTurn,
            );
          }
          assert.equal(current.outcome, null);
        },
      );
    }

for (const side of SIDES)
  for (const kind of ["carver", "leaper"] as const)
    for (let remaining = 1; remaining <= 5; remaining++)
      for (const ply of [0, 198, 199])
        for (const passes of [0, 5]) {
          const origin =
            side === "white"
              ? kind === "carver"
                ? 36
                : 31
              : kind === "carver"
                ? 12
                : 17;
          const pieces = [
            piece("winner", kind, origin, side, remaining),
            piece(
              "own-last-life",
              "bastion",
              side === "white" ? 0 : 48,
              side,
              1,
            ),
            piece(
              "enemy-last-life",
              "bastion",
              side === "white" ? 46 : 2,
              other(side),
              1,
            ),
          ];
          if (kind === "leaper")
            pieces.push(
              piece("pad", "bastion", side === "white" ? 38 : 10, side, 1),
            );
          const s = freeze(
            fixture(pieces, { turn: side, ply, consecutivePasses: passes }),
          );
          const action: Action = freeze({
            type: "move",
            pieceId: "winner",
            to: side === "white" ? 45 : 3,
          });
          registerCase(
            {
              id: `rules.core-win.${side}.${kind}.life${remaining}.ply${ply}.passes${passes}`,
              category: "core-win-terminal-precedence",
              inputs: { state: s, action },
              assertions: [
                "Core capture wins before any expiry and before the 200-ply draw",
                "Winning last-life attacker and unrelated last-life allies remain intact",
                "No next-turn income is awarded; finished states reject every further action",
              ],
            },
            () => {
              const next = verifyTransition(s, action).state;
              assert.equal(
                next.pieces.find((p) => p.id === "winner")?.remaining,
                remaining,
              );
              assert.equal(
                next.pieces.find((p) => p.id === "own-last-life")?.remaining,
                1,
              );
              assert.deepEqual(legalActions(next), []);
              verifyRejected(freeze(next), { type: "pass" });
              verifyRejected(next, {
                type: "summon",
                kind: "bastion",
                duration: 1,
                to: side === "white" ? 1 : 47,
              });
            },
          );
        }
for (const side of SIDES)
  for (const ply of [0, 198, 199])
    for (const passes of [0, 4, 5]) {
      const s = freeze(
        fixture([piece("last-life", "bastion", 24, side, 1)], {
          turn: side,
          ply,
          consecutivePasses: passes,
        }),
      );
      registerCase(
        {
          id: `rules.draw.${side}.ply${ply}.passes${passes}`,
          category: "draw-thresholds-and-final-income",
          inputs: { state: s, action: { type: "pass" } },
          assertions: [
            "The sixth consecutive pass or completed 200th ply ends the game, never the fifth or 199th",
            "Expiry still happens on draw; next-turn income does not",
            "Terminal state rejects continuation while nonterminal state remains playable",
          ],
        },
        () => {
          const next = verifyTransition(s, freeze({ type: "pass" })).state;
          assert.equal(next.pieces.length, 0);
          if (passes === 5 || ply === 199) {
            assert.equal(next.outcome?.kind, "draw");
            if (passes === 5 && ply !== 199)
              assert.deepEqual(next.outcome, {
                kind: "draw",
                reason: "passes",
              });
            if (passes !== 5 && ply === 199)
              assert.deepEqual(next.outcome, { kind: "draw", reason: "limit" });
            verifyRejected(freeze(next), { type: "pass" });
          } else assert.equal(legalActions(next).length > 0, true);
        },
      );
    }
for (const side of SIDES)
  for (const grain of [24, 100, 1000000])
    for (const actionType of ["income", "capture"] as const) {
      const s = freeze(
        fixture(
          actionType === "capture"
            ? [
                piece("attacker", "carver", 16, side),
                piece("victim", "carver", 25, other(side), 5),
              ]
            : [],
          { turn: side, grain: { white: grain, black: grain } },
        ),
      );
      const action: Action = freeze(
        actionType === "capture"
          ? { type: "move", pieceId: "attacker", to: 25 }
          : { type: "pass" },
      );
      registerCase(
        {
          id: `rules.uncapped.${side}.${grain}.${actionType}`,
          category: "uncapped-grain-accounting",
          inputs: { state: s, action },
          assertions: [
            "Income and capture rewards remain additive above small UI-sized balances and at one million grain",
            "No balance cap or hidden resource loss; original action is immutable",
          ],
        },
        () => {
          verifyTransition(s, action);
        },
      );
    }

// A sequence is ONE scenario, not one case per ply. The generator chooses only
// from the independent oracle and checks production enumeration before acting.
function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const sequenceSeeds = [1, 7, 19, 43, 71, 101, 173, 257];
for (const seed of sequenceSeeds)
  for (const style of [
    "balanced",
    "capture-priority",
    "short-contracts",
  ] as const) {
    registerCase(
      {
        id: `rules.sequence.${style}.seed${seed}`,
        category: "fresh-seeded-legal-sequences",
        inputs: {
          seed,
          style,
          initial: "createGame",
          maxPlies: 80,
          generator:
            "LCG 1664525/1013904223; destination-first independent legality",
        },
        assertions: [
          "Fresh deterministic games choose legal actions from an independent full-action oracle",
          "At every ply the complete production action set equals the independent action set without duplicates",
          "Every transition preserves resource accounting, lifetime, identity, preview, turn and input invariants",
          "Each game actually exercises multiple action kinds and records no artificial per-ply case count",
        ],
      },
      () => {
        let current = createGame();
        assert.deepEqual(current.grain, { white: 16, black: 12 });
        assert.equal(current.turn, "white");
        assert.deepEqual(current.pieces, []);
        assert.deepEqual(current.cores, { white: 3, black: 45 });
        const random = randomGenerator(seed),
          seen = new Set<string>();
        for (let step = 0; step < 80 && !current.outcome; step++) {
          const expected = oracleActions(current),
            actual = legalActions(current);
          assert.deepEqual(
            actionKeys(actual),
            actionKeys(expected),
            `complete action set at ply ${step}`,
          );
          assert.equal(
            new Set(actionKeys(actual)).size,
            actual.length,
            "no duplicate action from alternate Carver routes",
          );
          const summon = expected.filter(
            (a) =>
              a.type === "summon" &&
              (style !== "short-contracts" || a.duration <= 2),
          );
          const tactics = expected.filter(
            (a) => a.type === "move" || a.type === "swap",
          );
          const captures = tactics.filter(
            (a) =>
              a.type === "move" &&
              (current.pieces.some((p) => p.square === a.to) ||
                a.to === current.cores[other(current.turn)]),
          );
          const roll = random();
          let pool =
            style === "capture-priority" && captures.length
              ? captures
              : tactics.length && roll < 0.65
                ? tactics
                : summon.length && roll < 0.96
                  ? summon
                  : expected.filter((a) => a.type === "pass");
          if (!pool.length) pool = expected;
          const action = pool[Math.floor(random() * pool.length)];
          seen.add(action.type);
          current = verifyTransition(freeze(current), freeze(action)).state;
        }
        assert.ok(seen.has("summon"));
        assert.ok(
          seen.size >= 2,
          "sequence must do more than repeat purchases",
        );
        assert.ok(current.ply >= 10 || current.outcome?.kind === "win");
        if (current.outcome) assert.deepEqual(legalActions(current), []);
      },
    );
  }
