import { recoverTransition } from "../render/motion";
import type { Action, GameState, Side, Piece, Outcome } from "../game/types";
import { movePaths, opposite, PRICES } from "../game/rules";
import { INFO, squareName } from "./piece-info";
export function coreAttackers(s: GameState, side: Side) {
  return s.pieces.filter(
    (p) => p.side === opposite(side) && movePaths(s, p).has(s.cores[side]),
  );
}
export function actionLabel(s: GameState, a: Action): string {
  if (a.type === "pass") return "パスして手番を終える";
  if (a.type === "summon")
    return `${squareName(a.to)}に${INFO[a.kind].name}を召喚`;
  const p = s.pieces.find((p) => p.id === a.pieceId)!;
  if (a.type === "move")
    return `${INFO[p.kind].name}を${squareName(p.square)} → ${squareName(a.to)}`;
  const ally = s.pieces.find((p) => p.id === a.allyId)!;
  return `${squareName(p.square)}と${squareName(ally.square)}を交換`;
}
export function transitionText(
  previous: GameState,
  next: GameState,
  transition?: ReturnType<typeof recoverTransition>,
): string {
  if (previous.ply === next.ply) return "";
  if (next.ply !== previous.ply + 1)
    return `${next.ply}手目の盤面に更新しました。`;
  const side = previous.turn;
  const added = next.pieces.find(
    (p) => !previous.pieces.some((q) => q.id === p.id),
  );
  const moved = next.pieces.filter((p) =>
    previous.pieces.some((q) => q.id === p.id && q.square !== p.square),
  );
  const lost = previous.pieces.filter(
    (p) => !next.pieces.some((q) => q.id === p.id),
  );
  const capture = lost
    .filter((p) => p.side !== side)
    .reduce((n, p) => n + PRICES[p.kind] * p.remaining, 0);
  const expired = lost.filter((p) => p.side === side).length;
  const recovered =
    transition === undefined ? recoverTransition(previous, next) : transition;
  let label = recovered?.events.some((e) => e.type === "swap")
    ? "位置交換"
    : added
      ? `${squareName(added.square)}に${INFO[added.kind].name}を召喚`
      : moved.length === 2
        ? "位置交換"
        : moved.length
          ? `${squareName(previous.pieces.find((p) => p.id === moved[0].id)!.square)} → ${squareName(moved[0].square)}`
          : next.consecutivePasses > 0
            ? "パス"
            : "行動完了";
  // A last-life mover can disappear at the destination; name its capture even without a survivor.
  if (capture) label += ` · 捕獲 +${capture}糧`;
  if (expired) label += ` · ${expired}体が退場`;
  return `${side === "white" ? "白" : "黒"} · ${label}`;
}

export function expiryExplanation(s: GameState, piece: Piece): string {
  const side = piece.side === "white" ? "白" : "黒";
  return piece.remaining === 1
    ? `${piece.side === s.turn ? "この" : "次の"}${side}の手番末に退場。動かなくても期間は減ります。`
    : `${side}の手番末に、動かなくても残り期間が1減ります。`;
}
export function outcomeNotice(outcome: Outcome): string {
  return !outcome
    ? ""
    : outcome.kind === "win"
      ? "この手で相手のコアを捕獲。勝利です。"
      : outcome.reason === "passes"
        ? "このパスで6回連続となり、引き分けになります。"
        : "この手で200手に達し、引き分けになります。";
}
