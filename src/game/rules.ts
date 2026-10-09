import type { GameState, Action, Kind, Piece, Square } from "./types";
export const PRICES: Record<Kind, number> = {
  bastion: 1,
  carver: 3,
  leaper: 2,
  link: 1,
};
export const KINDS = Object.keys(PRICES) as Kind[];
export const ORTH = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
export const opposite = (s: "white" | "black") =>
  s === "white" ? "black" : "white";
export const validSquare = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 49;
export function offset(s: Square, dx: number, dy: number): Square | null {
  const x = (s % 7) + dx,
    y = Math.floor(s / 7) + dy;
  return x >= 0 && x < 7 && y >= 0 && y < 7 ? x + 7 * y : null;
}
export function occupied(s: GameState, q: Square) {
  return (
    s.pieces.some((p) => p.square === q) || Object.values(s.cores).includes(q)
  );
}
export function validState(s: GameState): boolean {
  return (
    ["white", "black"].includes(s.turn) &&
    Number.isInteger(s.ply) &&
    s.ply >= 0 &&
    s.ply <= 200 &&
    Number.isInteger(s.consecutivePasses) &&
    s.consecutivePasses >= 0 &&
    Object.values(s.grain).every((v) => Number.isSafeInteger(v) && v >= 0) &&
    s.cores.white === 3 &&
    s.cores.black === 45 &&
    new Set(s.pieces.map((p) => p.id)).size === s.pieces.length &&
    new Set(s.pieces.map((p) => p.square)).size === s.pieces.length &&
    s.pieces.every(
      (p) =>
        p.id.length > 0 &&
        ["white", "black"].includes(p.side) &&
        KINDS.includes(p.kind) &&
        validSquare(p.square) &&
        !Object.values(s.cores).includes(p.square) &&
        Number.isInteger(p.remaining) &&
        p.remaining > 0 &&
        p.remaining <= 5,
    )
  );
}
export function movePaths(s: GameState, p: Piece): Map<Square, Square[][]> {
  const out = new Map<Square, Square[][]>();
  const add = (path: Square[]) => {
    const to = path[path.length - 1];
    if (
      to === s.cores[p.side] ||
      s.pieces.some((q) => q.square === to && q.side === p.side)
    )
      return;
    out.set(to, [...(out.get(to) ?? []), path]);
  };
  if (p.kind === "carver")
    for (const [dx, dy] of ORTH) {
      const first = offset(p.square, dx, dy);
      if (first === null || occupied(s, first)) continue;
      for (const sign of [-1, 1]) {
        const tx = dy * sign,
          ty = dx * sign;
        for (const len of [1, 2]) {
          const path = [first];
          let good = true;
          for (let i = 1; i <= len; i++) {
            const q = offset(first, tx * i, ty * i);
            if (q === null || (i < len && occupied(s, q))) {
              good = false;
              break;
            }
            path.push(q);
          }
          if (good) add(path);
        }
      }
    }
  if (p.kind === "leaper")
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const mid = offset(p.square, dx, dy),
          to = offset(p.square, 2 * dx, 2 * dy);
        if (mid !== null && to !== null && occupied(s, mid)) add([mid, to]);
      }
  return out;
}
export function pieceActions(s: GameState, p: Piece): Action[] {
  if (p.side !== s.turn) return [];
  if (p.kind === "link")
    return ORTH.flatMap(([dx, dy]) => {
      const q = offset(p.square, dx, dy),
        ally = s.pieces.find((a) => a.square === q && a.side === p.side);
      return ally
        ? [{ type: "swap" as const, pieceId: p.id, allyId: ally.id }]
        : [];
    });
  return [...movePaths(s, p).keys()]
    .sort((a, b) => a - b)
    .map((to) => ({ type: "move", pieceId: p.id, to }));
}
export function isLegal(s: GameState, a: Action): boolean {
  if (s.outcome || !validState(s) || !a) return false;
  if (a.type === "pass") return true;
  if (a.type === "summon")
    return (
      KINDS.includes(a.kind) &&
      Number.isInteger(a.duration) &&
      a.duration >= 1 &&
      a.duration <= 5 &&
      validSquare(a.to) &&
      !occupied(s, a.to) &&
      (s.turn === "white" ? a.to < 21 : a.to >= 28) &&
      s.grain[s.turn] >= PRICES[a.kind] * a.duration
    );
  if (a.type !== "move" && a.type !== "swap") return false;
  const p = s.pieces.find((p) => p.id === a.pieceId && p.side === s.turn);
  if (!p) return false;
  return pieceActions(s, p).some((x) =>
    a.type === "move"
      ? x.type === "move" && x.to === a.to
      : x.type === "swap" && x.allyId === a.allyId,
  );
}
export function legalActions(s: GameState): readonly Action[] {
  if (s.outcome || !validState(s)) return [];
  const out: Action[] = s.pieces.flatMap((p) => pieceActions(s, p));
  for (const kind of KINDS)
    for (let duration = 1; duration <= 5; duration++) {
      if (PRICES[kind] * duration > s.grain[s.turn]) continue;
      for (
        let to = s.turn === "white" ? 0 : 28;
        to < (s.turn === "white" ? 21 : 49);
        to++
      )
        if (!occupied(s, to)) out.push({ type: "summon", kind, duration, to });
    }
  out.push({ type: "pass" });
  return out;
}
