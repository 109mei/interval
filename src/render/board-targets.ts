import type { GameState, Selection } from "../game/types";
import { legalActions, pieceActions } from "../game/rules";
/** Reference geometry is display-only; commit legality remains authoritative. */
export function boardTargets(s: GameState, selection: Selection) {
  const selected = s.pieces.find((p) => p.id === selection.pieceId);
  const inspectOnly =
    !!selected && (selection.inspectOnly || selected.side !== s.turn);
  const actions = inspectOnly
    ? pieceActions({ ...s, turn: selected.side }, selected)
    : legalActions(s);
  const targets = new Set(
    actions.flatMap((a) =>
      a.type === "summon" &&
      selection.summon?.kind === a.kind &&
      selection.summon.duration === a.duration
        ? [a.to]
        : a.type === "move" && a.pieceId === selection.pieceId
          ? [a.to]
          : a.type === "swap" && a.pieceId === selection.pieceId
            ? [s.pieces.find((p) => p.id === a.allyId)!.square]
            : [],
    ),
  );
  return { targets, inspectOnly };
}
