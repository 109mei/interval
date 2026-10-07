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
    view?.dispose();
    host.replaceChildren();
    view = createBoard2D(host, click);
    status("2D表示 · 立体表示を利用できないため切り替えました");
    if (latest) view.render(...latest);
  }
  try {
    view = factory(fail);
    status("3D表示");
  } catch {
    fail();
  }
  return {
    render(s, sel, p) {
      if (dead) return;
      latest = [s, sel, p];
      try {
        view?.render(s, sel, p);
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
