// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createBoard3D } from "../src/render/board3d";
import { createAdaptiveBoard } from "../src/render/adaptive";
import { createGame, applyAction } from "../src/game/engine";
import { recoverTransition } from "../src/render/motion";
import type { BoardView } from "../src/render/board-view";
import type { GameState } from "../src/game/types";

const gpu = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  disconnect: vi.fn(),
  scene: null as unknown,
}));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      shadowMap = {};
      setPixelRatio() {}
      setClearColor() {}
      setSize() {}
      render(scene: THREE.Scene, camera: THREE.Camera) {
        gpu.scene = scene;
        gpu.render(scene, camera);
      }
      dispose() {
        gpu.dispose();
      }
    },
  };
});

let now = 0;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const boards: BoardView[] = [];
const selection = { pieceId: null, candidate: null };
const scene = () => gpu.scene as THREE.Scene;
const model = (name: string) => scene().getObjectByName(name) as THREE.Group;
function advanceFrame(time: number) {
  now = time;
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(time);
}
function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}
function movingState(): GameState {
  const state = createGame();
  state.pieces = [
    {
      id: "mover",
      side: "white",
      kind: "carver",
      square: 9,
      remaining: 3,
      summonedPly: -1,
    },
    {
      id: "observer",
      side: "black",
      kind: "bastion",
      square: 38,
      remaining: 3,
      summonedPly: -1,
    },
  ];
  return state;
}
function commitMove(board: BoardView, before: GameState, to = 18) {
  const result = applyAction(before, { type: "move", pieceId: "mover", to });
  if (!result.ok) throw Error("Illegal test fixture");
  board.render(result.state, selection, null, {
    before,
    events: result.events,
  });
  return result.state;
}
beforeEach(() => {
  gpu.render.mockReset();
  gpu.dispose.mockReset();
  gpu.disconnect.mockReset();
  gpu.scene = null;
  now = 0;
  nextFrame = 0;
  frames.clear();
  document.body.innerHTML = "";
  document.body.className = "";
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {
        gpu.disconnect();
      }
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  gpu.render.mockReset();
  for (const board of boards.splice(0)) board.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("last-life core capture at move 200 leaves the winning piece and only the winning core", () => {
  const element = host();
  const board = createBoard3D(
    element,
    () => {},
    () => {},
  );
  boards.push(board);
  const before = movingState();
  before.ply = 199;
  before.pieces = [{ ...before.pieces[0], square: 36, remaining: 1 }];
  board.render(before, selection, null);
  const after = commitMove(board, before, 45);
  expect(model("core:black").visible).toBe(true);
  advanceFrame(140);
  expect(model("core:black").visible).toBe(true);
  advanceFrame(280);
  expect(model("core:black").visible).toBe(false);
  advanceFrame(600);
  expect(after.outcome).toEqual({ kind: "win", winner: "white" });
  expect(model("core:black")).toBeUndefined();
  expect(model("core:white")).toBeDefined();
  expect(model("piece:mover").position.toArray()).toEqual([0, 0, -3]);
  expect(model("piece:mover").visible).toBe(true);
  expect(element.querySelector('[data-life-for="mover"]')?.textContent).toBe(
    "1",
  );
  expect(frames.size).toBe(0);
});

it("surviving model and geometry identities persist through movement and repeated renders", () => {
  const element = host();
  const board = createBoard3D(
    element,
    () => {},
    () => {},
  );
  boards.push(board);
  const before = movingState();
  board.render(before, selection, null);
  const mover = model("piece:mover"),
    observer = model("piece:observer");
  const geometry = (mover.children[0] as THREE.Mesh).geometry;
  const release = vi.spyOn(geometry, "dispose");
  const after = commitMove(board, before);
  advanceFrame(140);
  const midPosition = mover.position.clone();
  board.render(after, { pieceId: "observer", candidate: null }, null);
  expect(model("piece:mover")).toBe(mover);
  expect(model("piece:observer")).toBe(observer);
  expect(mover.position.equals(midPosition)).toBe(true);
  expect(release).not.toHaveBeenCalled();
  advanceFrame(600);
  expect(mover.position.toArray()).toEqual([1, 0, 1]);
  expect((mover.children[0] as THREE.Mesh).geometry).toBe(geometry);
  expect(frames.size).toBe(0);
});

it("settling capture and expiry releases departing models; disposal releases shadows and pending frames", () => {
  const element = host();
  const board = createBoard3D(
    element,
    () => {},
    () => {},
  );
  boards.push(board);
  const before = movingState();
  before.pieces = [
    { ...before.pieces[0], remaining: 1 },
    {
      id: "victim",
      side: "black",
      kind: "carver",
      square: 18,
      remaining: 3,
      summonedPly: -1,
    },
  ];
  board.render(before, selection, null);
  commitMove(board, before);
  const moverRelease = vi.spyOn(
    (model("piece:mover").children[0] as THREE.Mesh).geometry,
    "dispose",
  );
  const victimRelease = vi.spyOn(
    (model("piece:victim").children[0] as THREE.Mesh).geometry,
    "dispose",
  );
  advanceFrame(140);
  expect(element.querySelector('[data-life-for="victim"]')?.textContent).toBe(
    "3",
  );
  expect(element.querySelector('[data-life-for="mover"]')?.textContent).toBe(
    "1",
  );
  advanceFrame(300);
  expect(element.querySelector('[data-life-for="victim"]')?.textContent).toBe(
    "3",
  );
  expect(element.querySelector('[data-life-for="mover"]')?.textContent).toBe(
    "1",
  );
  advanceFrame(400);
  expect(element.querySelector('[data-life-for="mover"]')?.textContent).toBe(
    "0",
  );
  advanceFrame(600);
  expect(model("piece:mover")).toBeUndefined();
  expect(model("piece:victim")).toBeUndefined();
  expect(moverRelease).toHaveBeenCalledOnce();
  expect(victimRelease).toHaveBeenCalledOnce();
  expect(
    element.querySelectorAll(
      '[data-life-for="mover"], [data-life-for="victim"]',
    ),
  ).toHaveLength(0);
  const light = scene().children.find(
    (object) => object instanceof THREE.DirectionalLight && object.castShadow,
  ) as THREE.DirectionalLight;
  const shadowRelease = vi.spyOn(light.shadow, "dispose");
  light.shadow.map = new THREE.WebGLRenderTarget(2, 2);
  const mapRelease = vi.spyOn(light.shadow.map, "dispose");
  board.dispose();
  expect(shadowRelease).toHaveBeenCalledOnce();
  expect(mapRelease).toHaveBeenCalledOnce();
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(gpu.disconnect).toHaveBeenCalledOnce();
  expect(element.children).toHaveLength(0);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("context loss during movement settles the latest state in 2D without replay or stale frames", () => {
  const element = host();
  let status = "";
  const board = createAdaptiveBoard(
    element,
    () => {},
    (failure) => createBoard3D(element, () => {}, failure),
    (value) => {
      status = value;
    },
  );
  boards.push(board);
  const before = movingState();
  board.render(before, selection, null);
  commitMove(board, before);
  const staleFrame = [...frames.values()][0];
  element
    .querySelector("canvas")!
    .dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  expect(status).toContain("2D");
  expect(element.querySelectorAll(".board-grid [data-square]")).toHaveLength(
    49,
  );
  expect(
    element.querySelector('[data-square="18"] [data-piece-id="mover"]'),
  ).not.toBeNull();
  expect(
    element.querySelectorAll("[data-effect], [data-moving-piece]"),
  ).toHaveLength(0);
  const rendered = gpu.render.mock.calls.length;
  staleFrame(16);
  expect(gpu.render).toHaveBeenCalledTimes(rendered);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("a scheduled-frame renderer exception falls back to 2D and releases the animation loop", () => {
  const element = host();
  let status = "";
  const board = createAdaptiveBoard(
    element,
    () => {},
    (failure) => createBoard3D(element, () => {}, failure),
    (value) => {
      status = value;
    },
  );
  boards.push(board);
  const before = movingState();
  board.render(before, selection, null);
  commitMove(board, before);
  gpu.render.mockImplementationOnce(() => {
    throw Error("GPU frame failed");
  });
  expect(() => advanceFrame(16)).not.toThrow();
  expect(status).toContain("2D");
  expect(element.querySelectorAll(".board-grid [data-square]")).toHaveLength(
    49,
  );
  expect(
    element.querySelector('[data-square="18"] [data-piece-id="mover"]'),
  ).not.toBeNull();
  expect(
    element.querySelectorAll("[data-effect], [data-moving-piece]"),
  ).toHaveLength(0);
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("repeated reduced-motion renders keep a committed summon visible without starting frame zero", () => {
  document.body.className = "no-motion";
  const element = host();
  const board = createBoard3D(
    element,
    () => {},
    () => {},
  );
  boards.push(board);
  const before = createGame();
  board.render(before, selection, null);
  const result = applyAction(before, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 9,
  });
  if (!result.ok) throw Error("Illegal test fixture");
  board.render(result.state, selection, null, {
    before,
    events: result.events,
  });
  expect(model("piece:white-0-9").visible).toBe(true);
  board.render(result.state, selection, null);
  expect(model("piece:white-0-9").visible).toBe(true);
  expect(model("piece:white-0-9").scale.toArray()).toEqual([1, 1, 1]);
  expect(frames.size).toBe(0);
});

it("an initial animation-frame failure cannot schedule a cleanup timer after fallback disposes it", () => {
  const element = host();
  let status = "";
  const board = createAdaptiveBoard(
    element,
    () => {},
    (failure) => createBoard3D(element, () => {}, failure),
    (value) => {
      status = value;
    },
  );
  boards.push(board);
  const before = createGame();
  board.render(before, selection, null);
  const result = applyAction(before, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 9,
  });
  if (!result.ok) throw Error("Illegal test fixture");
  gpu.render.mockImplementation((currentScene: THREE.Scene) => {
    if (currentScene.getObjectByName("piece:white-0-9")?.visible === false)
      throw Error("GPU failed at frame zero");
  });
  board.render(result.state, selection, null, {
    before,
    events: result.events,
  });
  expect(status).toContain("2D");
  expect(element.querySelectorAll(".board-grid [data-square]")).toHaveLength(
    49,
  );
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("an OS preference change mid-move restores final labels and cannot replay on the next render", () => {
  let preferenceChange = () => {};
  const preference = {
    matches: false,
    addEventListener(_event: string, listener: () => void) {
      preferenceChange = listener;
    },
    removeEventListener() {},
  };
  vi.stubGlobal("matchMedia", () => preference);
  const element = host();
  const board = createBoard3D(
    element,
    () => {},
    () => {},
  );
  boards.push(board);
  const before = movingState();
  board.render(before, selection, null);
  const after = commitMove(board, before);
  advanceFrame(140);
  expect(element.querySelector('[data-life-for="mover"]')?.textContent).toBe(
    "3",
  );
  preference.matches = true;
  preferenceChange();
  expect(model("piece:mover").position.toArray()).toEqual([1, 0, 1]);
  expect(element.querySelector('[data-life-for="mover"]')?.textContent).toBe(
    "2",
  );
  board.render(structuredClone(after), selection, null);
  expect(model("piece:mover").position.toArray()).toEqual([1, 0, 1]);
  expect(frames.size).toBe(0);
  expect(element.querySelectorAll("[data-effect]")).toHaveLength(0);
});

it("a CPU-speed recovered commit supersedes the old frame without changing surviving identities or labels", () => {
  const element = host();
  const board = createBoard3D(
    element,
    () => {},
    () => {},
  );
  boards.push(board);
  const before = movingState();
  board.render(before, selection, null);
  const first = commitMove(board, before);
  advanceFrame(140);
  const oldFrame = [...frames.values()][0];
  const mover = model("piece:mover");
  advanceFrame(300);
  const result = applyAction(first, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 39,
  });
  if (!result.ok) throw Error("Illegal test fixture");
  const transition = recoverTransition(first, result.state);
  expect(transition).not.toBeNull();
  board.render(result.state, selection, null, transition);
  const beforeStale = gpu.render.mock.calls.length;
  oldFrame(450);
  expect(gpu.render).toHaveBeenCalledTimes(beforeStale);
  advanceFrame(450);
  board.render(structuredClone(result.state), selection, null);
  expect(model("piece:mover")).toBe(mover);
  expect(mover.position.toArray()).toEqual([1, 0, 1]);
  expect(element.querySelector('[data-life-for="mover"]')?.textContent).toBe(
    "2",
  );
  expect(element.querySelectorAll('[data-effect="summon"]')).toHaveLength(1);
  advanceFrame(900);
  expect(model("piece:black-1-39").visible).toBe(true);
  expect(model("piece:black-1-39").scale.toArray()).toEqual([1, 1, 1]);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("reset and immediate recommit with the same piece ID rejects callbacks from the retired model", () => {
  const element = host();
  const board = createBoard3D(
    element,
    () => {},
    () => {},
  );
  boards.push(board);
  const before = createGame();
  board.render(before, selection, null);
  const result = applyAction(before, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 9,
  });
  if (!result.ok) throw Error("Illegal test fixture");
  board.render(result.state, selection, null, {
    before,
    events: result.events,
  });
  advanceFrame(140);
  const retired = model("piece:white-0-9");
  const oldFrame = [...frames.values()][0];
  const release = vi.spyOn(
    (retired.children[0] as THREE.Mesh).geometry,
    "dispose",
  );
  board.cancelMotion?.();
  board.render(createGame(), selection, null);
  expect(release).toHaveBeenCalledOnce();
  now = 160;
  board.render(result.state, selection, null, {
    before,
    events: result.events,
  });
  const replacement = model("piece:white-0-9");
  expect(replacement).not.toBe(retired);
  const count = gpu.render.mock.calls.length;
  oldFrame(450);
  expect(gpu.render).toHaveBeenCalledTimes(count);
  advanceFrame(800);
  expect(model("piece:white-0-9")).toBe(replacement);
  expect(replacement.position.toArray()).toEqual([-1, 0, 2]);
  expect(replacement.visible).toBe(true);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
