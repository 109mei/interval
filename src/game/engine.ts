import type {
  GameState,
  Action,
  Transition,
  Preview,
  GameEvent,
  Piece,
} from "./types";
import { isLegal, PRICES, opposite, movePaths } from "./rules";
export function createGame(): GameState {
  return {
    pieces: [],
    cores: { white: 3, black: 45 },
    grain: { white: 16, black: 12 },
    turn: "white",
    ply: 0,
    consecutivePasses: 0,
    outcome: null,
  };
}
export function applyAction(s: GameState, a: Action): Transition {
  if (!isLegal(s, a))
    return {
      ok: false,
      state: s,
      error: "この操作はできません。選び直してください。",
    };
  const side = s.turn,
    enemy = opposite(side);
  let pieces: Piece[] = s.pieces.map((p) => ({ ...p }));
  const grain = { ...s.grain },
    events: GameEvent[] = [];
  const event = (
    type: GameEvent["type"],
    ids: string[] = [],
    squares: number[] = [],
    amount = 0,
    owner = side,
  ) => events.push({ type, side: owner, pieceIds: ids, squares, amount });
  let newborn: string | null = null,
    win = false;
  if (a.type === "summon") {
    const cost = PRICES[a.kind] * a.duration;
    newborn = `${side}-${s.ply}-${a.to}`;
    grain[side] -= cost;
    pieces.push({
      id: newborn,
      side,
      kind: a.kind,
      square: a.to,
      remaining: a.duration,
      summonedPly: s.ply,
    });
    event("summon", [newborn], [a.to], cost);
  }
  if (a.type === "move") {
    const mover = pieces.find((p) => p.id === a.pieceId)!;
    const victim = pieces.find((p) => p.square === a.to);
    if (victim) {
      const reward = PRICES[victim.kind] * victim.remaining;
      grain[side] += reward;
      event("capture", [victim.id], [victim.square], reward);
      pieces = pieces.filter((p) => p.id !== victim.id);
    }
    event("move", [mover.id], [mover.square, a.to]);
    mover.square = a.to;
    win = a.to === s.cores[enemy];
  }
  if (a.type === "swap") {
    const p = pieces.find((p) => p.id === a.pieceId)!,
      q = pieces.find((p) => p.id === a.allyId)!;
    event("swap", [p.id, q.id], [p.square, q.square]);
    [p.square, q.square] = [q.square, p.square];
  }
  if (win) {
    event("finish");
    return {
      ok: true,
      state: {
        ...s,
        pieces,
        grain,
        ply: s.ply + 1,
        outcome: { kind: "win", winner: side },
      },
      events,
    };
  }
  pieces.forEach((p) => {
    if (p.side === side && p.id !== newborn) p.remaining--;
  });
  const expired = pieces.filter((p) => p.remaining === 0);
  if (expired.length)
    event(
      "expire",
      expired.map((p) => p.id),
      expired.map((p) => p.square),
    );
  pieces = pieces.filter((p) => p.remaining > 0);
  const ply = s.ply + 1,
    consecutivePasses = a.type === "pass" ? s.consecutivePasses + 1 : 0;
  const outcome =
    consecutivePasses >= 6
      ? { kind: "draw" as const, reason: "passes" as const }
      : ply >= 200
        ? { kind: "draw" as const, reason: "limit" as const }
        : null;
  if (outcome) event("finish");
  else {
    grain[enemy] += 4;
    event("income", [], [], 4, enemy);
  }
  return {
    ok: true,
    state: {
      ...s,
      pieces,
      grain,
      turn: enemy,
      ply,
      consecutivePasses,
      outcome,
    },
    events,
  };
}
export function previewAction(s: GameState, a: Action): Preview | null {
  return analyzeAction(s, a)?.preview ?? null;
}
/** Share the fully validated simulation between preview and tactical feedback. */
export function analyzeAction(s: GameState, a: Action) {
  const r = applyAction(s, a);
  if (!r.ok) return null;
  const mover =
    "pieceId" in a ? s.pieces.find((p) => p.id === a.pieceId) : null;
  const cost = a.type === "summon" ? PRICES[a.kind] * a.duration : 0;
  const reward = r.events
    .filter((e) => e.type === "capture")
    .reduce((n, e) => n + e.amount, 0);
  const paths =
    a.type === "move" && mover ? (movePaths(s, mover).get(a.to) ?? []) : [];
  const preview: Preview = {
    cost,
    reward,
    grainAfter: s.grain[s.turn] - cost + reward,
    expires: r.events
      .filter((e) => e.type === "expire")
      .flatMap((e) => e.pieceIds),
    targets:
      a.type === "move" || a.type === "summon"
        ? [a.to]
        : a.type === "swap"
          ? [s.pieces.find((p) => p.id === a.allyId)!.square]
          : [],
    paths,
  };
  return { preview, transition: r };
}
