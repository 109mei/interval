import type { BoardView } from "./board-view";
import type { GameState, Selection, Preview } from "../game/types";
import { createBoard2D } from "./board2d";
export function createAdaptiveBoard(
  host: HTMLElement,
  click: (q: number) => void,
  factory: (failure: () => void) => BoardView,
  status: (m: string) => void,
): BoardView {
  let view: BoardView | undefined,
    latest: [GameState, Selection, Preview | null] | null = null,
    fallback = false,
    dead = false;
  function fail() {
    if (dead || fallback) return;
    fallback = true;
    const focused = document.activeElement as HTMLElement | null;
    const focusedSquare = host.contains(focused)
      ? focused?.dataset.square
      : undefined;
    const tabSquare =
      host.querySelector<HTMLElement>('[tabindex="0"]')?.dataset.square;
    view?.dispose();
    host.replaceChildren();
    view = createBoard2D(host, click);
    status("2D表示 · 立体表示を利用できないため切り替えました");
    if (latest) view.render(...latest);
    if (tabSquare !== undefined)
      host.querySelectorAll<HTMLElement>("[data-square]").forEach((button) => {
        button.tabIndex = button.dataset.square === tabSquare ? 0 : -1;
      });
    if (focusedSquare !== undefined)
      host
        .querySelector<HTMLElement>(`[data-square="${focusedSquare}"]`)
        ?.focus();
  }
  try {
    view = factory(fail);
    status("3D表示");
  } catch {
    fail();
  }
  return {
    cancelMotion() {
      view?.cancelMotion?.();
    },
    render(s, sel, p, transition) {
      if (dead) return;
      latest = [s, sel, p];
      try {
        view?.render(s, sel, p, transition);
      } catch {
        fail();
      }
    },
    dispose() {
      dead = true;
      view?.dispose();
      host.replaceChildren();
    },
  };
}
