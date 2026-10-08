import { chooseCpuAction } from "./choose-action";
import type { GameState } from "../game/types";
self.onmessage = (event: MessageEvent<GameState>) => {
  self.postMessage(chooseCpuAction(event.data));
};
