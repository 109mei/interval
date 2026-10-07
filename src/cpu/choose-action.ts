import type { GameState, Action, Side } from "../game/types";
import { legalActions, movePaths, opposite, PRICES } from "../game/rules";
import { applyAction } from "../game/engine";
const distance = (a: number, b: number) =>
  Math.abs((a % 7) - (b % 7)) + Math.abs(Math.floor(a / 7) - Math.floor(b / 7));
function threat(s: GameState, side: Side) {
  return s.pieces.some(
    (p) => p.side === side && movePaths(s, p).has(s.cores[opposite(side)]),
  );
}
function strength(s: GameState, side: Side) {
  let value = s.grain[side] * 0.06;
  const goal = s.cores[opposite(side)];
  for (const p of s.pieces.filter((p) => p.side === side)) {
    const progress = 10 - distance(p.square, goal);
    if (p.kind === "carver" || p.kind === "leaper")
      value +=
        PRICES[p.kind] * 1.2 +
        p.remaining * 0.4 +
        progress * 0.8 +
        movePaths(s, p).size * 0.1;
    else
      value +=
        0.35 * p.remaining +
        (p.kind === "bastion" && distance(p.square, s.cores[side]) === 1
          ? 1
          : 0);
  }
  return value;
}
export function chooseCpuAction(s: GameState): Action | null {
  if (s.outcome) return null;
  const actions = legalActions(s);
  let best: Action | null = null,
    bestScore = -Infinity;
  for (const a of actions) {
    const r = applyAction(s, a);
    if (!r.ok) continue;
    const n = r.state;
    if (n.outcome?.kind === "win" && n.outcome.winner === s.turn) return a;
    const danger = !n.outcome && threat(n, opposite(s.turn));
    const score =
      (danger ? -100000 : 0) +
      (n.outcome?.kind === "draw" ? -20 : 0) +
      strength(n, s.turn) -
      strength(n, opposite(s.turn)) +
      (a.type === "move" ? 0.2 : 0) -
      (a.type === "pass" ? 0.3 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}
