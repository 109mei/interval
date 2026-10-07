import { createGame, applyAction } from "../game/engine";
import { chooseCpuAction } from "../cpu/choose-action";
import type { Action, GameState, GameEvent } from "../game/types";
export type Token = { session: number; revision: number };
export type Controller = {
  getState(): GameState;
  getToken(): Token;
  getMode(): "local" | "cpu";
  getBusy(): boolean;
  getLastEvents(): readonly GameEvent[];
  submit(a: Action, t: Token): Promise<boolean>;
  restart(m: "local" | "cpu"): void;
  dispose(): void;
};
export function createController(onChange: (s: GameState) => void): Controller {
  let state = createGame(),
    session = 0,
    revision = 0,
    busy = false,
    dead = false,
    mode: "local" | "cpu" = "local",
    events: readonly GameEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const token = () => ({ session, revision }),
    matches = (t: Token) => t.session === session && t.revision === revision;
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  function schedule() {
    if (dead || mode !== "cpu" || state.turn !== "black" || state.outcome)
      return;
    const t = token();
    timer = setTimeout(() => {
      timer = undefined;
      if (dead || !matches(t) || mode !== "cpu") return;
      const a = chooseCpuAction(state);
      if (a) void perform(a, t, true);
    }, 120);
  }
  async function perform(
    a: Action,
    t: Token,
    computer = false,
  ): Promise<boolean> {
    if (
      dead ||
      busy ||
      state.outcome ||
      !matches(t) ||
      (!computer && mode === "cpu" && state.turn === "black")
    )
      return false;
    const r = applyAction(state, a);
    if (!r.ok) return false;
    busy = true;
    state = r.state;
    events = r.events;
    revision++;
    onChange(state);
    await Promise.resolve();
    if (t.session === session && !dead) {
      busy = false;
      schedule();
      onChange(state);
    }
    return true;
  }
  return {
    getState: () => state,
    getToken: token,
    getMode: () => mode,
    getBusy: () =>
      busy || (mode === "cpu" && state.turn === "black" && !state.outcome),
    getLastEvents: () => events,
    submit: (a, t) => perform(a, t),
    restart(m) {
      if (dead) return;
      clearTimer();
      mode = m;
      session++;
      revision = 0;
      busy = false;
      state = createGame();
      events = [];
      onChange(state);
    },
    dispose() {
      dead = true;
      clearTimer();
      session++;
      busy = false;
    },
  };
}
