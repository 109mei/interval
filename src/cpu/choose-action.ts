import type { GameState, Action, Side, Kind } from "../game/types";
import {
  legalActions,
  movePaths,
  opposite,
  PRICES,
  offset,
} from "../game/rules";
import { applyAction } from "../game/engine";
const WIN = 100000;
const distance = (a: number, b: number) =>
  Math.abs((a % 7) - (b % 7)) + Math.abs(Math.floor(a / 7) - Math.floor(b / 7));
function winsNext(s: GameState, side: Side) {
  return s.pieces.some(
    (p) => p.side === side && movePaths(s, p).has(s.cores[opposite(side)]),
  );
}
// Empty-board distances estimate whether a contract has enough future actions to reach the core.
// They guide ordering only; actual paths and every opponent reply are checked below.
const hops = new Map<string, number[]>();
function coreDistance(kind: Kind, side: Side, square: number) {
  const key = kind + side;
  if (!hops.has(key)) {
    const d = Array<number>(49).fill(9),
      goal = side === "white" ? 45 : 3,
      queue = [goal];
    d[goal] = 0;
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      const steps =
        kind === "carver"
          ? [
              [1, 1],
              [1, -1],
              [-1, 1],
              [-1, -1],
              [1, 2],
              [1, -2],
              [-1, 2],
              [-1, -2],
              [2, 1],
              [2, -1],
              [-2, 1],
              [-2, -1],
            ]
          : [
              [2, 0],
              [-2, 0],
              [0, 2],
              [0, -2],
              [2, 2],
              [2, -2],
              [-2, 2],
              [-2, -2],
            ];
      for (const [dx, dy] of steps) {
        const n = offset(q, dx, dy);
        if (n !== null && d[n] > d[q] + 1) {
          d[n] = d[q] + 1;
          queue.push(n);
        }
      }
    }
    hops.set(key, d);
  }
  return hops.get(key)![square];
}
function strength(s: GameState, side: Side) {
  let value = s.grain[side] * 0.52;
  const attackers = s.pieces.filter(
    (p) => p.side === side && (p.kind === "carver" || p.kind === "leaper"),
  );
  for (const p of s.pieces.filter((p) => p.side === side)) {
    const paths = movePaths(s, p);
    if (p.kind === "carver" || p.kind === "leaper") {
      const moves = coreDistance(p.kind, side, p.square);
      const useful = Math.min(p.remaining, moves + 1);
      // Unusable excess life and an army too large to move before expiry are not new value.
      value += PRICES[p.kind] * useful * 0.45;
      value +=
        (5 - Math.min(5, moves)) *
        2.8 *
        Math.min(1, p.remaining / Math.max(1, moves));
      value += Math.min(paths.size, 8) * 0.15;
      if (p.remaining < moves) value -= 3.2 * (moves - p.remaining);
      if (paths.has(s.cores[opposite(side)])) value += 18;
      if (p.kind === "leaper" && paths.size === 0) value -= 3;
    } else {
      value += p.remaining * 0.18;
      if (p.kind === "bastion" && distance(p.square, s.cores[side]) <= 2)
        value += 0.7;
      if (
        p.kind === "link" &&
        !s.pieces.some(
          (q) =>
            q.side === side &&
            q.id !== p.id &&
            distance(q.square, p.square) === 1,
        )
      )
        value -= 1.5;
    }
  }
  value -= Math.max(0, attackers.length - 2) * 3;
  return value;
}
function evaluate(s: GameState, side: Side) {
  if (s.outcome)
    return s.outcome.kind === "draw"
      ? 0
      : s.outcome.winner === side
        ? WIN
        : -WIN;
  return strength(s, side) - strength(s, opposite(side));
}
export function chooseCpuAction(s: GameState): Action | null {
  if (s.outcome) return null;
  const side = s.turn,
    enemy = opposite(side);
  const candidates = legalActions(s).flatMap((action) => {
    const r = applyAction(s, action);
    if (!r.ok) return [];
    return [
      {
        action,
        state: r.state,
        score:
          evaluate(r.state, side) -
          (!r.state.outcome && winsNext(r.state, enemy) ? WIN : 0),
      },
    ];
  });
  const immediate = candidates.find(
    (c) => c.state.outcome?.kind === "win" && c.state.outcome.winner === side,
  );
  if (immediate) return immediate.action;
  candidates.sort((a, b) => b.score - a.score);
  // A bounded root beam keeps mobile input responsive. Threats bypass the beam so forced wins are preserved.
  const considered = candidates.filter(
    (c, i) =>
      i < 10 ||
      !!c.state.outcome ||
      ((c.action.type === "move" || c.action.type === "swap") &&
        winsNext(c.state, side)),
  );
  let best: Action | null = null,
    bestScore = -Infinity;
  for (const candidate of considered) {
    let worst = candidate.state.outcome
      ? evaluate(candidate.state, side)
      : Infinity;
    for (const reply of legalActions(candidate.state)) {
      const r = applyAction(candidate.state, reply);
      if (!r.ok) continue;
      const score = r.state.outcome
        ? evaluate(r.state, side)
        : winsNext(r.state, side)
          ? WIN - 2
          : evaluate(r.state, side);
      worst = Math.min(worst, score);
      // Remaining replies cannot improve a minimax lower score; ties preserve deterministic ordering.
      if (worst + candidate.score * 0.015 <= bestScore) break;
    }
    const score = worst + candidate.score * 0.015;
    if (score > bestScore) {
      bestScore = score;
      best = candidate.action;
    }
  }
  return best ?? candidates[0]?.action ?? null;
}
