// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createBoard3D } from "../src/render/board3d";
import { applyAction, createGame } from "../src/game/engine";
import type { BoardView } from "../src/render/board-view";

// A real scene/camera/model graph with only the unavailable GPU boundary replaced.
const gpu = vi.hoisted(() => ({
  render: vi.fn(),
  size: vi.fn(),
  ratio: vi.fn(),
  dispose: vi.fn(),
  resize: () => {},
  scene: null as unknown,
  shadows: null as unknown,
}));
vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      shadowMap = {};
      constructor() {
        gpu.shadows = this.shadowMap;
      }
      setPixelRatio(value: number) {
        gpu.ratio(value);
      }
      setSize(...args: unknown[]) {
        gpu.size(...args);
      }
      setClearColor() {}
      render(scene: THREE.Scene) {
        gpu.scene = scene;
        gpu.render(scene);
      }
      dispose() {
        gpu.dispose();
      }
    },
  };
});
let board: BoardView;
let host: HTMLElement;
let width: number;
let now: number;
let id: number;
const frames = new Map<number, FrameRequestCallback>();
const sel = { pieceId: null, candidate: null };
function state() {
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
  ];
  return s;
}
function counts() {
  return {
    renders: gpu.render.mock.calls.length,
    sizes: gpu.size.mock.calls.length,
    ratios: gpu.ratio.mock.calls.length,
  };
}
function resetCounts() {
  gpu.render.mockClear();
  gpu.size.mockClear();
  gpu.ratio.mockClear();
}
function advance(time: number) {
  now = time;
  const pending = [...frames.values()];
  frames.clear();
  for (const fn of pending) fn(time);
}
function move(s = state()) {
  const result = applyAction(s, { type: "move", pieceId: "mover", to: 18 });
  if (!result.ok) throw Error(result.error);
  board.render(result.state, sel, null, { before: s, events: result.events });
  return result.state;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  now = 0;
  id = 0;
  width = 420;
  frames.clear();
  gpu.dispose.mockClear();
  document.body.innerHTML = "";
  document.body.className = "";
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => frames.delete(n));
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn: () => void) {
        gpu.resize = fn;
      }
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { get: () => width });
  document.body.append(host);
  board = createBoard3D(
    host,
    () => {},
    () => {
      throw Error("Unexpected renderer failure");
    },
  );
  resetCounts();
});
afterEach(() => {
  board.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("draws the initial board once and sizes it once", () => {
  board.render(state(), sel, null);
  console.info("initial", counts());
  expect(counts()).toEqual({ renders: 1, sizes: 1, ratios: 0 });
  expect(host.querySelectorAll("[data-square]")).toHaveLength(49);
  expect(host.querySelector('[data-life-for="mover"]')?.textContent).toBe("3");
});
it("unchanged and selection-only updates do not reset the drawing buffer", () => {
  const s = state();
  board.render(s, sel, null);
  resetCounts();
  board.render(s, sel, null);
  console.info("unchanged", counts());
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
  resetCounts();
  board.render(s, { pieceId: "mover", candidate: null }, null);
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
  expect(
    host.querySelector('[data-square="9"]')?.getAttribute("aria-pressed"),
  ).toBe("true");
});
it("changed static state renders once with updated labels", () => {
  const s = state();
  board.render(s, sel, null);
  resetCounts();
  const next = structuredClone(s);
  next.pieces[0].remaining = 2;
  board.render(next, sel, null);
  console.info("changed-static", counts());
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
  expect(host.querySelector('[data-life-for="mover"]')?.textContent).toBe("2");
});
it("a transition starts with one sampled render and frames do not resize", () => {
  const s = state();
  board.render(s, sel, null);
  resetCounts();
  const next = move(s);
  console.info("transition-start", counts());
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
  const scene = gpu.scene as THREE.Scene;
  expect(scene.getObjectByName("piece:mover")!.position.toArray()).toEqual([
    -1, 0, 2,
  ]);
  resetCounts();
  advance(140);
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
  const halfway = scene.getObjectByName("piece:mover")!.position.clone();
  resetCounts();
  board.render(next, { pieceId: "mover", candidate: null }, null);
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
  expect(scene.getObjectByName("piece:mover")!.position.equals(halfway)).toBe(
    true,
  );
});
it("resize keeps the sampled pose and produces one render", () => {
  const s = state();
  board.render(s, sel, null);
  move(s);
  advance(140);
  const before = (gpu.scene as THREE.Scene)
    .getObjectByName("piece:mover")!
    .position.clone();
  resetCounts();
  width = 560;
  gpu.resize();
  console.info("resize-during-motion", counts());
  expect(counts()).toEqual({ renders: 1, sizes: 1, ratios: 0 });
  expect(
    (gpu.scene as THREE.Scene)
      .getObjectByName("piece:mover")!
      .position.equals(before),
  ).toBe(true);
  resetCounts();
  gpu.resize();
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
});
it("quality changes update ratio and shadows only when needed", () => {
  const s = state();
  board.render(s, sel, null);
  resetCounts();
  document.body.classList.add("low-quality");
  board.render(s, sel, null);
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 1 });
  expect(gpu.ratio).toHaveBeenLastCalledWith(1);
  expect((gpu.shadows as { enabled: boolean }).enabled).toBe(false);
  resetCounts();
  board.render(s, sel, null);
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
  document.body.classList.remove("low-quality");
  resetCounts();
  board.render(s, sel, null);
  expect(gpu.ratio).toHaveBeenCalledExactlyOnceWith(1.75);
  expect((gpu.shadows as { enabled: boolean }).enabled).toBe(true);
});
it("cancel settles once and disposal cannot render or retain scheduled work", () => {
  const s = state();
  board.render(s, sel, null);
  move(s);
  advance(140);
  const stale = [...frames.values()][0];
  resetCounts();
  board.cancelMotion?.();
  console.info("cancel", counts());
  expect(counts()).toEqual({ renders: 1, sizes: 0, ratios: 0 });
  expect(
    (gpu.scene as THREE.Scene)
      .getObjectByName("piece:mover")!
      .position.toArray(),
  ).toEqual([1, 0, 1]);
  expect(host.querySelector('[data-life-for="mover"]')?.textContent).toBe("2");
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  resetCounts();
  board.dispose();
  stale(200);
  gpu.resize();
  expect(gpu.render).not.toHaveBeenCalled();
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(host.children).toHaveLength(0);
});

it("updates an animated piece's labels directly instead of rescanning all labels", () => {
  const s = state();
  board.render(s, sel, null);
  move(s);
  const labels = host.querySelector(".overlay-labels")!;
  const scan = vi.spyOn(labels, "querySelectorAll");
  advance(140);
  expect(scan).not.toHaveBeenCalled();
  expect(host.querySelector('[data-life-for="mover"]')?.textContent).toBe("3");
  advance(300);
  expect(host.querySelector('[data-life-for="mover"]')?.textContent).toBe("2");
});

it("a first-render transition projects cues like a board with an initial static render", () => {
  const before = createGame();
  const result = applyAction(before, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 9,
  });
  if (!result.ok) throw Error(result.error);
  const transition = { before, events: result.events };
  board.render(before, sel, null);
  board.render(result.state, sel, null, transition);
  const reference = host.querySelector('[data-effect="summon"]') as HTMLElement;
  const directHost = document.createElement("div");
  document.body.append(directHost);
  const direct = createBoard3D(
    directHost,
    () => {},
    () => {
      throw Error("Unexpected renderer failure");
    },
  );
  try {
    direct.render(result.state, sel, null, transition);
    const cue = directHost.querySelector(
      '[data-effect="summon"]',
    ) as HTMLElement;
    expect(cue.style.left).toBe(reference.style.left);
    expect(cue.style.top).toBe(reference.style.top);
    expect(parseFloat(cue.style.top)).toBeGreaterThan(0);
    expect(parseFloat(cue.style.top)).toBeLessThan(100);
  } finally {
    direct.dispose();
  }
});
