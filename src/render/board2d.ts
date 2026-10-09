import type { BoardView } from "./board-view";
import {
  boardTargets,
  targetDescription,
  targetMarker,
  targetState,
} from "./board-targets";
import { INFO, icon, coreIcon, squareName, PIECE_MARK } from "../ui/piece-info";
import { createMotionPlayer } from "./motion-player";
import { trackPose } from "./motion";
export function createBoard2D(
  host: HTMLElement,
  onSquare: (q: number) => void,
): BoardView {
  let disposed = false;
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
      b.onfocus = () => {
        for (const button of buttons.values()) button.tabIndex = -1;
        b.tabIndex = 0;
      };
      b.onclick = () => onSquare(q);
      b.addEventListener("keydown", (e) => {
        const shift = (
          { ArrowUp: 7, ArrowDown: -7, ArrowLeft: -1, ArrowRight: 1 } as Record<
            string,
            number
          >
        )[e.key];
        if (!shift) return;
        e.preventDefault();
        const target = q + shift;
        if (
          target < 0 ||
          target >= 49 ||
          (Math.abs(shift) === 1 && Math.floor(target / 7) !== row)
        )
          return;
        b.tabIndex = -1;
        const next = buttons.get(target)!;
        next.tabIndex = 0;
        next.focus();
      });
      buttons.set(q, b);
      board.append(b);
    }
  const animated = new Map<string, HTMLElement>();
  const animatedLife = new Map<string, HTMLElement>();
  const pieceElements = new Map<string, HTMLElement>();
  const hiddenPieces = new Set<HTMLElement>();
  function restoreHiddenPieces() {
    hiddenPieces.forEach((el) => el.classList.remove("motion-hidden"));
    hiddenPieces.clear();
  }
  const motion = createMotionPlayer(
    host,
    (x, y) => ({ x: ((x + 0.5) / 7) * 100, y: ((6.5 - y) / 7) * 100 }),
    (plan, elapsed) => {
      if (!plan) {
        restoreHiddenPieces();
        animated.forEach((el) => el.remove());
        animated.clear();
        animatedLife.clear();
        return;
      }
      const win = plan.cues.find((c) => c.kind === "win");
      if (win) {
        let core = animated.get("captured-core");
        if (!core) {
          core = document.createElement("span");
          core.className = `moving-piece piece core ${win.square === 45 ? "black" : "white"}`;
          core.innerHTML = coreIcon;
          motion.layer.append(core);
          animated.set("captured-core", core);
          core.style.left = `${(((win.square % 7) + 0.5) / 7) * 100}%`;
          core.style.top = `${((6.5 - Math.floor(win.square / 7)) / 7) * 100}%`;
          core.style.transform = "translate(-50%, -50%)";
        }
        core.style.visibility = elapsed < win.start ? "visible" : "hidden";
      }
      for (const track of plan.tracks) {
        let el = animated.get(track.piece.id);
        if (!el) {
          el = document.createElement("span");
          el.className = `moving-piece piece ${track.piece.side}`;
          el.dataset.movingPiece = track.piece.id;
          el.innerHTML = `${icon(track.piece.kind)}<span class="piece-mark">${PIECE_MARK[track.piece.kind]}</span><span class="life"></span>`;
          motion.layer.append(el);
          animated.set(track.piece.id, el);
          animatedLife.set(
            track.piece.id,
            el.querySelector<HTMLElement>(".life")!,
          );
        }
        const life = animatedLife.get(track.piece.id)!;
        const remaining =
          track.leave === "capture" ||
          elapsed < (track.leave === "expire" ? track.start : track.arrive)
            ? track.piece.remaining
            : track.remaining;
        life.textContent = String(remaining);
        life.classList.toggle("last", remaining <= 1);
        const pose = trackPose(track, elapsed);
        el.style.left = `${((pose.x + 0.5) / 7) * 100}%`;
        el.style.top = `${((6.5 - pose.y - pose.lift) / 7) * 100}%`;
        el.style.transform = `translate(-50%, -50%) scale(${pose.scale})`;
        el.style.opacity = String(pose.opacity);
        const piece = pieceElements.get(track.piece.id);
        if (piece && !hiddenPieces.has(piece)) {
          piece.classList.add("motion-hidden");
          hiddenPieces.add(piece);
        }
      }
    },
  );
  return {
    cancelMotion: motion.cancel,
    render(s, selection, preview, transition) {
      if (disposed) return;
      // A selection marker can replace a square's HTML during a running move.
      // Refresh cached nodes once per render, keeping frame updates query-free.
      restoreHiddenPieces();
      pieceElements.clear();
      const { kinds, inspectOnly } = boardTargets(s, selection);
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
          ? `${p.side === "white" ? "白" : "黒"} ${INFO[p.kind].name} 残り${p.remaining}ターン`
          : core
            ? `${core === "white" ? "白" : "黒"}のコア`
            : "空き";
        b.setAttribute(
          "aria-label",
          `${squareName(q)} ${label}${targetDescription(kinds.get(q), inspectOnly)}${preview?.targets.includes(q) ? " · 選んだ行き先（確定前）" : ""}`,
        );
        b.setAttribute(
          "aria-pressed",
          String(!!p && p.id === selection.pieceId),
        );
        const ghost =
          selection.candidate?.type === "summon" && selection.candidate.to === q
            ? selection.candidate
            : null;
        targetState(
          b,
          kinds.get(q),
          inspectOnly,
          !!p && p.id === selection.pieceId,
          !!preview?.targets.includes(q),
        );
        b.classList.toggle(
          "route",
          !!preview?.paths[0]?.slice(0, -1).includes(q),
        );
        b.classList.toggle("expiring", !!p && expires.has(p.id));
        const content = `${p ? `<span class="piece ${p.side}" data-piece-id="${p.id}">${icon(p.kind)}<span class="piece-mark">${PIECE_MARK[p.kind]}</span><span class="life ${p.remaining === 1 ? "last" : ""}">${p.remaining}</span></span>` : ghost ? `<span class="piece ghost-piece ${s.turn}">${icon(ghost.kind)}<span class="piece-mark">${PIECE_MARK[ghost.kind]}</span><span class="life">${ghost.duration}</span></span>` : core ? `<span class="piece core ${core}">${coreIcon}</span>` : ""}<span class="coord">${squareName(q)}</span>${targetMarker(kinds.get(q), inspectOnly)}`;
        if (b.dataset.visual !== content) {
          b.innerHTML = content;
          b.dataset.visual = content;
        }
        if (p)
          pieceElements.set(
            p.id,
            b.querySelector<HTMLElement>("[data-piece-id]")!,
          );
      }
      motion.update(s, transition);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      motion.dispose();
      host.replaceChildren();
      buttons.clear();
      pieceElements.clear();
    },
  };
}
