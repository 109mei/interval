import type { GameState, Selection, Preview } from "../game/types";
export type BoardView = {
  render(s: GameState, selection: Selection, preview: Preview | null): void;
  dispose(): void;
};
