// @vitest-environment jsdom
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { applyAction, createGame } from "../src/game/engine";
import { createBoard2D } from "../src/render/board2d";
import { createBoard3D } from "../src/render/board3d";
import { createMotionPlayer } from "../src/render/motion-player";
import type { Action, GameState, Piece, Selection } from "../src/game/types";
import type { BoardView } from "../src/render/board-view";

// Real DOM and real Three.js scene/camera/geometry. Only unavailable WebGL is
// replaced. Submission/resource-event counts do not measure GPU time or phone FPS.
const gpu = vi.hoisted(() => ({
  render: vi.fn(),
  size: vi.fn(),
  ratio: vi.fn(),
  dispose: vi.fn(),
  scene: null as unknown,
  camera: null as unknown,
}));
vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      shadowMap = {};
      setPixelRatio(v: number) {
        gpu.ratio(v);
      }
      setSize(...v: unknown[]) {
        gpu.size(...v);
      }
      setClearColor() {}
      render(scene: THREE.Scene, camera: THREE.Camera) {
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        gpu.scene = scene;
        gpu.camera = camera;
        gpu.render(scene, camera);
      }
      dispose() {
        gpu.dispose();
      }
    },
  };
});
const path = "docs/review200/motion-cases.json";
type Row = {
  id: string;
  persona: string;
  task: string;
  precondition: string;
  sequence: string[];
  assertion: string;
  observations: string[];
  changeOrNoChange: string;
  retest: string;
  limitations: string;
};
const old: Row[] = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : [];
const rows: Row[] = [];
function add(
  persona: string,
  task: string,
  precondition: string,
  sequence: string[],
  assertion: string,
  run: () => unknown | Promise<unknown>,
) {
  const id = `R200-M${String(rows.length + 1).padStart(3, "0")}`;
  const previous = old.find((r) => r.id === id);
  const row: Row = {
    id,
    persona,
    task,
    precondition,
    sequence,
    assertion,
    observations: previous?.observations ?? [],
    changeOrNoChange:
      previous?.changeOrNoChange ??
      "No production change justified: independently specified lifecycle and resource assertions pass within the stated test layer.",
    retest: "NOT RUN",
    limitations:
      "jsdom DOM and real Three.js CPU scene/camera/geometry; WebGLRenderer replaced by instrumentation. No browser pixels, physical mobile input, GPU allocations, FPS, or screen-reader speech verified.",
  };
  rows.push(row);
  it(`${id} ${task}`, async () => {
    try {
      await run();
      row.retest = "PASS";
      if (
        !row.observations.includes(
          "PASS: fresh focused execution satisfied all scenario assertions.",
        )
      )
        row.observations.push(
          "PASS: fresh focused execution satisfied all scenario assertions.",
        );
    } catch (e) {
      row.retest = "FAIL";
      const message = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
      if (!row.observations.includes(message)) row.observations.push(message);
      row.changeOrNoChange = "Scenario failed; inspect the failing assertion.";
      throw e;
    }
  });
}
let now = 0,
  serial = 0,
  hidden = false;
const frames = new Map<number, FrameRequestCallback>();
const resizes: { fn: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
const cleanup: (() => void)[] = [];
const preference = {
  matches: false,
  listeners: new Set<() => void>(),
  addEventListener(_s: string, f: () => void) {
    this.listeners.add(f);
  },
  removeEventListener(_s: string, f: () => void) {
    this.listeners.delete(f);
  },
};
const empty: Selection = { pieceId: null, candidate: null };
const move: Action = { type: "move", pieceId: "m", to: 18 };
const summon: Action = { type: "summon", kind: "carver", duration: 3, to: 9 };
const swap: Action = { type: "swap", pieceId: "l", allyId: "a" };
const piece = (
  id: string,
  square: number,
  remaining = 3,
  side: Piece["side"] = "white",
  kind: Piece["kind"] = "carver",
): Piece => ({ id, square, remaining, side, kind, summonedPly: -1 });
function state(...pieces: Piece[]): GameState {
  return { ...createGame(), pieces };
}
const movingState = () => state(piece("m", 9));
const capture = (life = 3) =>
  state(piece("m", 9, life), piece("v", 18, 3, "black"));
const swapping = (life = 3) =>
  state(
    piece("l", 23, life, "white", "link"),
    piece("a", 24, life, "white", "bastion"),
  );
function result(s: GameState, a: Action) {
  const r = applyAction(s, a);
  if (!r.ok) throw Error(`Invalid fixture ${JSON.stringify(a)}: ${r.error}`);
  return r;
}
function host() {
  const h = document.createElement("div");
  Object.defineProperty(h, "clientWidth", { configurable: true, value: 320 });
  document.body.append(h);
  return h;
}
function setup(mode: "2d" | "3d" = "2d", h = host()) {
  const click = vi.fn(),
    failure = vi.fn();
  const b =
    mode === "2d" ? createBoard2D(h, click) : createBoard3D(h, click, failure);
  let disposed = false;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      b.dispose();
    }
  };
  cleanup.push(dispose);
  return { h, b, click, failure, dispose };
}
function commit(b: BoardView, s: GameState, a: Action) {
  const r = result(s, a);
  b.render(r.state, empty, null, { before: s, events: r.events });
  return r.state;
}
function advance(time: number) {
  now = time;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((f) => f(time));
}
function width(h: HTMLElement, n: number, index = 0) {
  Object.defineProperty(h, "clientWidth", { configurable: true, value: n });
  resizes[index].fn();
}
const scene = () => gpu.scene as THREE.Scene;
const model = (id: string) => scene().getObjectByName(`piece:${id}`)!;
const life = (h: HTMLElement, id: string) =>
  h.querySelector<HTMLElement>(`[data-life-for="${id}"]`)!;
const moving = (h: HTMLElement, id: string) =>
  h.querySelector<HTMLElement>(`[data-moving-piece="${id}"]`)!;
const sq = (h: HTMLElement, q: number) =>
  h.querySelector<HTMLButtonElement>(`[data-square="${q}"]`)!;
function clean(h: HTMLElement) {
  expect(
    h.querySelectorAll("[data-effect], [data-moving-piece], .motion-hidden"),
  ).toHaveLength(0);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
}
function player(callback = vi.fn()) {
  const h = host();
  const p = createMotionPlayer(
    h,
    (x, y) => ({ x: x * 10, y: y * 10 }),
    callback,
  );
  cleanup.push(() => p.dispose());
  return { h, p, callback };
}
function enter(
  p: ReturnType<typeof createMotionPlayer>,
  s = movingState(),
  a = move,
) {
  p.update(s);
  const r = result(s, a);
  p.update(r.state, { before: s, events: r.events });
  return r.state;
}
function resources(root: THREE.Object3D) {
  const found = new Set<THREE.BufferGeometry | THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      found.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        found.add(m),
      );
    }
  });
  return [...found];
}
function projectedCue(h: HTMLElement, kind: string, q: number) {
  const cue = h.querySelector<HTMLElement>(
    `[data-effect="${kind}"][data-at="${q}"]`,
  )!;
  expect(cue).not.toBeNull();
  const v = new THREE.Vector3((q % 7) - 3, 0.15, 3 - Math.floor(q / 7)).project(
    gpu.camera as THREE.Camera,
  );
  expect(parseFloat(cue.style.left)).toBeCloseTo((v.x + 1) * 50);
  expect(parseFloat(cue.style.top)).toBeCloseTo((1 - v.y) * 50);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  now = 0;
  serial = 0;
  hidden = false;
  frames.clear();
  resizes.length = 0;
  preference.matches = false;
  preference.listeners.clear();
  document.body.replaceChildren();
  document.body.className = "";
  gpu.render.mockClear();
  gpu.size.mockClear();
  gpu.ratio.mockClear();
  gpu.dispose.mockClear();
  gpu.scene = null;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.set(++serial, f);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => preference);
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(fn: () => void) {
        resizes.push({ fn, disconnect: this.disconnect });
      }
      observe() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Network forbidden in review200 motion tests");
    }),
  );
});
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});
afterAll(() => {
  writeFileSync(
    join(tmpdir(), "interval-review200-motion-results.json"),
    JSON.stringify(rows, null, 2) + "\n",
  );
});

// M001–M012: optimized 2D node-cache replacement and host lifecycle.
add(
  "Novice local player",
  "Refresh both cached swap identities across alternating selections",
  "Two surviving allies swap while destination selection can rewrite square markup",
  [
    "Commit swap",
    "Sample 140ms",
    "Alternate selected ally twelve times",
    "Cancel",
  ],
  "Exactly two moving nodes persist; each fresh stationary node stays hidden until cancellation",
  () => {
    const { b, h } = setup();
    const s = swapping();
    b.render(s, empty, null);
    const next = commit(b, s, swap);
    advance(140);
    const overlays = [moving(h, "l"), moving(h, "a")];
    for (let i = 0; i < 12; i++) {
      b.render(next, { pieceId: i % 2 ? "l" : "a", candidate: null }, null);
      expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(2);
      for (const id of ["l", "a"])
        expect(
          h
            .querySelector(`[data-piece-id="${id}"]`)!
            .classList.contains("motion-hidden"),
        ).toBe(true);
    }
    expect([moving(h, "l"), moving(h, "a")]).toEqual(overlays);
    b.cancelMotion!();
    clean(h);
  },
);
add(
  "Small-screen mobile player",
  "Keep capture and remote expiry caches distinct during inspection",
  "Capturing mover has an unrelated one-life ally",
  ["Capture at18", "Sample impact", "Inspect surviving mover", "Sample expiry"],
  "Three moving identities retain distinct life text after square cache rebuild",
  () => {
    const { b, h } = setup();
    const s = state(...capture().pieces, piece("old", 11, 1));
    b.render(s, empty, null);
    const next = commit(b, s, move);
    advance(300);
    b.render(next, { pieceId: "m", candidate: null, inspectOnly: true }, null);
    advance(400);
    expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(3);
    expect(moving(h, "m").querySelector(".life")!.textContent).toBe("2");
    expect(moving(h, "v").querySelector(".life")!.textContent).toBe("3");
    expect(moving(h, "old").querySelector(".life")!.textContent).toBe("0");
  },
);
add(
  "Returning player",
  "Replace an in-flight identity with another role in a corrected snapshot",
  "Same ID is reused by a restored snapshot with a different role",
  ["Animate carver", "Render corrected Link at24", "Invoke retired frame"],
  "Old moving role and hidden-node cache cannot overwrite the replacement",
  () => {
    const { b, h } = setup();
    const s = movingState();
    b.render(s, empty, null);
    commit(b, s, move);
    advance(100);
    const stale = [...frames.values()][0];
    b.render(state(piece("m", 24, 4, "white", "link")), empty, null);
    stale(400);
    clean(h);
    expect(sq(h, 24).textContent).toContain("4");
    expect(sq(h, 24).querySelector(".piece-mark")!.textContent).toBe("換");
  },
);
add(
  "Long-session player",
  "Bound moving DOM while twenty inspection renders replace target markup",
  "Capture animation is active at110ms",
  [
    "Capture",
    "Alternate selected and empty state twenty times",
    "Sample again",
  ],
  "Moving glyph identity remains stable and one RAF plus one watchdog remain",
  () => {
    const { b, h } = setup();
    const s = capture();
    b.render(s, empty, null);
    const n = commit(b, s, move);
    advance(110);
    const m = moving(h, "m");
    for (let i = 0; i < 20; i++)
      b.render(n, i % 2 ? empty : { pieceId: "m", candidate: null }, null);
    advance(150);
    expect(moving(h, "m")).toBe(m);
    expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(2);
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Motion-sensitive player",
  "Re-enable normal animation after completing a reduced entrance",
  "In-game no-motion mode is on for first summon",
  [
    "Commit reduced summon",
    "Expire static cue",
    "Disable no-motion",
    "Commit opponent summon",
  ],
  "Second cue uses animated layer and has only one live schedule",
  async () => {
    document.body.className = "no-motion";
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    const n = commit(b, s, summon);
    vi.runAllTimers();
    document.body.className = "";
    await Promise.resolve();
    commit(b, n, { type: "summon", kind: "bastion", duration: 1, to: 39 });
    expect(
      h.querySelector(".board-effects")!.classList.contains("reduced"),
    ).toBe(false);
    expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(1);
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Screen-reader player",
  "Settle motion on a grain-only authoritative correction",
  "Piece locations are unchanged but server grain differs",
  ["Move", "Sample140ms", "Render corrected grain only", "Invoke old frame"],
  "Motion ends despite identical piece positions; accessible destination life is authoritative",
  () => {
    const { b, h } = setup();
    const s = movingState();
    b.render(s, empty, null);
    const n = commit(b, s, move);
    advance(140);
    const stale = [...frames.values()][0];
    b.render(
      { ...n, grain: { ...n.grain, black: n.grain.black + 1 } },
      empty,
      null,
    );
    stale(150);
    clean(h);
    expect(sq(h, 18).getAttribute("aria-label")).toContain("残り2ターン");
  },
);
add(
  "Returning player",
  "Reuse a square for a different ID while a former occupant is moving",
  "New snapshot replaces destination occupant",
  ["Start move", "Render new ID on18", "Call retired RAF"],
  "Only replacement ID remains and its life is not taken from old cache",
  () => {
    const { b, h } = setup();
    const s = movingState();
    b.render(s, empty, null);
    commit(b, s, move);
    const stale = [...frames.values()][0];
    b.render(
      state(piece("replacement", 18, 5, "black", "leaper")),
      empty,
      null,
    );
    stale(280);
    clean(h);
    expect(h.querySelector('[data-piece-id="m"]')).toBeNull();
    expect(sq(h, 18).querySelector(".life")!.textContent).toBe("5");
  },
);
add(
  "Novice restarting player",
  "Restart then summon the same generated ID without stale concealment",
  "A summon has a stable generated ID across restarted games",
  [
    "Summon",
    "Sample90ms",
    "Render empty restart",
    "Summon same kind and square again",
    "Settle",
  ],
  "New overlay has a fresh identity and final glyph is restored",
  () => {
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    advance(90);
    const first = moving(h, "white-0-9");
    b.render(createGame(), empty, null);
    commit(b, createGame(), summon);
    const second = moving(h, "white-0-9");
    expect(second).not.toBe(first);
    advance(700);
    clean(h);
    expect(
      h
        .querySelector('[data-piece-id="white-0-9"]')!
        .classList.contains("motion-hidden"),
    ).toBe(false);
  },
);
add(
  "Mobile returning player",
  "Retired frame cannot alter a new 2D owner of the same host",
  "Old animated board is disposed and host is reused",
  [
    "Capture old callback",
    "Dispose",
    "Create second board on host",
    "Call old callback",
  ],
  "Replacement controls and state remain connected without old moving nodes",
  () => {
    const oldBoard = setup();
    const s = movingState();
    oldBoard.b.render(s, empty, null);
    commit(oldBoard.b, s, move);
    const stale = [...frames.values()][0];
    oldBoard.dispose();
    const fresh = setup("2d", oldBoard.h);
    fresh.b.render(state(piece("new", 25)), empty, null);
    const button = sq(fresh.h, 25);
    stale(200);
    expect(sq(fresh.h, 25)).toBe(button);
    clean(fresh.h);
  },
);
add(
  "Long-session player",
  "Repeated old-board disposal must not erase the new host owner",
  "A disposed 2D view is cleaned up again after host reuse",
  [
    "Dispose old board",
    "Mount new 2D board on same host",
    "Dispose old board again",
  ],
  "New board keeps all49 controls and live square input",
  () => {
    const oldBoard = setup();
    oldBoard.b.render(movingState(), empty, null);
    oldBoard.dispose();
    const fresh = setup("2d", oldBoard.h);
    fresh.b.render(createGame(), empty, null);
    oldBoard.b.dispose();
    expect(fresh.h.querySelectorAll("[data-square]")).toHaveLength(49);
    sq(fresh.h, 9).click();
    expect(fresh.click).toHaveBeenCalledExactlyOnceWith(9);
  },
);
add(
  "Keyboard-only player",
  "Keep one tab stop during repeated swap cache replacement",
  "Focused destination is retained during keyboard inspection",
  ["Start swap", "Focus24", "Alternate thirty selections at same sample"],
  "Focus remains on same button and exactly one board control is tabbable",
  () => {
    const { b, h } = setup();
    const s = swapping();
    b.render(s, empty, null);
    const n = commit(b, s, swap);
    advance(140);
    const focus = sq(h, 24);
    focus.focus();
    for (let i = 0; i < 30; i++)
      b.render(n, { pieceId: i % 2 ? "a" : "l", candidate: null }, null);
    expect(document.activeElement).toBe(focus);
    expect(h.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
    expect(focus.getAttribute("aria-pressed")).toBe("false");
    expect(sq(h, 23).getAttribute("aria-pressed")).toBe("true");
  },
);
add(
  "Long-session player",
  "Mixed clear entrance expiry and cancellation cycles retain bounded 2D DOM",
  "Twenty independent sessions reuse one board",
  [
    "Reset each cycle",
    "Alternate summon and last-life capture",
    "Sample and cancel each",
  ],
  "Each cycle ends with49 controls, zero moving nodes, zero timers, and one preference listener",
  () => {
    const { b, h } = setup();
    for (let i = 0; i < 20; i++) {
      const s = i % 2 ? capture(1) : createGame();
      b.render(s, empty, null);
      commit(b, s, i % 2 ? move : summon);
      advance(now + 330);
      b.cancelMotion!();
      clean(h);
      expect(h.querySelectorAll("[data-square]")).toHaveLength(49);
      expect(preference.listeners.size).toBe(1);
    }
  },
);

// M013–M034: first-render CPU projection and optimized Three.js lifecycle.
add(
  "Long-session 3D player",
  "Post-disposal render must not allocate fresh scene models",
  "Disposed real Three scene is retained for lifecycle inspection",
  ["Render carver", "Dispose", "Render snapshot containing a new Link"],
  "Disposed scene must not gain a never-disposed replacement model",
  () => {
    const { b, dispose } = setup("3d");
    b.render(movingState(), empty, null);
    const retired = scene();
    dispose();
    gpu.render.mockClear();
    b.render(state(piece("late", 24, 3, "white", "link")), empty, null);
    expect(!!retired.getObjectByName("piece:late")).toBe(false);
    expect(gpu.render).not.toHaveBeenCalled();
  },
);
add(
  "Mobile switching views",
  "Double disposal of retired 3D view preserves new 2D host owner",
  "Same host is handed from3D to2D",
  ["Render3D", "Dispose", "Mount2D", "Dispose3D again", "Trigger old resize"],
  "2D retains49 controls and old renderer disposes exactly once",
  () => {
    const previous = setup("3d");
    previous.b.render(movingState(), empty, null);
    previous.dispose();
    const next = setup("2d", previous.h);
    next.b.render(createGame(), empty, null);
    previous.b.dispose();
    resizes[0].fn();
    expect(next.h.querySelectorAll("[data-square]")).toHaveLength(49);
    expect(gpu.dispose).toHaveBeenCalledOnce();
  },
);
add(
  "Novice 3D player",
  "Project capture reward on a direct first-render transition",
  "No initial static render primes the camera",
  ["Construct3D", "Render committed capture directly"],
  "Reward cue matches independent camera projection of18 and scene submits once",
  () => {
    const { b, h } = setup("3d");
    commit(b, capture(), move);
    projectedCue(h, "capture", 18);
    expect(gpu.render).toHaveBeenCalledOnce();
    expect(model("v").visible).toBe(true);
  },
);
add(
  "Small-screen novice",
  "Project simultaneous remote expiries on the first3D frame",
  "Three allied last-life pieces pass on first render",
  ["Create board", "Commit pass without prior render"],
  "All three independently projected cues exist at their own squares with one submission",
  () => {
    const { b, h } = setup("3d");
    commit(b, state(piece("a", 8, 1), piece("b", 16, 1), piece("c", 24, 1)), {
      type: "pass",
    });
    for (const q of [8, 16, 24]) projectedCue(h, "expire", q);
    expect(h.querySelectorAll("[data-effect]")).toHaveLength(3);
    expect(gpu.render).toHaveBeenCalledOnce();
  },
);
add(
  "Novice learning exchange",
  "Start first-frame swap with distinct cues and two authoritative origins",
  "Link and Bastion swap before any prior3D draw",
  ["Commit swap directly", "Read projected cues and model origins"],
  "Cue anchors are distinct and models start at23 and24 rather than final swapped cells",
  () => {
    const { b, h } = setup("3d");
    commit(b, swapping(), swap);
    projectedCue(h, "swap", 23);
    projectedCue(h, "swap", 24);
    expect(model("l").position.toArray()).toEqual([-1, 0, 0]);
    expect(model("a").position.toArray()).toEqual([0, 0, 0]);
    expect(gpu.render).toHaveBeenCalledOnce();
  },
);
add(
  "Novice finishing game",
  "Project first-render victory without camera priming",
  "White moves from36 to black core45 on first render",
  [
    "Commit winning move directly",
    "Inspect win cue and both cores before impact",
  ],
  "Victory cue projects45 independently and losing core remains visible before arrival",
  () => {
    const { b, h } = setup("3d");
    commit(b, state(piece("m", 36)), { type: "move", pieceId: "m", to: 45 });
    projectedCue(h, "win", 45);
    expect(scene().getObjectByName("core:black")!.visible).toBe(true);
    expect(gpu.render).toHaveBeenCalledOnce();
  },
);
add(
  "Novice balancing lifetimes",
  "Submit simultaneous first-render summon and expiry only once",
  "Newborn enters while unrelated ally expires",
  ["Commit summon directly with old ally at11", "Read two cue anchors"],
  "One scene submission contains both independent cues and both model identities",
  () => {
    const { b, h } = setup("3d");
    commit(b, state(piece("old", 11, 1)), summon);
    projectedCue(h, "summon", 9);
    projectedCue(h, "expire", 11);
    expect(model("old")).toBeDefined();
    expect(model("white-0-9").visible).toBe(false);
    expect(gpu.render).toHaveBeenCalledOnce();
  },
);
add(
  "Motion-sensitive novice",
  "Reduced first-render capture skips transient victim allocation",
  "OS reduced motion is already enabled before3D construction",
  ["Enable preference", "Directly render committed capture"],
  "Victim has no model or badge while static reward cue remains",
  () => {
    preference.matches = true;
    const { b, h } = setup("3d");
    commit(b, capture(), move);
    expect(scene().getObjectByName("piece:v")).toBeUndefined();
    expect(h.querySelector('[data-life-for="v"]')).toBeNull();
    expect(model("m").position.toArray()).toEqual([1, 0, 1]);
    projectedCue(h, "capture", 18);
    expect(frames.size).toBe(0);
    expect(gpu.render).toHaveBeenCalledOnce();
  },
);
add(
  "Motion-sensitive finishing player",
  "Reduced first-render victory allocates only the surviving core",
  "No-motion is enabled before direct win rendering",
  ["Enable no-motion", "Render first winning move"],
  "White core and winner exist, defeated core never appears, win cue is finite",
  () => {
    document.body.className = "no-motion";
    const { b, h } = setup("3d");
    commit(b, state(piece("m", 36)), { type: "move", pieceId: "m", to: 45 });
    expect(scene().getObjectByName("core:black")).toBeUndefined();
    expect(scene().getObjectByName("core:white")).toBeDefined();
    projectedCue(h, "win", 45);
    expect(frames.size).toBe(0);
  },
);
add(
  "Mobile background returner",
  "First render while hidden preserves committed state without cue allocation",
  "Document is hidden when first3D move result arrives",
  [
    "Hide document",
    "Commit direct move",
    "Return to visibility and rerender same snapshot",
  ],
  "No cue or RAF is created and model remains at final18 without replay",
  () => {
    hidden = true;
    const { b, h } = setup("3d");
    const n = commit(b, movingState(), move);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    b.render(n, empty, null);
    expect(model("m").position.toArray()).toEqual([1, 0, 1]);
    clean(h);
    expect(gpu.render).toHaveBeenCalledTimes(2);
  },
);
add(
  "Rotating mobile player",
  "Resize oscillation during swap only resets buffers on changed widths",
  "Two-track exchange sampled at140ms",
  ["Swap", "Send widths320320480480240240", "Inspect poses"],
  "Only480 and240 resize buffers, each observer call submits once, both poses remain unchanged",
  () => {
    const { b, h } = setup("3d");
    const s = swapping();
    b.render(s, empty, null);
    commit(b, s, swap);
    advance(140);
    const poses = [model("l").position.clone(), model("a").position.clone()];
    gpu.size.mockClear();
    gpu.render.mockClear();
    for (const w of [320, 320, 480, 480, 240, 240]) width(h, w);
    expect(gpu.size.mock.calls.map((c) => c[0])).toEqual([480, 240]);
    expect(gpu.render).toHaveBeenCalledTimes(6);
    expect(model("l").position.equals(poses[0])).toBe(true);
    expect(model("a").position.equals(poses[1])).toBe(true);
  },
);
add(
  "External-display player",
  "DPR changes during travel preserve cached pose without resizing CSS dimensions",
  "Moving3D piece sampled at90ms on320px board",
  ["Change DPR to1.25", "Resize observer", "Repeat same DPR", "Inspect label"],
  "Pixel ratio changes once, size never resets, and life remains pre-arrival",
  () => {
    const { b, h } = setup("3d");
    const s = movingState();
    b.render(s, empty, null);
    commit(b, s, move);
    advance(90);
    const pos = model("m").position.clone();
    gpu.ratio.mockClear();
    gpu.size.mockClear();
    vi.stubGlobal("devicePixelRatio", 1.25);
    resizes[0].fn();
    resizes[0].fn();
    expect(gpu.ratio).toHaveBeenCalledExactlyOnceWith(1.25);
    expect(gpu.size).not.toHaveBeenCalled();
    expect(model("m").position.equals(pos)).toBe(true);
    expect(life(h, "m").textContent).toBe("3");
  },
);
add(
  "Battery-conscious mobile player",
  "Change quality and width together during capture with one submission",
  "Capture halfway through victim fade",
  [
    "Sample330ms",
    "Enable low quality and resize196",
    "Check surviving and victim poses",
  ],
  "One renderer submission, one ratio change, one resize, and victim opacity is retained",
  () => {
    const { b, h } = setup("3d");
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, move);
    advance(330);
    const opacity = life(h, "v").style.opacity;
    gpu.render.mockClear();
    gpu.size.mockClear();
    gpu.ratio.mockClear();
    document.body.className = "low-quality";
    width(h, 196);
    expect(gpu.render).toHaveBeenCalledOnce();
    expect(gpu.size).toHaveBeenCalledExactlyOnceWith(196, 196, false);
    expect(gpu.ratio).toHaveBeenCalledExactlyOnceWith(1);
    expect(life(h, "v").style.opacity).toBe(opacity);
  },
);
add(
  "Small-screen inspecting player",
  "Cached label updates target fresh nodes after multiple resize rebuilds",
  "Old projected labels are retained as detached references",
  ["Move", "Sample100ms", "Resize280 then400", "Sample300ms"],
  "Detached label remains unchanged while latest live label reaches new lifetime",
  () => {
    const { b, h } = setup("3d");
    const s = movingState();
    b.render(s, empty, null);
    commit(b, s, move);
    advance(100);
    const detached = life(h, "m");
    width(h, 280);
    width(h, 400);
    const current = life(h, "m");
    const scan = vi.spyOn(
      h.querySelector(".overlay-labels")!,
      "querySelectorAll",
    );
    advance(300);
    expect(detached.isConnected).toBe(false);
    expect(detached.textContent).toBe("3");
    expect(current.textContent).toBe("2");
    expect(scan).not.toHaveBeenCalled();
  },
);
add(
  "Returning 3D player",
  "Inspect an already-faded victim without resurrecting its rebuilt labels",
  "Capture is sampled after victim disappearance but before cue cleanup",
  ["Sample400ms", "Render selected mover", "Resize260", "Sample450ms"],
  "Each regenerated victim life and role badge stays transparent and victim model hidden",
  () => {
    const { b, h } = setup("3d");
    const s = capture();
    b.render(s, empty, null);
    const n = commit(b, s, move);
    advance(400);
    b.render(n, { pieceId: "m", candidate: null }, null);
    width(h, 260);
    advance(450);
    expect(life(h, "v").style.opacity).toBe("0");
    expect(
      h.querySelector<HTMLElement>('[data-mark-for="v"]')!.style.opacity,
    ).toBe("0");
    expect(model("v").visible).toBe(false);
  },
);
add(
  "Mobile collapsed-panel player",
  "Recover from zero-width host during active entrance",
  "Newborn animation is sampled while host collapses",
  ["Summon", "Sample130ms", "Resize0", "Resize320"],
  "Drawing buffer clamps to1 then restores320, projected labels stay finite and pose stays sampled",
  () => {
    const { b, h } = setup("3d");
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    advance(130);
    const scale = model("white-0-9").scale.clone();
    gpu.size.mockClear();
    width(h, 0);
    width(h, 320);
    expect(gpu.size.mock.calls.map((c) => c[0])).toEqual([1, 320]);
    expect(model("white-0-9").scale.equals(scale)).toBe(true);
    for (const el of h.querySelectorAll<HTMLElement>(
      ".projected-life, [data-effect]",
    ))
      expect(
        [parseFloat(el.style.left), parseFloat(el.style.top)].every(
          Number.isFinite,
        ),
      ).toBe(true);
  },
);
add(
  "Long-session strategist",
  "Repeated nonvisual passes require no timers while3D lifetimes update",
  "Twenty-five valid new sessions each contain one five-life piece",
  [
    "Render fresh session",
    "Execute four legal non-expiring passes",
    "Repeat twenty-five sessions and inspect scheduling",
  ],
  "Each pass submits once without RAF or watchdog; every session ends with three life because only its own two turns decrement it",
  () => {
    const { b, h } = setup("3d");
    for (let session = 0; session < 25; session++) {
      let s: GameState = state(piece("m", 9, 5));
      b.render(s, empty, null);
      for (let turn = 0; turn < 4; turn++) {
        const calls = gpu.render.mock.calls.length;
        s = commit(b, s, { type: "pass" });
        expect(gpu.render).toHaveBeenCalledTimes(calls + 1);
        expect(frames.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      }
      expect(life(h, "m").textContent).toBe("3");
    }
    expect(gpu.render).toHaveBeenCalledTimes(125);
  },
);
add(
  "Long-session mixed-role player",
  "Retire reused IDs across role changes and expired captures exactly once",
  "Twelve sessions reuse ID m with alternating carver and Link snapshots",
  [
    "Start last-life capture",
    "Track all model resources",
    "Settle",
    "Render same ID as Link",
    "Reset",
  ],
  "Every retired geometry/material emits one disposal and active model population stays bounded",
  () => {
    const { b } = setup("3d");
    for (let i = 0; i < 12; i++) {
      const s = capture(1);
      b.render(s, empty, null);
      commit(b, s, move);
      const watched = [...resources(model("m")), ...resources(model("v"))].map(
        (r) => {
          const f = vi.fn();
          r.addEventListener("dispose", f);
          return f;
        },
      );
      advance(now + 600);
      watched.forEach((f) => expect(f).toHaveBeenCalledOnce());
      b.render(state(piece("m", 24, 2, "white", "link")), empty, null);
      expect(scene().getObjectByName("piece:m")!.userData.identity).toBe(
        "link:white",
      );
      expect(scene().getObjectByName("piece:v")).toBeUndefined();
      b.render(createGame(), empty, null);
    }
  },
);
add(
  "Mobile multi-session player",
  "Recreate3D boards after mid-motion disposal without observer growth",
  "Twelve distinct boards alternate move and summon teardown",
  [
    "Create board",
    "Start motion",
    "Dispose mid-frame",
    "Invoke saved observer",
    "Repeat",
  ],
  "Each resize observer disconnects once, renderer disposes once per board, listeners and work return to zero",
  () => {
    for (let i = 0; i < 12; i++) {
      const x = setup("3d");
      const s = i % 2 ? movingState() : createGame();
      x.b.render(s, empty, null);
      commit(x.b, s, i % 2 ? move : summon);
      advance(now + 100);
      x.dispose();
      const calls = gpu.render.mock.calls.length;
      resizes[i].fn();
      expect(gpu.render).toHaveBeenCalledTimes(calls);
      expect(resizes[i].disconnect).toHaveBeenCalledOnce();
      expect(preference.listeners.size).toBe(0);
      expect(frames.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(gpu.dispose).toHaveBeenCalledTimes(12);
  },
);
add(
  "Motion-sensitive preview user",
  "Cancel a reduced cue before rendering an unrelated summon proposal",
  "Static capture cue has pending watchdog",
  ["Commit reduced capture", "Cancel", "Render summon proposal on new state"],
  "Only proposal ghost remains and old capture watchdog cannot remove it",
  () => {
    preference.matches = true;
    const { b, h } = setup("3d");
    const n = commit(b, capture(), move);
    b.cancelMotion!();
    const proposal: Action = {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: 39,
    };
    b.render(n, { pieceId: null, candidate: proposal }, null);
    vi.runAllTimers();
    expect(h.querySelectorAll(".projected-ghost")).toHaveLength(1);
    clean(h);
  },
);
add(
  "Small-screen long-session player",
  "Resize at every capture-expiry boundary without double resource retirement",
  "One-life capturing mover and victim both depart",
  ["Sample279280330380460540580ms", "Resize after each sample", "Dispose"],
  "Labels never exceed four nodes; both models retire once and only two cores remain",
  () => {
    const { b, h } = setup("3d");
    const s = capture(1);
    b.render(s, empty, null);
    commit(b, s, move);
    const watch = [...resources(model("m")), ...resources(model("v"))].map(
      (r) => {
        const f = vi.fn();
        r.addEventListener("dispose", f);
        return f;
      },
    );
    for (const [i, t] of [279, 280, 330, 380, 460, 540, 580].entries()) {
      advance(t);
      width(h, 250 + i);
      expect(
        h.querySelectorAll(".projected-life, .projected-mark").length,
      ).toBeLessThanOrEqual(4);
    }
    watch.forEach((f) => expect(f).toHaveBeenCalledOnce());
    expect(scene().getObjectByName("piece:m")).toBeUndefined();
    expect(scene().getObjectByName("piece:v")).toBeUndefined();
    clean(h);
  },
);
add(
  "Keyboard mobile player",
  "Keep focused3D destination stable across DPR size and selection changes",
  "Focused destination belongs to moving piece",
  [
    "Move",
    "Focus18",
    "Change DPR and width",
    "Select moved piece",
    "UseArrowLeft",
  ],
  "Focus reaches17 with one tab stop and scene retains sampled moving pose",
  () => {
    const { b, h } = setup("3d");
    const s = movingState();
    b.render(s, empty, null);
    const n = commit(b, s, move);
    advance(90);
    sq(h, 18).focus();
    const pose = model("m").position.clone();
    vi.stubGlobal("devicePixelRatio", 1);
    width(h, 240);
    b.render(n, { pieceId: "m", candidate: null }, null);
    sq(h, 18).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(document.activeElement).toBe(sq(h, 17));
    expect(h.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
    expect(model("m").position.equals(pose)).toBe(true);
  },
);

// M035–M050: cross-player scheduling, reentrant adapters, and preference recovery.
add(
  "Fast local-match player",
  "Replace a plan reentrantly inside its frame-zero adapter",
  "Adapter receives first move plan and immediately starts opponent summon",
  ["Install one-shot nested update", "Commit move", "Inspect current schedule"],
  "Only successor summon cue survives with oneRAF and one watchdog",
  () => {
    let p: ReturnType<typeof createMotionPlayer>;
    let nested = false;
    const first = result(movingState(), move);
    const second = result(first.state, {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: 39,
    });
    const callback = vi.fn((plan) => {
      if (plan && !nested) {
        nested = true;
        p.update(second.state, { before: first.state, events: second.events });
      }
    });
    const x = player(callback);
    p = x.p;
    enter(p);
    expect(x.h.querySelectorAll('[data-effect="summon"]')).toHaveLength(1);
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Closing mid-frame player",
  "Dispose reentrantly from a nonzero animation adapter",
  "A live frame at100ms disposes its own player",
  [
    "Start move",
    "Dispose from sampled callback",
    "Invoke captured callback again",
  ],
  "Adapter cannot recreate layer schedule or timeout after disposal",
  () => {
    let p: ReturnType<typeof createMotionPlayer>;
    const callback = vi.fn((plan, t) => {
      if (plan && t > 0) p.dispose();
    });
    const x = player(callback);
    p = x.p;
    enter(p);
    const stale = [...frames.values()][0];
    advance(100);
    const count = callback.mock.calls.length;
    stale(200);
    expect(callback).toHaveBeenCalledTimes(count);
    expect(x.h.children).toHaveLength(0);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
add(
  "Fast opponent player",
  "Start successor state inside a sampled predecessor callback",
  "Move adapter commits a summon while processing100ms frame",
  ["Start move", "Nested update at100ms", "Sample successor at150ms"],
  "Successor elapsed is50ms and only its scheduling survives",
  () => {
    let p: ReturnType<typeof createMotionPlayer>;
    let replaced = false;
    const n = result(movingState(), move);
    const r = result(n.state, {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: 39,
    });
    const callback = vi.fn((plan, t) => {
      if (plan && t === 100 && !replaced) {
        replaced = true;
        p.update(r.state, { before: n.state, events: r.events });
      }
    });
    const x = player(callback);
    p = x.p;
    enter(p);
    advance(100);
    advance(150);
    expect(callback.mock.lastCall?.[1]).toBe(50);
    expect(callback.mock.lastCall?.[0].tracks[0].piece.id).toBe("black-1-39");
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Motion-sensitive returning player",
  "Retired media callback cannot settle a newly mounted independent player",
  "A saved listener from disposed player shares same global preference object",
  [
    "Capture old listener",
    "Dispose old player",
    "Start new player",
    "Invoke retired listener",
  ],
  "New player keeps its layer and currentRAF untouched",
  () => {
    const x = player();
    enter(x.p);
    const stale = [...preference.listeners][0];
    x.p.dispose();
    const next = player();
    enter(next.p, createGame(), summon);
    const layer = next.h.querySelector(".board-effects");
    stale();
    expect(next.h.querySelector(".board-effects")).toBe(layer);
    expect(next.h.querySelector('[data-effect="summon"]')).not.toBeNull();
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Motion-sensitive multi-board player",
  "Global preference cancels both players but only a new action restarts one",
  "Two independent boards are animating",
  [
    "Start move and summon",
    "EnableOS reduction",
    "DisableOS reduction",
    "Start one new action",
  ],
  "Both initial schedules cancel and only one new schedule exists",
  () => {
    const a = player(),
      b = player();
    const n = enter(a.p);
    enter(b.p, createGame(), summon);
    expect(frames.size).toBe(2);
    preference.matches = true;
    [...preference.listeners].forEach((f) => f());
    expect(frames.size).toBe(0);
    preference.matches = false;
    [...preference.listeners].forEach((f) => f());
    const r = result(n, {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: 39,
    });
    a.p.update(r.state, { before: n, events: r.events });
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(b.h.querySelectorAll("[data-effect]")).toHaveLength(0);
  },
);
add(
  "Long-session multi-board player",
  "Dispose one independent board without cancelling the other timeline",
  "Two players own separateRAF and watchdog handles",
  ["Start two players", "Dispose first", "Sample second"],
  "Second receives140ms sample with one listener oneRAF and one timer",
  () => {
    const a = player(),
      b = player();
    enter(a.p);
    enter(b.p, createGame(), summon);
    a.p.dispose();
    advance(140);
    expect(b.callback.mock.lastCall?.[1]).toBe(140);
    expect(preference.listeners.size).toBe(1);
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Throttled mobile multi-board player",
  "Earlier watchdog settlement cannot cancel a later independent entrance",
  "Second player starts200ms after first with no RAF delivery",
  ["Start first", "Advance timer200ms", "Start second", "Advance430ms"],
  "First times out while second still owns its cueRAF and later deadline",
  () => {
    const a = player(),
      b = player();
    enter(a.p);
    vi.advanceTimersByTime(200);
    now = 200;
    enter(b.p, createGame(), summon);
    vi.advanceTimersByTime(430);
    expect(a.h.querySelectorAll("[data-effect]")).toHaveLength(0);
    expect(b.h.querySelector('[data-effect="summon"]')).not.toBeNull();
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Battery-conscious player",
  "Unrelated body-class mutations do not interrupt active motion",
  "MutationObserver sees theme and quality preferences without no-motion",
  [
    "Start motion",
    "Add low-quality",
    "Await observer",
    "Add unrelated theme",
    "Sample",
  ],
  "Same motion generation continues without null settlement",
  async () => {
    const x = player();
    enter(x.p);
    x.callback.mockClear();
    document.body.className = "low-quality";
    await Promise.resolve();
    document.body.classList.add("theme-dark");
    await Promise.resolve();
    expect(x.callback).not.toHaveBeenCalled();
    advance(140);
    expect(x.callback.mock.lastCall?.[1]).toBe(140);
    expect(frames.size).toBe(1);
  },
);
add(
  "Mobile background returner",
  "Visibility churn allows a genuinely new action but never replays the old one",
  "Old move is cancelled by hiding",
  ["Hide/show three times", "Render same result", "Commit next summon"],
  "Old frame stays stale and new entrance starts at elapsed zero",
  () => {
    const x = player();
    const n = enter(x.p);
    const stale = [...frames.values()][0];
    for (let i = 0; i < 3; i++) {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    }
    x.p.update(n);
    expect(frames.size).toBe(0);
    const r = result(n, {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: 39,
    });
    x.p.update(r.state, { before: n, events: r.events });
    const calls = x.callback.mock.calls.length;
    stale(500);
    expect(x.callback).toHaveBeenCalledTimes(calls);
    expect(x.callback.mock.lastCall?.[1]).toBe(0);
    expect(frames.size).toBe(1);
  },
);
add(
  "Reduced-capability returning player",
  "RestoreRAF support for a later action after static fallback",
  "First action lacksrequestAnimationFrame",
  ["RemoveRAF", "Summon statically", "RestoreRAF", "Commit opponent summon"],
  "Successor switches out of reduced class and has exactly one callback chain",
  () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const x = player();
    const n = enter(x.p, createGame(), summon);
    expect(frames.size).toBe(0);
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
      frames.set(++serial, f);
      return serial;
    });
    const r = result(n, {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: 39,
    });
    x.p.update(r.state, { before: n, events: r.events });
    expect(
      x.h.querySelector(".board-effects")!.classList.contains("reduced"),
    ).toBe(false);
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Motion-sensitive strategist",
  "OS preference reversal starts next swap with original causal delays",
  "A reduced summon is followed by normal two-unit exchange in another snapshot",
  [
    "Reduced entrance",
    "Turn preference off",
    "Load swap prestate",
    "Commit swap",
  ],
  "Both cues restore280ms delay and plan resumes two animated tracks",
  () => {
    preference.matches = true;
    const x = player();
    enter(x.p, createGame(), summon);
    preference.matches = false;
    [...preference.listeners].forEach((f) => f());
    enter(x.p, swapping(), swap);
    expect(
      [...x.h.querySelectorAll<HTMLElement>('[data-effect="swap"]')].map((e) =>
        e.style.getPropertyValue("--cue-delay"),
      ),
    ).toEqual(["280ms", "280ms"]);
    expect(x.callback.mock.lastCall?.[0].tracks).toHaveLength(2);
    expect(frames.size).toBe(1);
  },
);
add(
  "Fast restarting player",
  "A prior watchdog deadline cannot erase a successor after empty-pass optimization",
  "Visible move is replaced by empty pass then later summon",
  [
    "Move",
    "Advance timer200ms",
    "Empty pass",
    "Summon",
    "Cross original630ms deadline",
  ],
  "Original schedule is gone; newer summon survives until its own deadline",
  () => {
    const x = player();
    const moved = enter(x.p);
    vi.advanceTimersByTime(200);
    now = 200;
    const passed = result(moved, { type: "pass" });
    x.p.update(passed.state, { before: moved, events: passed.events });
    expect(vi.getTimerCount()).toBe(0);
    const summoned = result(passed.state, {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: 8,
    });
    x.p.update(summoned.state, {
      before: passed.state,
      events: summoned.events,
    });
    vi.advanceTimersByTime(430);
    expect(x.h.querySelector('[data-effect="summon"]')).not.toBeNull();
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
add(
  "Screen-reader novice",
  "First-frame hidden duplicate never changes authoritative control labels",
  "Capture-expiry has transient visual pieces but zero authoritative units",
  [
    "Commit last-life capture in2D",
    "Read origin and landing labels before firstRAF",
    "Sample capture then expiry",
  ],
  "Controls describe final empty squares throughout while effect layer staysaria-hidden",
  () => {
    const { b, h } = setup();
    const s = capture(1);
    b.render(s, empty, null);
    commit(b, s, move);
    const labels = [
      sq(h, 9).getAttribute("aria-label"),
      sq(h, 18).getAttribute("aria-label"),
    ];
    expect(labels.every((s) => s!.includes("空き"))).toBe(true);
    advance(330);
    advance(450);
    expect([
      sq(h, 9).getAttribute("aria-label"),
      sq(h, 18).getAttribute("aria-label"),
    ]).toEqual(labels);
    expect(h.querySelector(".board-effects")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  },
);
add(
  "Long-session keyboard player",
  "Fast snapshot corrections refresh3D life cache without retaining retired nodes",
  "Twenty grain-corrected snapshots each rebuild labels",
  [
    "Render one mover",
    "Correct grain twenty times",
    "Start move",
    "Sample arrival",
  ],
  "Only current label updates, old detached labels stay at original life, and live label count remains two",
  () => {
    const { b, h } = setup("3d");
    let s: GameState = movingState();
    b.render(s, empty, null);
    const retired: HTMLElement[] = [];
    for (let i = 0; i < 20; i++) {
      retired.push(life(h, "m"));
      s = { ...s, grain: { ...s.grain, white: s.grain.white + 1 } };
      b.render(s, empty, null);
    }
    commit(b, s, move);
    advance(300);
    expect(
      retired.every((el) => !el.isConnected && el.textContent === "3"),
    ).toBe(true);
    expect(life(h, "m").textContent).toBe("2");
    expect(h.querySelectorAll(".projected-life, .projected-mark")).toHaveLength(
      2,
    );
  },
);
add(
  "Long-session mixed-view player",
  "Repeated2D3D handover rejects every retired frame and resize callback",
  "Twelve mode switches reuse a single host with active capture each time",
  [
    "Alternate2D and3D",
    "Capture and save pending callbacks",
    "Dispose",
    "Mount next owner",
    "Invoke all retired callbacks",
  ],
  "One current board has49 controls; old work cannot change population and end-of-run listeners/resources clear",
  () => {
    const h = host();
    const retired: FrameRequestCallback[] = [];
    let current: ReturnType<typeof setup> | undefined;
    for (let i = 0; i < 12; i++) {
      current?.dispose();
      current = setup(i % 2 ? "3d" : "2d", h);
      const s = capture();
      current.b.render(s, empty, null);
      commit(current.b, s, move);
      retired.forEach((f) => f(now + 140));
      expect(h.querySelectorAll("[data-square]")).toHaveLength(49);
      expect(preference.listeners.size).toBe(1);
      expect(frames.size).toBe(1);
      retired.push(...frames.values());
      advance(now + 70);
    }
    current!.dispose();
    retired.forEach((f) => f(now + 1000));
    resizes.forEach((r) => r.fn());
    expect(h.children).toHaveLength(0);
    expect(preference.listeners.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(gpu.dispose).toHaveBeenCalledTimes(6);
  },
);
add(
  "Small-screen pointer player",
  "Ray picking stays aligned after DPR and width changes during motion",
  "Real CPU raycaster uses the resized canvas rectangle during a move",
  [
    "Move and sample140ms",
    "Resize from320to196 and changeDPR",
    "Project landing square to resized client coordinates",
    "Dispatch pointerup",
  ],
  "Tile18 is delivered exactly once despite in-flight piece and resized labels",
  () => {
    const { b, h, click } = setup("3d");
    const s = movingState();
    b.render(s, empty, null);
    commit(b, s, move);
    advance(140);
    vi.stubGlobal("devicePixelRatio", 1.25);
    width(h, 196);
    const canvas = h.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 23,
      y: 47,
      left: 23,
      top: 47,
      right: 219,
      bottom: 243,
      width: 196,
      height: 196,
      toJSON() {
        return {};
      },
    });
    const v = new THREE.Vector3(1, 0.05, 1).project(gpu.camera as THREE.Camera);
    canvas.dispatchEvent(
      new MouseEvent("pointerup", {
        clientX: 23 + (v.x + 1) * 98,
        clientY: 47 + (1 - v.y) * 98,
      }),
    );
    expect(click).toHaveBeenCalledExactlyOnceWith(18);
    expect(gpu.size).toHaveBeenLastCalledWith(196, 196, false);
  },
);
if (rows.length !== 50)
  throw Error(`Expected exactly50 scenarios, got${rows.length}`);
