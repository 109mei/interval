import type { BoardView } from "./board-view";
import { legalActions } from "../game/rules";
import { INFO, icon, coreIcon, squareName, PIECE_MARK } from "../ui/piece-info";
export function createBoard2D(
  host: HTMLElement,
  onSquare: (q: number) => void,
): BoardView {
  const board = document.createElement("div");
  board.className = "board-grid";
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", "7×7の対戦盤");
  host.append(board);
  const buttons = new Map<number, HTMLButtonElement>();
  for (let row = 6; row >= 0; row--)
    for (let col = 0; col < 7; col++) {
      const q = row * 7 + col,
        b = document.createElement("button");
      b.type = "button";
      b.dataset.square = String(q);
      b.className = `square ${(row + col) % 2 ? "dark" : "light"}`;
      b.tabIndex = q === 0 ? 0 : -1;
      b.onclick = () => onSquare(q);
      b.addEventListener("keydown", (e) => {
        const shift = (
          { ArrowUp: 7, ArrowDown: -7, ArrowLeft: -1, ArrowRight: 1 } as Record<
            string,
            number
          >
        )[e.key];
        if (!shift) return;
        const target = q + shift;
        if (
          target < 0 ||
          target >= 49 ||
          (Math.abs(shift) === 1 && Math.floor(target / 7) !== row)
        )
          return;
        e.preventDefault();
        b.tabIndex = -1;
        const next = buttons.get(target)!;
        next.tabIndex = 0;
        next.focus();
      });
      buttons.set(q, b);
      board.append(b);
    }
  return {
    render(s, selection, preview) {
      const targets = new Set<number>();
      for (const a of legalActions(s)) {
        if (
          a.type === "summon" &&
          selection.summon?.kind === a.kind &&
          selection.summon.duration === a.duration
        )
          targets.add(a.to);
        if (a.type === "move" && a.pieceId === selection.pieceId)
          targets.add(a.to);
        if (a.type === "swap" && a.pieceId === selection.pieceId)
          targets.add(s.pieces.find((p) => p.id === a.allyId)!.square);
      }
      const expires = new Set(preview?.expires ?? []);
      for (const [q, b] of buttons) {
        const p = s.pieces.find((p) => p.square === q),
          core =
            q === s.cores.white
              ? "white"
              : q === s.cores.black
                ? "black"
                : null;
        const label = p
          ? `${p.side === "white" ? "白" : "黒"} ${INFO[p.kind].name} 残り${p.remaining}回`
          : core
            ? `${core === "white" ? "白" : "黒"}のコア`
            : "空き";
        b.setAttribute(
          "aria-label",
          `${squareName(q)} ${label}${targets.has(q) ? (selection.summon ? " · 召喚できます" : " · 行き先に選べます") : ""}`,
        );
        b.setAttribute(
          "aria-pressed",
          String(!!p && p.id === selection.pieceId),
        );
        const ghost =
          selection.candidate?.type === "summon" && selection.candidate.to === q
            ? selection.candidate
            : null;
        b.classList.toggle("selected", !!p && p.id === selection.pieceId);
        b.classList.toggle("target", targets.has(q));
        b.classList.toggle("candidate", !!preview?.targets.includes(q));
        b.classList.toggle(
          "route",
          !!preview?.paths[0]?.slice(0, -1).includes(q),
        );
        b.classList.toggle("expiring", !!p && expires.has(p.id));
        b.innerHTML = `${p ? `<span class="piece ${p.side}">${icon(p.kind)}<span class="piece-mark">${PIECE_MARK[p.kind]}</span><span class="life ${p.remaining === 1 ? "last" : ""}">${p.remaining}</span></span>` : ghost ? `<span class="piece ghost-piece ${s.turn}">${icon(ghost.kind)}<span class="piece-mark">${PIECE_MARK[ghost.kind]}</span><span class="life">${ghost.duration}</span></span>` : core ? `<span class="piece core ${core}">${coreIcon}</span>` : ""}<span class="coord">${squareName(q)}</span>`;
      }
    },
    dispose() {
      host.replaceChildren();
      buttons.clear();
    },
  };
}
