// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoard2D } from "../src/render/board2d";
import { applyAction, createGame } from "../src/game/engine";
import type { BoardView } from "../src/render/board-view";
let board: BoardView;
let host: HTMLElement;
let now = 0;
let id = 0;
const frames = new Map<number, FrameRequestCallback>();
const sel = { pieceId: null, candidate: null };
function fixture() {
  const s = createGame();
  s.pieces = [
    {
      id: "mover",
      kind: "carver",
      side: "white",
      square: 9,
      remaining: 3,
      summonedPly: -1,
    },
    {
      id: "black",
      kind: "carver",
      side: "black",
      square: 27,
      remaining: 3,
      summonedPly: -1,
    },
  ];
  return s;
}
function start() {
  const s = fixture();
  board.render(s, sel, null);
  const r = applyAction(s, { type: "move", pieceId: "mover", to: 18 });
  if (!r.ok) throw Error(r.error);
  board.render(r.state, sel, null, { before: s, events: r.events });
  return r.state;
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
  board = createBoard2D(host, () => {});
});
afterEach(() => {
  board.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("animation frames do not rescan static or moving piece elements", () => {
  start();
  const grid = host.querySelector(".board-grid")!;
  const scan = vi.spyOn(grid, "querySelectorAll");
  const moving = host.querySelector('[data-moving-piece="mover"]')!;
  const lifeScan = vi.spyOn(moving, "querySelector");
  advance(140);
  console.info("2d-frame", {
    boardScans: scan.mock.calls.length,
    movingScans: lifeScan.mock.calls.length,
  });
  expect(scan).not.toHaveBeenCalled();
  expect(lifeScan).not.toHaveBeenCalled();
  expect(moving.querySelector(".life")?.textContent).toBe("3");
});
it("a frame does not remove and re-add an unchanged hidden piece class", () => {
  start();
  const piece = host.querySelector('[data-piece-id="mover"]')!;
  const add = vi.spyOn(piece.classList, "add");
  const remove = vi.spyOn(piece.classList, "remove");
  advance(140);
  expect(add).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(piece.classList.contains("motion-hidden")).toBe(true);
});
it("selection-triggered innerHTML replacement remaps the hidden piece at the same elapsed pose", () => {
  const after = start();
  advance(140);
  const piece = host.querySelector('[data-piece-id="mover"]')!;
  const moving = host.querySelector(
    '[data-moving-piece="mover"]',
  ) as HTMLElement;
  const pose = moving.style.cssText;
  board.render(after, { pieceId: "black", candidate: null }, null);
  const replacement = host.querySelector('[data-piece-id="mover"]')!;
  expect(replacement).not.toBe(piece);
  expect(replacement.classList.contains("motion-hidden")).toBe(true);
  expect(host.querySelector('[data-moving-piece="mover"]')).toBe(moving);
  expect(moving.style.cssText).toBe(pose);
  advance(300);
  expect(moving.querySelector(".life")?.textContent).toBe("2");
  board.cancelMotion?.();
  expect(replacement.classList.contains("motion-hidden")).toBe(false);
  expect(host.querySelector("[data-moving-piece]")).toBeNull();
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it("a new state and disposal reject stale animation work and clear hidden nodes", () => {
  start();
  advance(140);
  const stale = [...frames.values()][0];
  board.render(createGame(), sel, null);
  stale(200);
  expect(host.querySelector(".motion-hidden, [data-moving-piece]")).toBeNull();
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  board.dispose();
  stale(300);
  expect(host.children).toHaveLength(0);
});
