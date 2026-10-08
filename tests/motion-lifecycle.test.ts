// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBoard2D } from "../src/render/board2d";
import { createGame, applyAction } from "../src/game/engine";
import type { BoardView } from "../src/render/board-view";
import type { GameState, Action } from "../src/game/types";
let frames: Map<number, FrameRequestCallback>,
  time: number,
  id: number,
  host: HTMLElement,
  board: BoardView;
const sel = { pieceId: null, candidate: null };
function tick(t: number) {
  time = t;
  const pending = [...frames.values()];
  frames.clear();
  for (const fn of pending) fn(t);
}
function commit(s: GameState, a: Action) {
  const r = applyAction(s, a);
  if (!r.ok) throw Error(r.error);
  board.render(r.state, sel, null, { before: s, events: r.events });
  return r.state;
}
beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  time = 0;
  id = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (i: number) => frames.delete(i));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  document.body.innerHTML = "";
  document.body.className = "";
  host = document.createElement("div");
  document.body.append(host);
  board = createBoard2D(host, () => {});
});
afterEach(() => {
  board.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.className = "";
});
it("duplicate busy/settled renders keep one animation and one labeled authoritative piece", () => {
  const s = createGame();
  board.render(s, sel, null);
  const next = commit(s, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 9,
  });
  tick(100);
  board.render(structuredClone(next), sel, null);
  expect(host.querySelectorAll('[data-effect="summon"]')).toHaveLength(1);
  expect(host.querySelectorAll("[data-moving-piece]")).toHaveLength(1);
  expect(host.querySelector(".moving-piece .life")?.textContent).toBe("3");
  expect(host.querySelectorAll(".square .motion-hidden")).toHaveLength(1);
  tick(600);
  expect(frames.size).toBe(0);
  expect(
    host.querySelectorAll(".moving-piece,.motion-hidden,[data-effect]"),
  ).toHaveLength(0);
});
it.each([0, 140, 300, 420, 550])(
  "restart at %ims cancels old callbacks and leaves only the fresh board",
  (phase) => {
    const s = createGame();
    board.render(s, sel, null);
    commit(s, { type: "summon", kind: "carver", duration: 3, to: 9 });
    tick(phase);
    board.cancelMotion?.();
    board.render(createGame(), sel, null);
    tick(1000);
    vi.runAllTimers();
    expect(frames.size).toBe(0);
    expect(
      host.querySelectorAll("[data-moving-piece],[data-effect],.motion-hidden"),
    ).toHaveLength(0);
    expect(host.querySelectorAll(".square .piece:not(.core)")).toHaveLength(2);
  },
);
it("new CPU-speed commit supersedes the old generation without later cleanup removing new state", () => {
  const s = createGame();
  board.render(s, sel, null);
  const white = commit(s, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 9,
  });
  tick(300);
  const black = commit(white, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 39,
  });
  tick(450);
  expect(host.querySelectorAll("[data-moving-piece]")).toHaveLength(1);
  expect(
    host
      .querySelector("[data-moving-piece]")
      ?.getAttribute("data-moving-piece"),
  ).toContain("black");
  tick(900);
  vi.runAllTimers();
  board.render(black, sel, null);
  expect(frames.size).toBe(0);
  expect(host.querySelectorAll(".square .piece:not(.core)")).toHaveLength(4);
});
it("enabling in-game reduced motion mid-travel immediately restores final pieces", async () => {
  const s = createGame();
  board.render(s, sel, null);
  commit(s, { type: "summon", kind: "carver", duration: 3, to: 9 });
  tick(100);
  document.body.classList.add("no-motion");
  await Promise.resolve();
  expect(frames.size).toBe(0);
  expect(host.querySelectorAll(".moving-piece,.motion-hidden")).toHaveLength(0);
  expect(host.querySelector('[data-square="9"] .life')?.textContent).toBe("3");
});
it("OS reduced motion shows bounded static labels without a frame loop", () => {
  board.dispose();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  board = createBoard2D(host, () => {});
  const s = createGame();
  board.render(s, sel, null);
  commit(s, { type: "summon", kind: "carver", duration: 3, to: 9 });
  expect(frames.size).toBe(0);
  expect(host.querySelectorAll(".moving-piece,.motion-hidden")).toHaveLength(0);
  expect(host.querySelector('[data-effect="summon"]')?.textContent).toBe(
    "召喚",
  );
  vi.runAllTimers();
  expect(host.querySelectorAll("[data-effect]")).toHaveLength(0);
});
it("backgrounding and disposal leave no running frames, hidden pieces or orphan effects", () => {
  const s = createGame();
  board.render(s, sel, null);
  commit(s, { type: "summon", kind: "carver", duration: 3, to: 9 });
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(0);
  expect(host.querySelectorAll(".motion-hidden")).toHaveLength(0);
  board.dispose();
  tick(900);
  vi.runAllTimers();
  expect(host.children).toHaveLength(0);
});
it("a captured victim retains its purchased lifetime until impact instead of looking expired", () => {
  const s = createGame();
  s.pieces = [
    {
      id: "m",
      kind: "carver",
      side: "white",
      square: 9,
      remaining: 1,
      summonedPly: -1,
    },
    {
      id: "v",
      kind: "carver",
      side: "black",
      square: 18,
      remaining: 3,
      summonedPly: -1,
    },
  ];
  board.render(s, sel, null);
  commit(s, { type: "move", pieceId: "m", to: 18 });
  tick(100);
  expect(host.querySelector('[data-moving-piece="v"] .life')?.textContent).toBe(
    "3",
  );
  tick(300);
  expect(host.querySelector('[data-moving-piece="m"] .life')?.textContent).toBe(
    "1",
  );
  tick(400);
  expect(host.querySelector('[data-moving-piece="m"] .life')?.textContent).toBe(
    "0",
  );
});
