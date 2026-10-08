import type { GameState, Selection, Preview } from "../game/types";
import type { BoardTransition } from "./motion";
export type BoardView = {
  render(
    s: GameState,
    selection: Selection,
    preview: Preview | null,
    transition?: BoardTransition | null,
  ): void;
  cancelMotion?(): void;
  dispose(): void;
};
