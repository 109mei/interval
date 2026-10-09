import type { GameState, Selection } from "../game/types";
import {
  legalActions,
  pieceActions,
  opposite,
  validState,
} from "../game/rules";
export type TargetKind = "move" | "capture" | "swap" | "summon";
export const TARGET_NAMES: Record<TargetKind, string> = {
  move: "移動",
  capture: "捕獲",
  swap: "交換",
  summon: "召喚",
};
/** Display metadata comes from authoritative actions, never new move geometry. */
export function boardTargets(s: GameState, selection: Selection) {
  const selected = s.pieces.find((p) => p.id === selection.pieceId);
  const inspectOnly =
    !!selected && (selection.inspectOnly || selected.side !== s.turn);
  const actions = inspectOnly
    ? pieceActions({ ...s, turn: selected.side }, selected)
    : selection.summon
      ? legalActions(s)
      : selected && !s.outcome && validState(s)
        ? pieceActions(s, selected)
        : [];
  const kinds = new Map<number, TargetKind>();
  for (const a of actions) {
    if (
      a.type === "summon" &&
      selection.summon?.kind === a.kind &&
      selection.summon.duration === a.duration
    )
      kinds.set(a.to, "summon");
    else if (a.type === "move" && a.pieceId === selection.pieceId) {
      const enemy = opposite(selected!.side);
      kinds.set(
        a.to,
        a.to === s.cores[enemy] ||
          s.pieces.some((p) => p.square === a.to && p.side === enemy)
          ? "capture"
          : "move",
      );
    } else if (a.type === "swap" && a.pieceId === selection.pieceId)
      kinds.set(s.pieces.find((p) => p.id === a.allyId)!.square, "swap");
  }
  return { targets: new Set(kinds.keys()), kinds, inspectOnly };
}
export function targetDescription(
  kind: TargetKind | undefined,
  inspectOnly: boolean,
) {
  if (!kind) return "";
  if (inspectOnly) return ` · ${TARGET_NAMES[kind]}先の参考（操作できません）`;
  return ` · ${kind === "capture" ? "捕獲できます" : kind === "swap" ? "味方と交換できます" : kind === "summon" ? "召喚できます" : "移動先に選べます"}`;
}
/** Shared SVG silhouettes stay the same in projected 3D and the 2D fallback. */
export function targetMarker(
  kind: TargetKind | undefined,
  inspectOnly = false,
) {
  if (!kind || inspectOnly) return "";
  const shape =
    kind === "move"
      ? '<circle cx="12" cy="12" r="7"/>'
      : kind === "capture"
        ? '<path d="M8 3H3V8 M16 3H21V8 M3 16V21H8 M21 16V21H16"/>'
        : kind === "swap"
          ? '<path d="M4 8H20L16 4 M20 16H4L8 20"/>'
          : '<path d="M12 5V19 M5 12H19"/>';
  return `<span class="destination-marker marker-${kind}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"${kind === "swap" ? ' preserveAspectRatio="none"' : ""}>${shape}</svg></span>`;
}
export function targetState(
  button: HTMLButtonElement,
  kind: TargetKind | undefined,
  inspectOnly: boolean,
  selected: boolean,
  candidate: boolean,
) {
  if (kind) button.dataset.targetKind = kind;
  else delete button.dataset.targetKind;
  button.dataset.available = String(!!kind && !inspectOnly);
  button.classList.toggle("target", !!kind && !inspectOnly);
  button.classList.toggle("inspect-target", !!kind && inspectOnly);
  button.classList.toggle("selected", selected);
  button.classList.toggle("candidate", candidate);
  button.setAttribute("aria-pressed", String(selected));
}
