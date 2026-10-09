// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMotionPlayer } from "../src/render/motion-player";
import { applyAction, createGame } from "../src/game/engine";
import type { Action, GameState } from "../src/game/types";

let player: ReturnType<typeof createMotionPlayer>;
let host: HTMLElement;
let now = 0;
let id = 0;
const frame = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
function fixture(remaining = 3) {
  const s = createGame();
  s.pieces = [
    {
      id: "mover",
      kind: "carver",
      side: "white",
      square: 9,
      remaining,
      summonedPly: -1,
    },
  ];
  return s;
}
function commit(before: GameState, action: Action) {
  const result = applyAction(before, action);
  if (!result.ok) throw Error(result.error);
  player.update(result.state, { before, events: result.events });
  return result.state;
}
function advance(time: number) {
  now = time;
  const pending = [...frames.values()];
  frames.clear();
  for (const fn of pending) fn(time);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.body.innerHTML = "";
  document.body.className = "";
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  now = 0;
  id = 0;
  frames.clear();
  frame.mockClear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => frames.delete(n));
  host = document.createElement("div");
  document.body.append(host);
  player = createMotionPlayer(host, (x, y) => ({ x, y }), frame);
});
afterEach(() => {
  player.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("a pass without expiry settles once without scheduling invisible animation", () => {
  const s = fixture();
  player.update(s);
  frame.mockClear();
  const next = commit(s, { type: "pass" });
  console.info("empty-pass", {
    frames: frames.size,
    timers: vi.getTimerCount(),
    callbacks: frame.mock.calls.length,
  });
  expect(next.pieces[0].remaining).toBe(2);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(frame).toHaveBeenCalledExactlyOnceWith(null, 0);
  frame.mockClear();
  player.update(structuredClone(next));
  expect(frame).not.toHaveBeenCalled();
});
it("an empty pass supersedes a pending move and rejects its stale callback", () => {
  const s = fixture();
  player.update(s);
  const moved = commit(s, { type: "move", pieceId: "mover", to: 18 });
  const stale = [...frames.values()][0];
  advance(100);
  frame.mockClear();
  commit(moved, { type: "pass" });
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(frame).toHaveBeenCalledExactlyOnceWith(null, 0);
  stale(200);
  expect(frame).toHaveBeenCalledTimes(1);
});
it("a pass that expires a piece still animates and cleans up", () => {
  const s = fixture(1);
  player.update(s);
  frame.mockClear();
  commit(s, { type: "pass" });
  expect(host.querySelector('[data-effect="expire"]')).not.toBeNull();
  expect(frames.size).toBe(1);
  expect(vi.getTimerCount()).toBe(1);
  expect(frame.mock.lastCall?.[0]?.tracks).toHaveLength(1);
  advance(600);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(host.querySelector("[data-effect]")).toBeNull();
});
it.each(["capture", "win"] as const)(
  "%s retains its motion cue and cancels cleanly",
  (kind) => {
    const s = fixture();
    if (kind === "capture")
      s.pieces = [
        ...s.pieces,
        {
          id: "victim",
          kind: "bastion",
          side: "black",
          square: 18,
          remaining: 3,
          summonedPly: -1,
        },
      ];
    else s.pieces[0].square = 36;
    player.update(s);
    commit(s, {
      type: "move",
      pieceId: "mover",
      to: kind === "capture" ? 18 : 45,
    });
    expect(host.querySelector(`[data-effect="${kind}"]`)).not.toBeNull();
    expect(frames.size).toBe(1);
    player.cancel();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector("[data-effect]")).toBeNull();
  },
);
it("reduced-motion expiry keeps its bounded static cue without frames", () => {
  document.body.className = "no-motion";
  const s = fixture(1);
  player.update(s);
  commit(s, { type: "pass" });
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(1);
  expect(host.querySelector('[data-effect="expire"]')).not.toBeNull();
  vi.runAllTimers();
  expect(host.querySelector("[data-effect]")).toBeNull();
});
