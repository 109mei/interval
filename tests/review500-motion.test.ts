// @vitest-environment jsdom
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { createGame, applyAction, previewAction } from "../src/game/engine";
import {
  motionPlan,
  recoverTransition,
  trackPose,
  visibleCoreSides,
} from "../src/render/motion";
import { createMotionPlayer } from "../src/render/motion-player";
import { createBoard2D } from "../src/render/board2d";
import { createBoard3D } from "../src/render/board3d";
import { createAdaptiveBoard } from "../src/render/adaptive";
import {
  createPieceModel,
  createCoreModel,
  disposeObject,
} from "../src/render/pieces";
import type {
  Action,
  GameState,
  Kind,
  Piece,
  Selection,
} from "../src/game/types";
import type { BoardView } from "../src/render/board-view";

// These 140 scenarios execute local DOM, production timing, and real Three CPU
// math/geometry. Only the GPU renderer is replaced; no GPU/pixel/FPS claim follows.
const gpu = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  pixel: vi.fn(),
  size: vi.fn(),
  scene: null as unknown,
  camera: null as unknown,
  shadows: {} as Record<string, unknown>,
  fail: false,
}));
vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      shadowMap: Record<string, unknown> = {};
      constructor() {
        if (gpu.fail) throw Error("Simulated unavailable GPU");
        gpu.shadows = this.shadowMap;
      }
      setPixelRatio(v: number) {
        gpu.pixel(v);
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
const ledgerPath = "docs/review500/motion-cases.json";
const oldLedger = existsSync(ledgerPath)
  ? (JSON.parse(readFileSync(ledgerPath, "utf8")) as Record<string, unknown>[])
  : [];
const ledger: Record<string, unknown>[] = [];
let now = 0,
  serial = 0,
  hidden = false;
const frames = new Map<number, FrameRequestCallback>();
const cleanup: (() => void)[] = [];
let preference = {
  matches: false,
  listeners: new Set<() => void>(),
  addEventListener(_s: string, f: () => void) {
    this.listeners.add(f);
  },
  removeEventListener(_s: string, f: () => void) {
    this.listeners.delete(f);
  },
};
const resizes: (() => void)[] = [];
const empty: Selection = { pieceId: null, candidate: null };
const css = readFileSync("src/ui/styles.css", "utf8");
function advance(ms: number) {
  now = ms;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((f) => f(ms));
}
function host() {
  const h = document.createElement("div");
  document.body.append(h);
  Object.defineProperty(h, "clientWidth", { value: 350, configurable: true });
  return h;
}
function setup(mode: "2d" | "3d" = "2d") {
  const h = host(),
    click = vi.fn(),
    failure = vi.fn();
  const b =
    mode === "2d" ? createBoard2D(h, click) : createBoard3D(h, click, failure);
  cleanup.push(() => b.dispose());
  return { h, b, click, failure };
}
function p(
  id: string,
  kind: Kind,
  square: number,
  remaining = 3,
  side: Piece["side"] = "white",
): Piece {
  return { id, kind, square, remaining, side, summonedPly: -1 };
}
function state(...pieces: Piece[]) {
  const s = createGame();
  s.pieces = pieces;
  return s;
}
function result(s: GameState, a: Action) {
  const r = applyAction(s, a);
  if (!r.ok) throw Error(`Invalid fixture: ${r.error}; ${JSON.stringify(a)}`);
  return r;
}
function commit(b: BoardView, s: GameState, a: Action) {
  const r = result(s, a);
  b.render(r.state, empty, null, { before: s, events: r.events });
  return r;
}
function plan(s: GameState, a: Action) {
  const r = result(s, a);
  return { r, plan: motionPlan(r.state, { before: s, events: r.events }) };
}
const move = (life = 3) => state(p("m", "carver", 9, life));
const capture = (life = 3) =>
  state(p("m", "carver", 9, life), p("v", "carver", 18, 3, "black"));
const moveAction: Action = { type: "move", pieceId: "m", to: 18 };
const summon: Action = { type: "summon", kind: "carver", duration: 3, to: 9 };
const swapped = (a = 3, b = 3) =>
  state(p("link", "link", 23, a), p("wall", "bastion", 24, b));
const swap: Action = { type: "swap", pieceId: "link", allyId: "wall" };
const scene = () => gpu.scene as THREE.Scene;
const model = (id: string) =>
  scene().getObjectByName(`piece:${id}`) as THREE.Group | undefined;
const life = (h: HTMLElement, id: string) =>
  h.querySelector<HTMLElement>(`[data-life-for="${id}"]`)!;
const sq = (h: HTMLElement, n: number) =>
  h.querySelector<HTMLButtonElement>(`[data-square="${n}"]`)!;
const effects = (h: HTMLElement) => h.querySelectorAll("[data-effect]");
const moving = (h: HTMLElement, id: string) =>
  h.querySelector<HTMLElement>(`[data-moving-piece="${id}"]`)!;
function styles() {
  const el = document.createElement("style");
  el.textContent = css;
  document.head.append(el);
  cleanup.push(() => el.remove());
}
function finite(values: number[]) {
  expect(values.every(Number.isFinite)).toBe(true);
}
function clean(h: HTMLElement) {
  expect(
    h.querySelectorAll("[data-effect], [data-moving-piece], .motion-hidden"),
  ).toHaveLength(0);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
}
function add(
  category: string,
  name: string,
  expected: string,
  run: () => unknown | Promise<unknown>,
) {
  const id = `M${String(ledger.length + 1).padStart(3, "0")}`;
  const previous = oldLedger.find((row) => row.id === id);
  const entry: Record<string, unknown> = {
    id,
    category,
    persona: category.includes("reduced")
      ? "Motion-sensitive player"
      : category.includes("input")
        ? "Keyboard and pointer player"
        : category.includes("geometry")
          ? "Small-screen 3D player"
          : "Returning local-game player",
    sequence: [
      `Prepare ${category} fixture`,
      name,
      "Assert the independently specified visible state and resource boundaries",
    ],
    expected,
    baselineObservation: previous?.baselineObservation ?? "not executed",
    finding: previous?.finding ?? "not executed",
    fixOrNoChange: previous?.fixOrNoChange ?? "Production read-only",
    retest: "not executed",
    limitations:
      "Local jsdom and real Three.js CPU math/geometry only; mocked WebGLRenderer. GPU screenshots, actual GPU resource allocation, frame rate, physical touch, and screen-reader speech are unverified.",
  };
  ledger.push(entry);
  it(`${id} ${name}`, async () => {
    try {
      await run();
      if (entry.baselineObservation === "not executed")
        entry.baselineObservation =
          "PASS: specified assertions satisfied on first execution";
      entry.retest = "PASS";
      if (entry.finding === "not executed")
        entry.finding = "No defect observed in this bounded scenario";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (entry.baselineObservation === "not executed")
        entry.baselineObservation = `FAIL: ${message}`;
      entry.finding = `FAIL: ${message}`;
      entry.retest = "FAIL";
      throw error;
    }
  });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  now = 0;
  serial = 0;
  hidden = false;
  frames.clear();
  resizes.length = 0;
  gpu.render.mockReset();
  gpu.dispose.mockReset();
  gpu.pixel.mockReset();
  gpu.size.mockReset();
  gpu.scene = null;
  gpu.camera = null;
  gpu.fail = false;
  document.body.replaceChildren();
  document.body.className = "";
  preference = { ...preference, matches: false, listeners: new Set() };
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
      observe() {}
      disconnect = vi.fn();
      constructor(f: () => void) {
        resizes.push(f);
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Network forbidden in motion review");
    }),
  );
});
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
afterAll(() => {
  writeFileSync(
    join(tmpdir(), "interval-review500-motion-results.json"),
    JSON.stringify(ledger, null, 2) + "\n",
  );
});

// M001–M025: causal plans, independent destinations, and snapshot recovery.
add(
  "causal.summon",
  "Newborn has a stationary entrance and retains purchased lifetime",
  "One entrance at square 9, lifetime 3, opacity rises from zero to one",
  () => {
    const { plan: t } = plan(createGame(), summon);
    expect(t.tracks).toHaveLength(1);
    const a = t.tracks[0];
    expect(a.path).toEqual([9]);
    expect(a.remaining).toBe(3);
    expect(a.enter).toBe(true);
    expect(trackPose(a, 0).opacity).toBe(0);
    expect(trackPose(a, 260).opacity).toBe(1);
  },
);
add(
  "causal.summon",
  "One-life newborn is exempt from same-turn expiry",
  "No expiry cue and a live one-turn newborn at settlement",
  () => {
    const { r, plan: t } = plan(createGame(), {
      ...summon,
      duration: 1,
    } as Action);
    expect(r.state.pieces[0].remaining).toBe(1);
    expect(t.cues.map((c) => c.kind)).toEqual(["summon"]);
    expect(t.tracks[0].leave).toBeNull();
  },
);
add(
  "causal.summon",
  "Summon alongside an expiring ally keeps separate identities",
  "Newborn enters while old ally expires at its old square",
  () => {
    const s = state(p("old", "bastion", 10, 1));
    const { plan: t } = plan(s, summon);
    expect(t.tracks.map((v) => [v.piece.id, v.enter, v.leave])).toEqual([
      ["white-0-9", true, null],
      ["old", false, "expire"],
    ]);
    expect(t.cues.map((c) => [c.kind, c.square])).toEqual([
      ["summon", 9],
      ["expire", 10],
    ]);
  },
);
add(
  "causal.move",
  "Carver follows its two-segment bend instead of a diagonal shortcut",
  "At midpoint the mover is on square 10, then ends at 17",
  () => {
    const { plan: t } = plan(move(), { type: "move", pieceId: "m", to: 17 });
    expect(t.tracks[0].path).toEqual([9, 10, 17]);
    expect(trackPose(t.tracks[0], 140)).toMatchObject({ x: 3, y: 1 });
  },
);
add(
  "causal.move",
  "Carver rejects the blocked first bend before the wall expires",
  "The legal route goes through 30 before 31",
  () => {
    const { plan: t } = plan(
      state(p("m", "carver", 23), p("wall", "bastion", 24, 1)),
      { type: "move", pieceId: "m", to: 31 },
    );
    expect(t.tracks.find((t) => t.piece.id === "m")!.path).toEqual([
      23, 30, 31,
    ]);
  },
);
add(
  "causal.move",
  "Long Carver path has equal-duration ordered legs",
  "Three legs visit each legal intermediate square in order",
  () => {
    const { plan: t } = plan(state(p("m", "carver", 23)), {
      type: "move",
      pieceId: "m",
      to: 38,
    });
    const a = t.tracks[0];
    expect(a.path).toEqual([23, 24, 31, 38]);
    expect(trackPose(a, 280 / 3).x).toBeCloseTo(3);
    expect(trackPose(a, 560 / 3).y).toBeCloseTo(4);
  },
);
add(
  "causal.move",
  "Travel samples clamp before start and after arrival",
  "Coordinates stay at source for negative time and destination after arrival",
  () => {
    const { plan: t } = plan(move(), moveAction);
    expect([
      trackPose(t.tracks[0], -50).x,
      trackPose(t.tracks[0], -50).y,
    ]).toEqual([2, 1]);
    expect([
      trackPose(t.tracks[0], 999).x,
      trackPose(t.tracks[0], 999).y,
    ]).toEqual([4, 2]);
  },
);
add(
  "causal.leaper",
  "Leaper clears its midpoint pad without occupying it",
  "A direct endpoint path with positive arc height at midpoint",
  () => {
    const { plan: t } = plan(
      state(p("m", "leaper", 23), p("pad", "bastion", 24)),
      { type: "move", pieceId: "m", to: 25 },
    );
    const a = t.tracks[0];
    expect(a.path).toEqual([23, 25]);
    expect(trackPose(a, 140).lift).toBeCloseTo(0.7);
    expect(trackPose(a, 280).lift).toBeCloseTo(0);
  },
);
add(
  "causal.leaper",
  "Diagonal Leaper arc retains correct row and column",
  "Midpoint is at 24 while ground landing is 32",
  () => {
    const { plan: t } = plan(
      state(p("m", "leaper", 16), p("pad", "bastion", 24)),
      { type: "move", pieceId: "m", to: 32 },
    );
    expect(trackPose(t.tracks[0], 140)).toMatchObject({ x: 3, y: 3 });
    expect(trackPose(t.tracks[0], 280)).toMatchObject({ x: 4, y: 4 });
  },
);
add(
  "causal.capture",
  "Capture reward waits until mover arrival",
  "Victim remains opaque before 280ms and capture cue starts at 280ms",
  () => {
    const { plan: t } = plan(capture(), moveAction);
    const v = t.tracks.find((t) => t.piece.id === "v")!;
    expect(trackPose(v, 279).opacity).toBe(1);
    expect(t.cues.find((c) => c.kind === "capture")).toMatchObject({
      start: 280,
      square: 18,
      label: "+9糧",
    });
  },
);
add(
  "causal.capture",
  "Captured victim fades over the impact interval",
  "Victim opacity is one-half at 330ms and zero by 380ms",
  () => {
    const { plan: t } = plan(capture(), moveAction);
    const v = t.tracks.find((t) => t.piece.id === "v")!;
    expect(trackPose(v, 330).opacity).toBeCloseTo(0.5);
    expect(trackPose(v, 380).opacity).toBe(0);
  },
);
add(
  "causal.capture",
  "Capturing a five-turn Leaper uses its full purchase value",
  "Capture cue reports ten grain without decrementing the opponent",
  () => {
    const s = state(p("m", "carver", 9), p("v", "leaper", 18, 5, "black"));
    const { plan: t } = plan(s, moveAction);
    expect(t.cues[0].label).toBe("+10糧");
    expect(t.tracks.find((t) => t.piece.id === "v")!.piece.remaining).toBe(5);
  },
);
add(
  "causal.expiry",
  "Last-life move expires at its destination after travel",
  "Expiry begins at 280ms on square 18 and completes at 440ms",
  () => {
    const { plan: t } = plan(move(1), moveAction);
    const a = t.tracks[0];
    expect(a).toMatchObject({ leave: "expire", start: 280, end: 440 });
    expect(t.cues[0].square).toBe(18);
    expect(trackPose(a, 439).opacity).toBeGreaterThan(0);
    expect(trackPose(a, 440).opacity).toBe(0);
  },
);
add(
  "causal.expiry",
  "Last-life capture sequences impact before mover expiry",
  "Victim ends at 380ms, then mover expires through 540ms",
  () => {
    const { plan: t } = plan(capture(1), moveAction);
    const m = t.tracks.find((t) => t.piece.id === "m")!,
      v = t.tracks.find((t) => t.piece.id === "v")!;
    expect(m.start).toBe(v.end);
    expect(m.end).toBe(540);
    expect(t.cues.map((c) => [c.kind, c.start])).toEqual([
      ["capture", 280],
      ["expire", 380],
    ]);
  },
);
add(
  "causal.expiry",
  "Stationary expiries wait for another mover to arrive",
  "Both stationary allies remain fully opaque during travel",
  () => {
    const s = state(
      p("m", "carver", 9),
      p("a", "bastion", 20, 1),
      p("b", "link", 21, 1),
    );
    const { plan: t } = plan(s, moveAction);
    for (const id of ["a", "b"]) {
      const a = t.tracks.find((t) => t.piece.id === id)!;
      expect(a.arrive).toBe(0);
      expect(a.start).toBe(280);
      expect(trackPose(a, 200).opacity).toBe(1);
    }
  },
);
add(
  "causal.swap",
  "Surviving swap uses opposite destinations with simultaneous arrivals",
  "Both tracks arrive at 280ms with reciprocal square paths",
  () => {
    const { plan: t } = plan(swapped(), swap);
    expect(t.tracks.map((a) => [a.path, a.arrive])).toEqual([
      [[23, 24], 280],
      [[24, 23], 280],
    ]);
    expect(t.cues.map((c) => [c.kind, c.square, c.start])).toEqual([
      ["swap", 23, 280],
      ["swap", 24, 280],
    ]);
  },
);
add(
  "causal.swap",
  "Expiring Link disappears only after reaching its ally square",
  "Link expiry is at 24 while the ally survives at 23",
  () => {
    const { r, plan: t } = plan(swapped(1, 3), swap);
    expect(r.state.pieces.map((p) => [p.id, p.square])).toEqual([["wall", 23]]);
    expect(t.cues.find((c) => c.kind === "expire")!.square).toBe(24);
  },
);
add(
  "causal.swap",
  "Expiring swap ally disappears at the Link origin",
  "Ally expiry is at 23 and Link remains at 24",
  () => {
    const { r, plan: t } = plan(swapped(3, 1), swap);
    expect(r.state.pieces.map((p) => [p.id, p.square])).toEqual([["link", 24]]);
    expect(t.cues.find((c) => c.kind === "expire")!.square).toBe(23);
  },
);
add(
  "causal.swap",
  "Double last-life swap carries two expiry cues at exchanged squares",
  "Both disappear without leaving any live piece",
  () => {
    const { r, plan: t } = plan(swapped(1, 1), swap);
    expect(r.state.pieces).toHaveLength(0);
    expect(
      t.cues.filter((c) => c.kind === "expire").map((c) => c.square),
    ).toEqual([24, 23]);
    expect(t.tracks.every((a) => trackPose(a, 440).opacity === 0)).toBe(true);
  },
);
add(
  "causal.pass",
  "Pass expiry has no fabricated movement",
  "Stationary expiry starts immediately with a one-square path",
  () => {
    const { plan: t } = plan(state(p("old", "bastion", 10, 1)), {
      type: "pass",
    });
    expect(t.tracks[0]).toMatchObject({
      path: [10],
      arrive: 0,
      start: 0,
      end: 160,
    });
    expect(t.cues.map((c) => c.kind)).toEqual(["expire"]);
  },
);
add(
  "causal.win",
  "Core capture on ply 200 suppresses ordinary lifetime expiry",
  "Only a win cue; winning one-life mover remains",
  () => {
    const s = state(p("m", "carver", 36, 1));
    s.ply = 199;
    const { r, plan: t } = plan(s, { type: "move", pieceId: "m", to: 45 });
    expect(r.state.pieces[0].remaining).toBe(1);
    expect(t.cues.map((c) => c.kind)).toEqual(["win"]);
    expect(visibleCoreSides(r.state)).toEqual(["white"]);
  },
);
add(
  "causal.draw",
  "Six-pass draw never emits a core capture cue",
  "Both cores stay visible and no win effect is fabricated",
  () => {
    const s = createGame();
    s.consecutivePasses = 5;
    const { r, plan: t } = plan(s, { type: "pass" });
    expect(r.state.outcome).toEqual({ kind: "draw", reason: "passes" });
    expect(t.cues).toHaveLength(0);
    expect(visibleCoreSides(r.state)).toEqual(["white", "black"]);
  },
);
add(
  "causal.recovery",
  "Recoverable surviving move reconstructs its actual path",
  "Exactly one move is recovered without changing snapshots",
  () => {
    const s = move(),
      r = result(s, moveAction),
      before = JSON.stringify([s, r.state]);
    const t = recoverTransition(s, r.state);
    expect(t?.events.find((e) => e.type === "move")?.squares).toEqual([9, 18]);
    expect(JSON.stringify([s, r.state])).toBe(before);
  },
);
add(
  "causal.recovery",
  "Ambiguous expired mover and skipped turns produce no invented animation",
  "Both ambiguous one-life result and multi-ply result return null",
  () => {
    const s = move(1),
      r = result(s, moveAction);
    expect(recoverTransition(s, r.state)).toBeNull();
    expect(recoverTransition(s, { ...r.state, ply: 3 })).toBeNull();
  },
);
add(
  "causal.recovery",
  "Piece ordering does not alter recovered unique swap",
  "Reordered snapshots retain Link and ally event identities",
  () => {
    const s = swapped(),
      r = result(s, swap);
    expect(
      recoverTransition(s, {
        ...r.state,
        pieces: [...r.state.pieces].reverse(),
      })?.events.find((e) => e.type === "swap")?.pieceIds,
    ).toEqual(["link", "wall"]);
  },
);

// M026–M060: 2D DOM, readable authoritative state, and input during motion.
add(
  "2d.summon",
  "Committed summon initially hides only its duplicate authoritative glyph",
  "One moving identity, one hidden duplicate, and two visible cores",
  () => {
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(1);
    expect(h.querySelectorAll(".motion-hidden")).toHaveLength(1);
    expect(h.querySelectorAll(".square .core")).toHaveLength(2);
    expect(moving(h, "white-0-9").style.opacity).toBe("0");
  },
);
add(
  "2d.summon",
  "Settled summon restores the permanent glyph with its exact lifetime",
  "Only one live Carver remains and no frame/timer survives",
  () => {
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    advance(580);
    expect(sq(h, 9).querySelector(".life")!.textContent).toBe("3");
    expect(h.querySelectorAll(".square .piece:not(.core)")).toHaveLength(1);
    clean(h);
  },
);
add(
  "2d.preview",
  "Summon proposal shows a ghost without creating a committed effect",
  "Ghost duration 3 is shown with no motion nodes or scheduled work",
  () => {
    const { b, h } = setup();
    const s = createGame();
    b.render(s, { pieceId: null, candidate: summon }, previewAction(s, summon));
    expect(h.querySelectorAll(".ghost-piece")).toHaveLength(1);
    expect(h.querySelector(".ghost-piece .life")!.textContent).toBe("3");
    clean(h);
  },
);
add(
  "2d.preview",
  "Move preview keeps original piece and route without consuming a lifetime",
  "Source life stays 3, proposal target 18 is marked, and no effects start",
  () => {
    const { b, h } = setup();
    const s = move();
    b.render(
      s,
      { pieceId: "m", candidate: moveAction },
      previewAction(s, moveAction),
    );
    expect(sq(h, 9).querySelector(".life")!.textContent).toBe("3");
    expect(sq(h, 18).classList.contains("candidate")).toBe(true);
    expect(h.querySelectorAll(".route").length).toBeGreaterThan(0);
    clean(h);
  },
);
add(
  "2d.move",
  "Moving Carver follows the legal bend in screen coordinates",
  "At one-third time it is above source at square 16, with source column unchanged",
  () => {
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(280 / 3);
    expect(parseFloat(moving(h, "m").style.left)).toBeCloseTo((2.5 / 7) * 100);
    expect(parseFloat(moving(h, "m").style.top)).toBeCloseTo((4.5 / 7) * 100);
  },
);
add(
  "2d.move",
  "A surviving mover shows old life during travel and new life at arrival",
  "Moving life changes from 3 to 2 precisely at 280ms",
  () => {
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(279);
    expect(moving(h, "m").querySelector(".life")!.textContent).toBe("3");
    advance(280);
    expect(moving(h, "m").querySelector(".life")!.textContent).toBe("2");
  },
);
add(
  "2d.capture",
  "Captured victim retains its life badge through the impact fade",
  "Victim badge says 3 at 330ms while its opacity is one-half",
  () => {
    const { b, h } = setup();
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(330);
    expect(moving(h, "v").querySelector(".life")!.textContent).toBe("3");
    expect(Number(moving(h, "v").style.opacity)).toBeCloseTo(0.5);
  },
);
add(
  "2d.capture",
  "Capture overlay reports reward at the landing square",
  "One +9 grain cue at square 18, delayed until impact",
  () => {
    const { b, h } = setup();
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    const cue = h.querySelector<HTMLElement>('[data-effect="capture"]')!;
    expect(cue.textContent).toBe("+9糧");
    expect(cue.dataset.at).toBe("18");
    expect(cue.style.getPropertyValue("--cue-delay")).toBe("280ms");
  },
);
add(
  "2d.expiry",
  "Last-life capture keeps mover life until capture completes",
  "Mover life stays 1 at 379ms and becomes 0 at 380ms",
  () => {
    const { b, h } = setup();
    const s = capture(1);
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(379);
    expect(moving(h, "m").querySelector(".life")!.textContent).toBe("1");
    advance(380);
    expect(moving(h, "m").querySelector(".life")!.textContent).toBe("0");
    expect(h.querySelectorAll(".square .piece:not(.core)")).toHaveLength(0);
  },
);
add(
  "2d.expiry",
  "Pass expiration fades the stationary piece without an invented trail",
  "Expiry ghost stays at square 10 and is gone at final settlement",
  () => {
    const { b, h } = setup();
    const s = state(p("old", "bastion", 10, 1));
    b.render(s, empty, null);
    commit(b, s, { type: "pass" });
    advance(80);
    expect(parseFloat(moving(h, "old").style.left)).toBeCloseTo(
      (3.5 / 7) * 100,
    );
    expect(Number(moving(h, "old").style.opacity)).toBe(0.5);
    advance(580);
    clean(h);
  },
);
add(
  "2d.swap",
  "Swap creates exactly two moving identities with reciprocal destinations",
  "Both tracks reach the exchanged screen anchors at 280ms",
  () => {
    const { b, h } = setup();
    const s = swapped();
    b.render(s, empty, null);
    commit(b, s, swap);
    advance(280);
    expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(2);
    expect(parseFloat(moving(h, "link").style.left)).toBeCloseTo(
      (3.5 / 7) * 100,
    );
    expect(parseFloat(moving(h, "wall").style.left)).toBeCloseTo(
      (2.5 / 7) * 100,
    );
  },
);
add(
  "2d.swap",
  "Double expiry after swap leaves no stationary or moving duplicates",
  "Both authoritative pieces and all effects are absent after settlement",
  () => {
    const { b, h } = setup();
    const s = swapped(1, 1);
    b.render(s, empty, null);
    commit(b, s, swap);
    advance(580);
    expect(h.querySelectorAll(".square .piece:not(.core)")).toHaveLength(0);
    clean(h);
  },
);
add(
  "2d.win",
  "Losing core ghost persists until the winning mover arrives",
  "Captured core overlay is visible at 279ms and hidden at 280ms",
  () => {
    const { b, h } = setup();
    const s = state(p("m", "carver", 36, 1));
    b.render(s, empty, null);
    commit(b, s, { type: "move", pieceId: "m", to: 45 });
    advance(279);
    expect(
      h.querySelector<HTMLElement>(".moving-piece.core")!.style.visibility,
    ).toBe("visible");
    advance(280);
    expect(
      h.querySelector<HTMLElement>(".moving-piece.core")!.style.visibility,
    ).toBe("hidden");
  },
);
add(
  "2d.win",
  "Victory settles to one core plus the victorious one-life piece",
  "No losing core, no ghost, and winning life remains one",
  () => {
    const { b, h } = setup();
    const s = state(p("m", "carver", 36, 1));
    b.render(s, empty, null);
    commit(b, s, { type: "move", pieceId: "m", to: 45 });
    advance(580);
    expect(h.querySelectorAll(".square .core")).toHaveLength(1);
    expect(sq(h, 45).querySelector(".life")!.textContent).toBe("1");
    clean(h);
  },
);
add(
  "2d.input",
  "Board focus survives repeated motion-frame updates",
  "Focused destination button keeps identity and focus throughout travel",
  () => {
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    const target = sq(h, 18);
    target.focus();
    commit(b, s, moveAction);
    advance(140);
    expect(document.activeElement).toBe(target);
    advance(580);
    expect(document.activeElement).toBe(target);
    expect(h.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  },
);
add(
  "2d.input",
  "Arrow navigation remains available while a move animates",
  "ArrowUp moves focus from 18 to 25 without cancelling or duplicating motion",
  () => {
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    sq(h, 18).focus();
    sq(h, 18).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(sq(h, 25));
    expect(frames.size).toBe(1);
    expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(1);
  },
);
add(
  "2d.input",
  "Right-edge keyboard input never wraps during capture effects",
  "Focus stays on square 20 when ArrowRight is pressed",
  () => {
    const { b, h } = setup();
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    sq(h, 20).focus();
    sq(h, 20).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(sq(h, 20));
  },
);
add(
  "2d.input",
  "Clicking a square during capture dispatches exactly one board action",
  "Effects create no extra click callbacks",
  () => {
    const { b, h, click } = setup();
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(330);
    sq(h, 18).click();
    expect(click).toHaveBeenCalledExactlyOnceWith(18);
  },
);
add(
  "2d.accessibility",
  "Effect layer is excluded from assistive reading without hiding board controls",
  "Effects aria-hidden is true and destination aria-label reports authoritative remaining life",
  () => {
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    expect(h.querySelector(".board-effects")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(sq(h, 18).getAttribute("aria-label")).toContain("残り2ターン");
    expect(sq(h, 18).closest('[aria-hidden="true"]')).toBeNull();
  },
);
add(
  "2d.input",
  "Effect and moving-piece CSS cannot intercept pointer hit testing",
  "Computed pointer-events on the overlay and moving glyph are none",
  () => {
    styles();
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    expect(
      getComputedStyle(h.querySelector(".board-effects")!).pointerEvents,
    ).toBe("none");
    expect(getComputedStyle(moving(h, "m")).pointerEvents).toBe("none");
  },
);
add(
  "2d.reduced",
  "In-game reduced motion shows summon as a stable final glyph",
  "No moving clone or hidden piece; cue is static and final life visible",
  () => {
    document.body.classList.add("no-motion");
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    expect(h.querySelectorAll(".moving-piece,.motion-hidden")).toHaveLength(0);
    expect(sq(h, 9).querySelector(".life")!.textContent).toBe("3");
    expect(
      h.querySelector(".board-effects")!.classList.contains("reduced"),
    ).toBe(true);
    expect(frames.size).toBe(0);
  },
);
add(
  "2d.reduced",
  "OS reduced motion leaves a captured destination immediately authoritative",
  "Only the surviving mover is shown with life 2 and no travel loop",
  () => {
    preference.matches = true;
    const { b, h } = setup();
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    expect(sq(h, 18).querySelector('[data-piece-id="m"]')).not.toBeNull();
    expect(sq(h, 18).querySelector(".life")!.textContent).toBe("2");
    expect(h.querySelectorAll(".moving-piece,.motion-hidden")).toHaveLength(0);
    expect(frames.size).toBe(0);
  },
);
add(
  "2d.reduced",
  "Reduced capture and expiry cues do not paint over the final board",
  "Computed cue background and text are transparent with animation disabled",
  () => {
    styles();
    document.body.classList.add("no-motion");
    const { b, h } = setup();
    const s = capture(1);
    b.render(s, empty, null);
    commit(b, s, moveAction);
    expect(effects(h)).toHaveLength(2);
    for (const e of effects(h)) {
      const st = getComputedStyle(e);
      expect(st.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(st.color).toBe("rgba(0, 0, 0, 0)");
      expect(st.animation).toBe("none");
    }
  },
);
add(
  "2d.reduced",
  "Turning reduced motion on during travel immediately restores final lifetime",
  "Mutation callback clears travel and displays authoritative life 2",
  async () => {
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(100);
    document.body.classList.add("no-motion");
    await Promise.resolve();
    expect(sq(h, 18).querySelector(".life")!.textContent).toBe("2");
    clean(h);
  },
);
add(
  "2d.reduced",
  "Turning OS reduced motion on during double expiry removes all ghosts",
  "No piece is left hidden or moving after preference cancellation",
  () => {
    const { b, h } = setup();
    const s = swapped(1, 1);
    b.render(s, empty, null);
    commit(b, s, swap);
    advance(330);
    preference.matches = true;
    preference.listeners.forEach((f) => f());
    expect(h.querySelectorAll(".square .piece:not(.core)")).toHaveLength(0);
    clean(h);
  },
);
add(
  "2d.lifecycle",
  "Backgrounding mid-capture cancels effects and restores settled state",
  "Only the surviving mover remains and no work is pending",
  () => {
    const { b, h } = setup();
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(300);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sq(h, 18).querySelector('[data-piece-id="m"]')).not.toBeNull();
    clean(h);
  },
);
add(
  "2d.lifecycle",
  "A commit made in a hidden document never starts travel",
  "Authoritative state renders without effects or callbacks",
  () => {
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    hidden = true;
    commit(b, s, summon);
    expect(sq(h, 9).querySelector(".life")!.textContent).toBe("3");
    clean(h);
  },
);
add(
  "2d.lifecycle",
  "Restart during expiry rejects the previously queued animation callback",
  "Fresh empty board remains unchanged after the stale callback",
  () => {
    const { b, h } = setup();
    const s = capture(1);
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(400);
    const stale = [...frames.values()][0];
    b.cancelMotion?.();
    b.render(createGame(), empty, null);
    stale(500);
    expect(h.querySelectorAll(".square .piece:not(.core)")).toHaveLength(0);
    clean(h);
  },
);
add(
  "2d.lifecycle",
  "Disposal during summon removes overlay and cancels fallback timeout",
  "Detached host is empty and stale callback cannot recreate children",
  () => {
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    const stale = [...frames.values()][0];
    b.dispose();
    stale(140);
    expect(h.children).toHaveLength(0);
    clean(h);
  },
);
add(
  "2d.lifecycle",
  "Duplicate settled-state render preserves one current animation generation",
  "One moving glyph, one effect, one frame and unchanged mid-pose",
  () => {
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    const r = commit(b, s, summon);
    advance(130);
    const opacity = moving(h, "white-0-9").style.opacity;
    b.render(structuredClone(r.state), empty, null);
    expect(moving(h, "white-0-9").style.opacity).toBe(opacity);
    expect(effects(h)).toHaveLength(1);
    expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(1);
    expect(frames.size).toBe(1);
  },
);
add(
  "2d.lifecycle",
  "CPU-speed second summon supersedes the first without stale cleanup",
  "Only black enters; old callback cannot remove the new summon cue",
  () => {
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    const r = commit(b, s, summon);
    advance(100);
    const stale = [...frames.values()][0];
    const next = commit(b, r.state, {
      type: "summon",
      kind: "leaper",
      duration: 3,
      to: 39,
    });
    stale(580);
    expect(h.querySelectorAll("[data-moving-piece]")).toHaveLength(1);
    expect(moving(h, "black-1-39")).toBeTruthy();
    advance(700);
    b.render(next.state, empty, null);
    clean(h);
  },
);
add(
  "2d.lifecycle",
  "Watchdog clears a throttled animation when animation frames never arrive",
  "Timeout alone removes hidden state and restores final glyph",
  () => {
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    vi.advanceTimersByTime(630);
    expect(sq(h, 18).querySelector(".life")!.textContent).toBe("2");
    clean(h);
  },
);
add(
  "2d.reduced",
  "Absent requestAnimationFrame falls back to static feedback",
  "No hidden clone, static cue, and timeout-bounded cleanup",
  () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { b, h } = setup();
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    expect(h.querySelectorAll(".moving-piece,.motion-hidden")).toHaveLength(0);
    expect(effects(h)).toHaveLength(1);
    vi.advanceTimersByTime(630);
    clean(h);
  },
);
add(
  "2d.lifecycle",
  "Repeated pass-expiry cycles do not accumulate effects or square buttons",
  "Twenty-four fresh transitions retain exactly 49 controls and one empty effect layer",
  () => {
    const { b, h } = setup();
    for (let n = 0; n < 24; n++) {
      const s = state(p(`old${n}`, "bastion", 10, 1));
      b.render(s, empty, null);
      commit(b, s, { type: "pass" });
      advance(now + 580);
      clean(h);
    }
    expect(h.querySelectorAll("[data-square]")).toHaveLength(49);
    expect(h.querySelectorAll(".board-effects")).toHaveLength(1);
  },
);
add(
  "2d.input",
  "Selection and preview changes during motion never mutate game snapshots",
  "Serialized before and after states remain byte-identical to their initial values",
  () => {
    const { b, h } = setup();
    const s = move();
    b.render(s, empty, null);
    const r = commit(b, s, moveAction),
      copy = JSON.stringify([s, r.state]);
    advance(140);
    b.render(
      r.state,
      { pieceId: "m", candidate: null, inspectOnly: true },
      null,
    );
    sq(h, 18).click();
    expect(JSON.stringify([s, r.state])).toBe(copy);
    expect(frames.size).toBe(1);
  },
);

// M061–M095: Three.js scene integration (the renderer, not the scene, is mocked).
add(
  "3d.scene",
  "Initial 3D board has one CPU tile collider for every square",
  "Exactly 49 distinct tile squares and both cores exist without motion",
  () => {
    const { b, h } = setup("3d");
    b.render(createGame(), empty, null);
    const tiles = scene().children.filter((o) =>
      Number.isInteger(o.userData.square),
    );
    expect(tiles).toHaveLength(49);
    expect(new Set(tiles.map((o) => o.userData.square)).size).toBe(49);
    expect(scene().getObjectByName("core:white")).toBeDefined();
    expect(scene().getObjectByName("core:black")).toBeDefined();
    expect(h.querySelectorAll(".three-keys button")).toHaveLength(49);
    expect(frames.size).toBe(0);
  },
);
add(
  "3d.summon",
  "Summoned model scales in at its committed board coordinate",
  "Model starts hidden at square 9, then reaches half opacity-phase scale",
  () => {
    const { b } = setup("3d");
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    expect(model("white-0-9")!.position.toArray()).toEqual([-1, 0, 2]);
    expect(model("white-0-9")!.visible).toBe(false);
    advance(130);
    expect(model("white-0-9")!.visible).toBe(true);
    expect(model("white-0-9")!.scale.x).toBeCloseTo(0.86);
  },
);
add(
  "3d.summon",
  "Completed entrance retains the exact model and geometry identities",
  "Settlement restores unit scale without replacing live GPU-owned geometry",
  () => {
    const { b } = setup("3d");
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    const m = model("white-0-9")!,
      g = (m.children[0] as THREE.Mesh).geometry;
    advance(580);
    expect(model("white-0-9")).toBe(m);
    expect((m.children[0] as THREE.Mesh).geometry).toBe(g);
    expect(m.scale.toArray()).toEqual([1, 1, 1]);
    expect(m.visible).toBe(true);
  },
);
add(
  "3d.move",
  "Moving model visits actual legal Carver intermediates",
  "At first and second third it visits squares 16 and 17 in world space",
  () => {
    const { b } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(280 / 3);
    expect(model("m")!.position.x).toBeCloseTo(-1);
    expect(model("m")!.position.z).toBeCloseTo(1);
    advance(560 / 3);
    expect(model("m")!.position.x).toBeCloseTo(0);
    expect(model("m")!.position.z).toBeCloseTo(1);
  },
);
add(
  "3d.move",
  "Moving projected lifetime remains old until the exact arrival boundary",
  "3D life label changes from 3 to 2 only at 280ms",
  () => {
    const { b, h } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(279);
    expect(life(h, "m").textContent).toBe("3");
    advance(280);
    expect(life(h, "m").textContent).toBe("2");
  },
);
add(
  "3d.projection",
  "Role mark and life badge use the same moving anchor",
  "Both projected label anchors agree during a bent path",
  () => {
    const { b, h } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(190);
    const mark = h.querySelector<HTMLElement>('[data-mark-for="m"]')!;
    expect([mark.style.left, mark.style.top]).toEqual([
      life(h, "m").style.left,
      life(h, "m").style.top,
    ]);
  },
);
add(
  "3d.projection",
  "Projected label follows independently calculated moving world coordinates",
  "At 140ms the label matches camera projection of world x minus 0.2 and z 1.3",
  () => {
    const { b, h } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(140);
    const camera = gpu.camera as THREE.Camera;
    const v = new THREE.Vector3(-0.2, 0.12, 1.3).project(camera);
    expect(parseFloat(life(h, "m").style.left)).toBeCloseTo((v.x + 1) * 50);
    expect(parseFloat(life(h, "m").style.top)).toBeCloseTo((1 - v.y) * 50);
  },
);
add(
  "3d.leaper",
  "Leaper model rises over the pad while pad stays grounded",
  "At 140ms mover lift is 0.7 and pad remains at y zero",
  () => {
    const { b } = setup("3d");
    const s = state(p("m", "leaper", 23), p("pad", "bastion", 24));
    b.render(s, empty, null);
    commit(b, s, { type: "move", pieceId: "m", to: 25 });
    advance(140);
    expect(model("m")!.position.y).toBeCloseTo(0.7);
    expect(model("pad")!.position.y).toBe(0);
  },
);
add(
  "3d.leaper",
  "Leaper role and lifetime labels rise with the animated model",
  "Label anchor includes the 0.7 lift in its independent CPU projection",
  () => {
    const { b, h } = setup("3d");
    const s = state(p("m", "leaper", 23), p("pad", "bastion", 24));
    b.render(s, empty, null);
    commit(b, s, { type: "move", pieceId: "m", to: 25 });
    advance(140);
    const v = new THREE.Vector3(0.3, 0.82, 0.3).project(
      gpu.camera as THREE.Camera,
    );
    expect(parseFloat(life(h, "m").style.top)).toBeCloseTo((1 - v.y) * 50);
  },
);
add(
  "3d.capture",
  "Captured victim model survives until impact even though absent from authoritative state",
  "Victim remains visible at 279ms with its purchased life label",
  () => {
    const { b, h } = setup("3d");
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(279);
    expect(model("v")!.visible).toBe(true);
    expect(life(h, "v").textContent).toBe("3");
  },
);
add(
  "3d.capture",
  "Captured model shrinks only after arrival and disappears by impact end",
  "Victim scale is bounded below one at 330ms and visibility is false at 380ms",
  () => {
    const { b } = setup("3d");
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(330);
    expect(model("v")!.scale.x).toBeGreaterThan(0);
    expect(model("v")!.scale.x).toBeLessThan(1);
    advance(380);
    expect(model("v")!.visible).toBe(false);
  },
);
add(
  "3d.expiry",
  "Expiring capture mover stays alive until victim removal finishes",
  "Mover visible at 379ms; life becomes zero at 380ms; disappears by 540ms",
  () => {
    const { b, h } = setup("3d");
    const s = capture(1);
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(379);
    expect(model("m")!.visible).toBe(true);
    expect(life(h, "m").textContent).toBe("1");
    advance(380);
    expect(life(h, "m").textContent).toBe("0");
    advance(540);
    expect(model("m")!.visible).toBe(false);
  },
);
add(
  "3d.resources",
  "Capture settlement releases each departed victim geometry exactly once",
  "All captured geometry disposals happen once and its label is removed",
  () => {
    const { b, h } = setup("3d");
    const s = capture();
    b.render(s, empty, null);
    const m = model("v")!,
      spies: ReturnType<typeof vi.fn>[] = [];
    m.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const f = vi.fn();
        o.geometry.addEventListener("dispose", f);
        spies.push(f);
      }
    });
    commit(b, s, moveAction);
    advance(580);
    expect(model("v")).toBeUndefined();
    expect(h.querySelector('[data-life-for="v"]')).toBeNull();
    for (const f of spies) expect(f).toHaveBeenCalledOnce();
  },
);
add(
  "3d.resources",
  "Double expiry after swap retires both geometry sets",
  "Both swapped models disappear and first geometry of each is released once",
  () => {
    const { b } = setup("3d");
    const s = swapped(1, 1);
    b.render(s, empty, null);
    const a = vi.spyOn(
        (model("link")!.children[0] as THREE.Mesh).geometry,
        "dispose",
      ),
      c = vi.spyOn(
        (model("wall")!.children[0] as THREE.Mesh).geometry,
        "dispose",
      );
    commit(b, s, swap);
    advance(580);
    expect(model("link")).toBeUndefined();
    expect(model("wall")).toBeUndefined();
    expect(a).toHaveBeenCalledOnce();
    expect(c).toHaveBeenCalledOnce();
  },
);
add(
  "3d.swap",
  "Swap midpoint puts both models on the same interpolation plane",
  "Both identities occupy the midpoint at 140ms without swapping geometry",
  () => {
    const { b } = setup("3d");
    const s = swapped();
    b.render(s, empty, null);
    const a = model("link"),
      c = model("wall");
    commit(b, s, swap);
    advance(140);
    expect(a!.position.toArray()).toEqual([-0.5, 0, 0]);
    expect(c!.position.toArray()).toEqual([-0.5, 0, 0]);
    expect(model("link")).toBe(a);
    expect(model("wall")).toBe(c);
  },
);
add(
  "3d.win",
  "Core capture hides the losing core precisely at arrival",
  "Black core visible before 280ms, hidden at 280ms, removed at settlement",
  () => {
    const { b } = setup("3d");
    const s = state(p("m", "carver", 36, 1));
    b.render(s, empty, null);
    commit(b, s, { type: "move", pieceId: "m", to: 45 });
    advance(279);
    expect(scene().getObjectByName("core:black")!.visible).toBe(true);
    advance(280);
    expect(scene().getObjectByName("core:black")!.visible).toBe(false);
    advance(580);
    expect(scene().getObjectByName("core:black")).toBeUndefined();
    expect(model("m")!.visible).toBe(true);
  },
);
add(
  "3d.win",
  "Black victory removes only the white core",
  "Black one-life winner settles on white core square and retains black core",
  () => {
    const { b, h } = setup("3d");
    const s = state(p("m", "carver", 12, 1, "black"));
    s.turn = "black";
    b.render(s, empty, null);
    commit(b, s, { type: "move", pieceId: "m", to: 3 });
    advance(580);
    expect(scene().getObjectByName("core:white")).toBeUndefined();
    expect(scene().getObjectByName("core:black")).toBeDefined();
    expect(model("m")!.position.toArray()).toEqual([0, 0, 3]);
    expect(life(h, "m").textContent).toBe("1");
  },
);
add(
  "3d.reduced",
  "Reduced summon never samples invisible frame zero",
  "Summon model is immediately visible at unit scale and no RAF starts",
  () => {
    document.body.classList.add("no-motion");
    const { b } = setup("3d");
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    expect(model("white-0-9")!.visible).toBe(true);
    expect(model("white-0-9")!.scale.toArray()).toEqual([1, 1, 1]);
    expect(frames.size).toBe(0);
  },
);
add(
  "3d.reduced",
  "Repeated reduced-motion renders retain stable final position and lifetime",
  "Five redraws preserve final summon model and its life 3",
  () => {
    preference.matches = true;
    const { b, h } = setup("3d");
    const s = createGame();
    b.render(s, empty, null);
    const r = commit(b, s, summon);
    const m = model("white-0-9");
    for (let i = 0; i < 5; i++) {
      b.render(structuredClone(r.state), empty, null);
      expect(model("white-0-9")).toBe(m);
      expect(m!.position.toArray()).toEqual([-1, 0, 2]);
      expect(life(h, "white-0-9").textContent).toBe("3");
      expect(m!.visible).toBe(true);
    }
    expect(frames.size).toBe(0);
  },
);
add(
  "3d.reduced",
  "Enabling in-game reduced motion mid-Leaper jump lands immediately",
  "Model lift returns to zero, correct destination life appears, no frames remain",
  async () => {
    const { b, h } = setup("3d");
    const s = state(p("m", "leaper", 23), p("pad", "bastion", 24));
    b.render(s, empty, null);
    commit(b, s, { type: "move", pieceId: "m", to: 25 });
    advance(140);
    document.body.classList.add("no-motion");
    await Promise.resolve();
    expect(model("m")!.position.toArray()).toEqual([1, 0, 0]);
    expect(life(h, "m").textContent).toBe("2");
    clean(h);
  },
);
add(
  "3d.reduced",
  "OS preference cancellation during capture immediately releases victim",
  "Victim model and label disappear, survivor remains at destination",
  () => {
    const { b, h } = setup("3d");
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(300);
    preference.matches = true;
    preference.listeners.forEach((f) => f());
    expect(model("v")).toBeUndefined();
    expect(model("m")!.position.toArray()).toEqual([1, 0, 1]);
    expect(h.querySelector('[data-life-for="v"]')).toBeNull();
    clean(h);
  },
);
add(
  "3d.lifecycle",
  "Hidden-page cancellation settles a double-expiry swap",
  "Both models and projected badges are removed with all callbacks cancelled",
  () => {
    const { b, h } = setup("3d");
    const s = swapped(1, 1);
    b.render(s, empty, null);
    commit(b, s, swap);
    advance(350);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(model("link")).toBeUndefined();
    expect(model("wall")).toBeUndefined();
    expect(h.querySelectorAll("[data-life-for]")).toHaveLength(0);
    clean(h);
  },
);
add(
  "3d.lifecycle",
  "Snapshot reset during travel cannot be overwritten by a stale frame",
  "Reset produces only two cores and old frame cannot issue another render",
  () => {
    const { b, h } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(140);
    const stale = [...frames.values()][0];
    b.cancelMotion?.();
    b.render(createGame(), empty, null);
    const count = gpu.render.mock.calls.length;
    stale(280);
    expect(gpu.render).toHaveBeenCalledTimes(count);
    expect(model("m")).toBeUndefined();
    clean(h);
  },
);
add(
  "3d.lifecycle",
  "Fast opponent summon cannot reuse a retired capture callback",
  "New black model continues its own entrance and old callback does nothing",
  () => {
    const { b } = setup("3d");
    const s = capture();
    b.render(s, empty, null);
    const r = commit(b, s, moveAction);
    advance(300);
    const stale = [...frames.values()][0];
    commit(b, r.state, { type: "summon", kind: "link", duration: 2, to: 39 });
    const count = gpu.render.mock.calls.length;
    stale(580);
    expect(gpu.render).toHaveBeenCalledTimes(count);
    advance(900);
    expect(model("black-1-39")!.visible).toBe(true);
    expect(model("m")!.position.toArray()).toEqual([1, 0, 1]);
    expect(model("v")).toBeUndefined();
  },
);
add(
  "3d.resources",
  "Same generated ID with another role forces fresh geometry ownership",
  "Reset Carver geometry is released and a Leaper model replaces it",
  () => {
    const { b } = setup("3d");
    const s = createGame(),
      a = result(s, summon),
      c = result(s, { type: "summon", kind: "leaper", duration: 3, to: 9 });
    b.render(a.state, empty, null);
    const old = model("white-0-9")!,
      release = vi.spyOn((old.children[0] as THREE.Mesh).geometry, "dispose");
    b.render(c.state, empty, null);
    expect(model("white-0-9")).not.toBe(old);
    expect(model("white-0-9")!.getObjectByName("arched-body")).toBeDefined();
    expect(release).toHaveBeenCalledOnce();
  },
);
add(
  "3d.resources",
  "Same piece ID changing sides never reuses wrong facing or material",
  "Replacement black model faces pi radians and old geometry is released",
  () => {
    const { b } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    const old = model("m")!,
      release = vi.spyOn((old.children[0] as THREE.Mesh).geometry, "dispose");
    b.render(state(p("m", "carver", 9, 3, "black")), empty, null);
    expect(model("m")).not.toBe(old);
    expect(model("m")!.rotation.y).toBe(Math.PI);
    expect(release).toHaveBeenCalledOnce();
  },
);
add(
  "3d.projection",
  "Resize during travel preserves in-flight label position and pre-arrival life",
  "Resize redraw must not jump the moving label to destination or decrement early",
  () => {
    const { b, h } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(140);
    const old = [
      life(h, "m").style.left,
      life(h, "m").style.top,
      life(h, "m").textContent,
    ];
    const pending = [...frames.entries()];
    const modelPosition = model("m")!.position.toArray();
    resizes[0]();
    expect([...frames.entries()]).toEqual(pending);
    expect(model("m")!.position.toArray()).toEqual(modelPosition);
    expect([
      life(h, "m").style.left,
      life(h, "m").style.top,
      life(h, "m").textContent,
    ]).toEqual(old);
  },
);
add(
  "3d.projection",
  "Resize after victim fade does not resurrect an invisible victim badge",
  "Victim label remains opacity zero at 400ms even after ResizeObserver redraw",
  () => {
    const { b, h } = setup("3d");
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(400);
    expect(life(h, "v").style.opacity).toBe("0");
    resizes[0]();
    expect(life(h, "v").style.opacity).toBe("0");
    expect(
      h.querySelector<HTMLElement>('[data-mark-for="v"]')!.style.opacity,
    ).toBe("0");
    expect(model("v")!.visible).toBe(false);
  },
);
add(
  "3d.input",
  "Keyboard focus is retained while projected label DOM is replaced",
  "The same square control stays focused and there is exactly one tab stop",
  () => {
    const { b, h } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    const target = sq(h, 18);
    target.focus();
    commit(b, s, moveAction);
    advance(140);
    b.render(result(s, moveAction).state, empty, null);
    expect(document.activeElement).toBe(target);
    expect(h.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  },
);
add(
  "3d.input",
  "Keyboard activation during arrival dispatches only the selected square",
  "Target button click sends one square 18 callback",
  () => {
    const { b, h, click } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(280);
    sq(h, 18).click();
    expect(click).toHaveBeenCalledExactlyOnceWith(18);
  },
);
add(
  "3d.input",
  "Arrow key navigation is independent of the animated model position",
  "ArrowLeft from 18 focuses 17 while the model is between squares",
  () => {
    const { b, h } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(140);
    sq(h, 18).focus();
    sq(h, 18).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(sq(h, 17));
    expect(frames.size).toBe(1);
  },
);
add(
  "3d.resources",
  "Disposal releases active motion, geometry, renderer and shadow target once",
  "All pending work is cancelled and second disposal is inert",
  () => {
    const { b, h } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    const light = scene().children.find(
      (o) => o instanceof THREE.DirectionalLight && o.castShadow,
    ) as THREE.DirectionalLight;
    light.shadow.map = new THREE.WebGLRenderTarget(2, 2);
    const dispose = vi.spyOn(light.shadow.map, "dispose");
    b.dispose();
    b.dispose();
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.children).toHaveLength(0);
    clean(h);
  },
);
add(
  "3d.resources",
  "Low-quality mode changes pixel ratio and shadows without replacing models",
  "Pixel ratio becomes one and existing model identity survives redraw",
  () => {
    const { b } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    const m = model("m");
    document.body.classList.add("low-quality");
    b.render(s, empty, null);
    expect(gpu.pixel).toHaveBeenLastCalledWith(1);
    expect(gpu.shadows.enabled).toBe(false);
    expect(model("m")).toBe(m);
  },
);
add(
  "3d.resources",
  "Repeated capture-expiry sessions leave no growing model or badge population",
  "Sixteen complete last-life captures end with only two cores and 49 tile colliders",
  () => {
    const { b, h } = setup("3d");
    for (let i = 0; i < 16; i++) {
      const s = capture(1);
      b.render(s, empty, null);
      commit(b, s, moveAction);
      advance(now + 580);
      expect(model("m")).toBeUndefined();
      expect(model("v")).toBeUndefined();
      expect(h.querySelectorAll("[data-life-for]")).toHaveLength(0);
      clean(h);
    }
    expect(
      scene().children.filter((o) => Number.isInteger(o.userData.square)),
    ).toHaveLength(49);
  },
);
add(
  "3d.preview",
  "Summon preview never creates a scene piece or committed animation",
  "Only projected ghost appears while original scene has no summoned model",
  () => {
    const { b, h } = setup("3d");
    const s = createGame();
    b.render(s, { pieceId: null, candidate: summon }, previewAction(s, summon));
    expect(h.querySelectorAll(".projected-ghost")).toHaveLength(1);
    expect(model("white-0-9")).toBeUndefined();
    expect(effects(h)).toHaveLength(0);
    expect(frames.size).toBe(0);
  },
);

// M096–M115: timing owner and cancellation generation contracts.
function player() {
  const h = host(),
    frame = vi.fn(),
    point = vi.fn((x: number, y: number) => ({ x: x * 10, y: y * 10 }));
  const m = createMotionPlayer(h, point, frame);
  cleanup.push(() => m.dispose());
  return { h, m, frame, point };
}
function enter(m: ReturnType<typeof createMotionPlayer>) {
  const s = createGame(),
    r = result(s, summon);
  m.update(s);
  m.update(r.state, { before: s, events: r.events });
  return r;
}
add(
  "player.lifecycle",
  "Initial state-only rendering never schedules visual work",
  "No cue, timer or animation frame without a committed transition",
  () => {
    const { h, m } = player();
    m.update(createGame());
    clean(h);
  },
);
add(
  "player.lifecycle",
  "Explicit null transition settles state without fabricating effects",
  "A changed snapshot without transition remains static",
  () => {
    const { h, m } = player();
    const s = createGame();
    m.update(s);
    m.update(result(s, summon).state, null);
    clean(h);
  },
);
add(
  "player.lifecycle",
  "Repeated identical snapshot with transition cannot replay an entrance",
  "After settlement, identical commit data creates no cue or new RAF",
  () => {
    const { h, m } = player();
    const r = enter(m);
    advance(580);
    m.update(r.state, { before: createGame(), events: r.events });
    clean(h);
  },
);
add(
  "player.lifecycle",
  "Duplicate render reuses the last sampled elapsed time",
  "The most recent animated callback remains at 123ms without starting zero again",
  () => {
    const { m, frame } = player();
    const r = enter(m);
    advance(123);
    frame.mockClear();
    m.update(structuredClone(r.state));
    expect(frame).toHaveBeenCalledOnce();
    expect(frame.mock.calls[0][1]).toBe(123);
    expect(frames.size).toBe(1);
  },
);
add(
  "player.lifecycle",
  "Frame exactly at duration is cleanup rather than another live sample",
  "A 580ms callback invokes only frame null and cancels the watchdog",
  () => {
    const { h, m, frame } = player();
    enter(m);
    frame.mockClear();
    advance(580);
    expect(frame).toHaveBeenCalledExactlyOnceWith(null, 0);
    clean(h);
  },
);
add(
  "player.lifecycle",
  "Very late resumed animation frame immediately settles",
  "A 30-second time jump causes no interpolated stale state",
  () => {
    const { h, m, frame } = player();
    enter(m);
    frame.mockClear();
    advance(30000);
    expect(frame).toHaveBeenCalledExactlyOnceWith(null, 0);
    clean(h);
  },
);
add(
  "player.lifecycle",
  "Watchdog keeps a stalled frame bounded by 630ms",
  "Cue survives 629ms timer time and is removed at 630ms",
  () => {
    const { h, m } = player();
    enter(m);
    vi.advanceTimersByTime(629);
    expect(effects(h)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    clean(h);
  },
);
add(
  "player.lifecycle",
  "Cancellation clears both watchdog and scheduled frame",
  "No callbacks remain and the frame adapter receives final-state reset",
  () => {
    const { h, m, frame } = player();
    enter(m);
    m.cancel();
    expect(frame).toHaveBeenLastCalledWith(null, 0);
    clean(h);
  },
);
add(
  "player.lifecycle",
  "A stale callback from a cancelled generation is inert",
  "Calling previously captured RAF cannot render or reschedule anything",
  () => {
    const { h, m, frame } = player();
    enter(m);
    const stale = [...frames.values()][0];
    m.cancel();
    frame.mockClear();
    stale(140);
    expect(frame).not.toHaveBeenCalled();
    clean(h);
  },
);
add(
  "player.lifecycle",
  "A stale callback cannot interfere with a replacement generation",
  "Old callback does not invoke adapter or remove the new cue",
  () => {
    const { h, m, frame } = player();
    const r = enter(m);
    const stale = [...frames.values()][0];
    const next = result(r.state, {
      type: "summon",
      kind: "link",
      duration: 2,
      to: 39,
    });
    m.update(next.state, { before: r.state, events: next.events });
    frame.mockClear();
    stale(300);
    expect(frame).not.toHaveBeenCalled();
    expect(effects(h)).toHaveLength(1);
    expect(effects(h)[0].getAttribute("data-at")).toBe("39");
    expect(frames.size).toBe(1);
  },
);
add(
  "player.lifecycle",
  "Disposal during frame zero cannot leave a late-created timer",
  "Adapter-triggered disposal prevents both scheduling branches",
  () => {
    const h = host();
    let m: ReturnType<typeof createMotionPlayer>;
    m = createMotionPlayer(
      h,
      (x, y) => ({ x, y }),
      (plan) => {
        if (plan) m.dispose();
      },
    );
    cleanup.push(() => m.dispose());
    enter(m);
    expect(h.children).toHaveLength(0);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
add(
  "player.lifecycle",
  "Cancellation from an in-flight adapter cannot reschedule retired RAF",
  "Adapter cancellation on first nonzero frame removes all visual work",
  () => {
    const h = host();
    let m: ReturnType<typeof createMotionPlayer>;
    m = createMotionPlayer(
      h,
      (x, y) => ({ x, y }),
      (plan, time) => {
        if (plan && time > 0) m.cancel();
      },
    );
    cleanup.push(() => m.dispose());
    enter(m);
    advance(20);
    clean(h);
  },
);
add(
  "player.lifecycle",
  "Disposed player ignores later valid commits",
  "No effect DOM or scheduled work can be recreated",
  () => {
    const { h, m, frame } = player();
    m.dispose();
    frame.mockClear();
    enter(m);
    expect(frame).not.toHaveBeenCalled();
    expect(h.children).toHaveLength(0);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
add(
  "player.reduced",
  "Reduced mode never invokes animated adapter frames",
  "Only final-state null callbacks occur, even with repeated state renders",
  () => {
    preference.matches = true;
    const { m, frame } = player();
    const r = enter(m);
    m.update(r.state);
    expect(frame.mock.calls.every((c) => c[0] === null)).toBe(true);
    expect(frames.size).toBe(0);
  },
);
add(
  "player.reduced",
  "Static fallback ignores causal delays but preserves cue identities",
  "Capture and expiry both have zero animation delay in reduced mode",
  () => {
    document.body.classList.add("no-motion");
    const { m, h } = player();
    const s = capture(1),
      r = result(s, moveAction);
    m.update(s);
    m.update(r.state, { before: s, events: r.events });
    expect(effects(h)).toHaveLength(2);
    for (const c of effects(h))
      expect((c as HTMLElement).style.getPropertyValue("--cue-delay")).toBe(
        "0ms",
      );
    expect(frames.size).toBe(0);
  },
);
add(
  "player.lifecycle",
  "Visibility restoration does not replay a previously cancelled action",
  "Returning from background and rendering the same state creates no motion",
  () => {
    const { h, m } = player();
    const r = enter(m);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    m.update(r.state);
    clean(h);
  },
);
add(
  "player.resources",
  "Disposal unregisters media preference listener",
  "Preference listener set returns to zero and future changes do not invoke adapter",
  () => {
    const { m, frame } = player();
    expect(preference.listeners.size).toBe(1);
    enter(m);
    m.dispose();
    expect(preference.listeners.size).toBe(0);
    frame.mockClear();
    preference.matches = true;
    preference.listeners.forEach((f) => f());
    expect(frame).not.toHaveBeenCalled();
  },
);
add(
  "player.resources",
  "Disposal unregisters visibility listener and disconnects mutation observation",
  "Subsequent visibility and body-class events produce no adapter calls",
  async () => {
    const { m, frame } = player();
    enter(m);
    m.dispose();
    frame.mockClear();
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    document.body.className = "no-motion";
    await Promise.resolve();
    expect(frame).not.toHaveBeenCalled();
  },
);
add(
  "player.projection",
  "Each committed effect uses its own independent board anchor",
  "Swap cues project squares 23 and 24 separately without sharing coordinates",
  () => {
    const { m, h, point } = player();
    const s = swapped(),
      r = result(s, swap);
    m.update(s);
    m.update(r.state, { before: s, events: r.events });
    expect(point.mock.calls).toEqual([
      [2, 3],
      [3, 3],
    ]);
    expect(
      [...effects(h)].map((e) => [
        (e as HTMLElement).style.left,
        (e as HTMLElement).style.top,
      ]),
    ).toEqual([
      ["20%", "30%"],
      ["30%", "30%"],
    ]);
  },
);
add(
  "player.resources",
  "Long sequence of independent players leaves no observers or queued work",
  "Thirty create-commit-dispose cycles release all media listeners and timers",
  () => {
    for (let i = 0; i < 30; i++) {
      const { h, m } = player();
      enter(m);
      m.dispose();
      expect(h.children).toHaveLength(0);
      expect(preference.listeners.size).toBe(0);
      expect(frames.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  },
);

// M116–M130: real CPU projections, geometry transforms, and tile-only picking.
function canvasRect(h: HTMLElement) {
  const canvas = h.querySelector("canvas")!;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 350,
    height: 350,
    right: 350,
    bottom: 350,
    toJSON() {
      return {};
    },
  });
  return canvas;
}
function pointerAt(h: HTMLElement, q: number) {
  const v = new THREE.Vector3((q % 7) - 3, 0.05, 3 - Math.floor(q / 7)).project(
    gpu.camera as THREE.Camera,
  );
  canvasRect(h).dispatchEvent(
    new MouseEvent("pointerup", {
      clientX: (v.x + 1) * 175,
      clientY: (1 - v.y) * 175,
      bubbles: true,
    }),
  );
}
add(
  "geometry.projection",
  "Every tile center has a finite unique screen projection inside the board",
  "All 49 keyboard anchors stay inside normalized viewport with unique positions",
  () => {
    const { b, h } = setup("3d");
    b.render(createGame(), empty, null);
    const points = [
      ...h.querySelectorAll<HTMLElement>(".three-keys button"),
    ].map((el) => [parseFloat(el.style.left), parseFloat(el.style.top)]);
    expect(new Set(points.map((p) => p.join(","))).size).toBe(49);
    for (const p of points) {
      finite(p);
      expect(p.every((v) => v > 0 && v < 100)).toBe(true);
    }
  },
);
add(
  "geometry.input",
  "CPU raycasting selects all 49 tile centers including occupied cores",
  "Each center returns precisely its own square using actual ray intersections",
  () => {
    const { b, h, click } = setup("3d");
    b.render(createGame(), empty, null);
    for (let q = 0; q < 49; q++) pointerAt(h, q);
    expect(click.mock.calls.map((c) => c[0])).toEqual(
      Array.from({ length: 49 }, (_, i) => i),
    );
  },
);
add(
  "geometry.input",
  "Moving model cannot intercept the tile-only picking ray",
  "Pointer at square 18 during arrival returns 18 even with model over it",
  () => {
    const { b, h, click } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(280);
    pointerAt(h, 18);
    expect(click).toHaveBeenCalledExactlyOnceWith(18);
  },
);
add(
  "geometry.input",
  "A projected summon ghost cannot change destination picking",
  "Pointer at ghost square 9 still selects square 9",
  () => {
    const { b, h, click } = setup("3d");
    const s = createGame();
    b.render(s, { pieceId: null, candidate: summon }, previewAction(s, summon));
    pointerAt(h, 9);
    expect(click).toHaveBeenCalledExactlyOnceWith(9);
  },
);
add(
  "geometry.input",
  "Pointer far outside the board produces no invented square",
  "A ray beyond camera bounds never calls onSquare",
  () => {
    const { b, h, click } = setup("3d");
    b.render(createGame(), empty, null);
    canvasRect(h).dispatchEvent(
      new MouseEvent("pointerup", { clientX: -1000, clientY: -1000 }),
    );
    expect(click).not.toHaveBeenCalled();
  },
);
add(
  "geometry.input",
  "Disposed canvas cannot deliver late pointer input",
  "An event on the retained old canvas reference has no board callback",
  () => {
    const { b, h, click } = setup("3d");
    b.render(createGame(), empty, null);
    const canvas = canvasRect(h);
    b.dispose();
    canvas.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 175, clientY: 175 }),
    );
    expect(click).not.toHaveBeenCalled();
  },
);
add(
  "geometry.projection",
  "3D keyboard anchors match independently projected tile centers",
  "Near, center, and far-row controls align to CPU camera projection",
  () => {
    const { b, h } = setup("3d");
    b.render(createGame(), empty, null);
    for (const q of [0, 3, 6, 21, 24, 27, 42, 45, 48]) {
      const v = new THREE.Vector3(
        (q % 7) - 3,
        0.05,
        3 - Math.floor(q / 7),
      ).project(gpu.camera as THREE.Camera);
      expect(parseFloat(sq(h, q).style.left)).toBeCloseTo((v.x + 1) * 50);
      expect(parseFloat(sq(h, q).style.top)).toBeCloseTo((1 - v.y) * 50);
    }
  },
);
add(
  "geometry.projection",
  "Resize preserves normalized anchor geometry across narrow and wide boards",
  "Changing host width changes renderer size while normalized tile anchors stay stable",
  () => {
    const { b, h } = setup("3d");
    b.render(move(), empty, null);
    const anchor = sq(h, 18).style.cssText;
    Object.defineProperty(h, "clientWidth", { value: 196, configurable: true });
    resizes[0]();
    expect(gpu.size).toHaveBeenLastCalledWith(196, 196, false);
    expect(sq(h, 18).style.cssText).toBe(anchor);
    Object.defineProperty(h, "clientWidth", { value: 980, configurable: true });
    resizes[0]();
    expect(gpu.size).toHaveBeenLastCalledWith(980, 980, false);
    expect(sq(h, 18).style.cssText).toBe(anchor);
  },
);
add(
  "geometry.leaper",
  "Leaper arc changes only vertical clearance not its planar footprint",
  "At midpoint real world bounds fit within landing-cell horizontal width",
  () => {
    const { b } = setup("3d");
    const s = state(p("m", "leaper", 23), p("pad", "bastion", 24));
    b.render(s, empty, null);
    commit(b, s, { type: "move", pieceId: "m", to: 25 });
    advance(140);
    const bounds = new THREE.Box3().setFromObject(model("m")!);
    expect(bounds.min.y).toBeCloseTo(0.7);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(1);
    expect(bounds.max.z - bounds.min.z).toBeLessThan(1);
    expect(bounds.min.y).toBeGreaterThan(
      new THREE.Box3().setFromObject(model("pad")!).max.y,
    );
  },
);
add(
  "geometry.expiry",
  "Capture-plus-expiry never inverts model scales or creates nonfinite matrices",
  "All scene matrices and scales stay finite and nonnegative throughout causal boundaries",
  () => {
    const { b } = setup("3d");
    const s = capture(1);
    b.render(s, empty, null);
    commit(b, s, moveAction);
    for (const t of [0, 139, 280, 330, 380, 460, 539, 540]) {
      advance(t);
      scene().traverse((o) => {
        finite(o.matrixWorld.elements);
        expect(
          o.scale.toArray().every((v) => v >= 0 && Number.isFinite(v)),
        ).toBe(true);
      });
    }
  },
);
add(
  "geometry.resources",
  "Different roles do not accidentally share disposable geometry or material owners",
  "Retiring one model never disposes resources belonging to three other roles",
  () => {
    const roots: THREE.Group[] = ["bastion", "carver", "leaper", "link"].map(
      (k) => createPieceModel(k as Kind, "white"),
    );
    const resources = roots.map((root) => {
      const set = new Set<THREE.BufferGeometry | THREE.Material>();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          set.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            set.add(m);
        }
      });
      return set;
    });
    try {
      for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++)
          expect([...resources[a]].some((v) => resources[b].has(v))).toBe(
            false,
          );
    } finally {
      roots.forEach(disposeObject);
    }
  },
);
add(
  "geometry.resources",
  "Core and temporary unit resource ownership are independent",
  "Disposing a core does not dispose any coincident unit resource",
  () => {
    const core = createCoreModel("white"),
      unit = createPieceModel("link", "white"),
      spy = vi.fn();
    unit.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.addEventListener("dispose", spy);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          m.addEventListener("dispose", spy);
      }
    });
    disposeObject(core);
    expect(spy).not.toHaveBeenCalled();
    disposeObject(unit);
  },
);
add(
  "geometry.input",
  "Selection color and candidate markers never alter collider coordinates",
  "A legal move preview leaves every tile world position unchanged and target still pickable",
  () => {
    const { b, h, click } = setup("3d");
    const s = move();
    b.render(s, empty, null);
    const before = scene()
      .children.filter((o) => Number.isInteger(o.userData.square))
      .map((o) => o.position.toArray());
    b.render(
      s,
      { pieceId: "m", candidate: moveAction },
      previewAction(s, moveAction),
    );
    expect(
      scene()
        .children.filter((o) => Number.isInteger(o.userData.square))
        .map((o) => o.position.toArray()),
    ).toEqual(before);
    pointerAt(h, 18);
    expect(click).toHaveBeenCalledExactlyOnceWith(18);
  },
);
add(
  "geometry.effects",
  "Effect overlay clips animated content to board bounds",
  "Computed overlay overflow is hidden and its layer cannot steal pointer events",
  () => {
    styles();
    const { b, h } = setup("3d");
    const s = createGame();
    b.render(s, empty, null);
    commit(b, s, summon);
    const effect = h.querySelector(".board-effects")!;
    expect(getComputedStyle(effect).overflow).toBe("hidden");
    expect(getComputedStyle(effect).pointerEvents).toBe("none");
  },
);
add(
  "geometry.team",
  "Black-facing model keeps its orientation throughout a legal move",
  "Black Carver retains pi rotation while moving and lands without geometry replacement",
  () => {
    const { b } = setup("3d");
    const s = state(p("m", "carver", 39, 3, "black"));
    s.turn = "black";
    b.render(s, empty, null);
    const m = model("m")!;
    commit(b, s, { type: "move", pieceId: "m", to: 30 });
    advance(140);
    expect(m.rotation.y).toBe(Math.PI);
    advance(580);
    expect(model("m")).toBe(m);
    expect(m.rotation.y).toBe(Math.PI);
    expect(m.position.toArray()).toEqual([-1, 0, -1]);
  },
);

// M131–M140: renderer changes/faults with authoritative-state preservation.
function adaptive() {
  const h = host(),
    click = vi.fn(),
    status = vi.fn();
  const b = createAdaptiveBoard(
    h,
    click,
    (f) => createBoard3D(h, click, f),
    status,
  );
  cleanup.push(() => b.dispose());
  return { h, b, click, status };
}
add(
  "adaptive.constructor",
  "Unavailable WebGL construction falls back to a playable 2D board",
  "Fallback has 49 controls, latest state, and a clear 2D status",
  () => {
    gpu.fail = true;
    const { h, b, status } = adaptive();
    b.render(move(), empty, null);
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining("2D"));
    expect(h.querySelectorAll(".square")).toHaveLength(49);
    expect(sq(h, 9).querySelector('[data-piece-id="m"]')).not.toBeNull();
    expect(h.querySelector("canvas")).toBeNull();
  },
);
add(
  "adaptive.failure",
  "Synchronous renderer failure preserves the latest committed snapshot",
  "2D fallback displays moved piece at 18 and contains no replay effects",
  () => {
    const { h, b, status } = adaptive();
    const s = move();
    b.render(s, empty, null);
    gpu.render.mockImplementationOnce(() => {
      throw Error("render fault");
    });
    commit(b, s, moveAction);
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining("2D"));
    expect(sq(h, 18).querySelector('[data-piece-id="m"]')).not.toBeNull();
    clean(h);
  },
);
add(
  "adaptive.context",
  "Context loss during capture restores final 2D state without victim ghosts",
  "Latest survivor remains, victim is absent, and WebGL resources are disposed once",
  () => {
    const { h, b, status } = adaptive();
    const s = capture();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(300);
    const canvas = h.querySelector("canvas")!;
    const event = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining("2D"));
    expect(sq(h, 18).querySelector('[data-piece-id="m"]')).not.toBeNull();
    expect(h.querySelector('[data-piece-id="v"]')).toBeNull();
    expect(gpu.dispose).toHaveBeenCalledOnce();
    clean(h);
  },
);
add(
  "adaptive.failure",
  "Animation-frame renderer failure falls back without throwing to input code",
  "A simulated frame exception restores 49 2D controls and cancels every timer",
  () => {
    const { h, b, status } = adaptive();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    gpu.render.mockImplementationOnce(() => {
      throw Error("RAF fault");
    });
    expect(() => advance(100)).not.toThrow();
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining("2D"));
    expect(h.querySelectorAll(".square")).toHaveLength(49);
    clean(h);
  },
);
add(
  "adaptive.failure",
  "Resize renderer failure preserves a last-life capture result",
  "Fallback has zero units after authoritative double removal and no active callbacks",
  () => {
    const { h, b, status } = adaptive();
    const s = capture(1);
    b.render(s, empty, null);
    commit(b, s, moveAction);
    advance(350);
    gpu.render.mockImplementationOnce(() => {
      throw Error("resize fault");
    });
    expect(() => resizes[0]()).not.toThrow();
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining("2D"));
    expect(h.querySelectorAll(".square .piece:not(.core)")).toHaveLength(0);
    clean(h);
  },
);
add(
  "adaptive.failure",
  "Frame-zero failure cannot create a watchdog after disposal",
  "Hidden entering model triggers fallback with no retained RAF or timeout",
  () => {
    const { h, b, status } = adaptive();
    const s = createGame();
    b.render(s, empty, null);
    gpu.render.mockImplementation((scene: THREE.Scene) => {
      if (scene.getObjectByName("piece:white-0-9")?.visible === false)
        throw Error("frame zero fault");
    });
    commit(b, s, summon);
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining("2D"));
    expect(sq(h, 9).querySelector(".life")!.textContent).toBe("3");
    clean(h);
  },
);
add(
  "adaptive.preview",
  "Renderer fallback retains the selected piece and proposed destination",
  "Selection at 9, candidate at 18, and route markers survive the switch",
  () => {
    const { h, b } = adaptive();
    const s = move();
    b.render(
      s,
      { pieceId: "m", candidate: moveAction },
      previewAction(s, moveAction),
    );
    h.querySelector("canvas")!.dispatchEvent(
      new Event("webglcontextlost", { cancelable: true }),
    );
    expect(sq(h, 9).getAttribute("aria-pressed")).toBe("true");
    expect(sq(h, 18).classList.contains("candidate")).toBe(true);
    expect(h.querySelectorAll(".route").length).toBeGreaterThan(0);
  },
);
add(
  "adaptive.input",
  "Input callback remains connected after switching renderer during motion",
  "A 2D square click after fallback delivers one intended square",
  () => {
    const { h, b, click } = adaptive();
    const s = move();
    b.render(s, empty, null);
    commit(b, s, moveAction);
    h.querySelector("canvas")!.dispatchEvent(
      new Event("webglcontextlost", { cancelable: true }),
    );
    sq(h, 18).click();
    expect(click).toHaveBeenCalledExactlyOnceWith(18);
  },
);
add(
  "adaptive.lifecycle",
  "Repeated context loss on retired canvas cannot rebuild the fallback board",
  "Second old-canvas loss does not replace controls or repeat status notification",
  () => {
    const { h, b, status } = adaptive();
    b.render(move(), empty, null);
    const canvas = h.querySelector("canvas")!;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const target = sq(h, 9),
      count = status.mock.calls.length;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(sq(h, 9)).toBe(target);
    expect(status).toHaveBeenCalledTimes(count);
    expect(gpu.dispose).toHaveBeenCalledOnce();
  },
);
add(
  "adaptive.lifecycle",
  "Disposed adaptive board ignores late renderer loss and later render requests",
  "Disposal keeps host empty and never recreates a 2D fallback",
  () => {
    const { h, b, status } = adaptive();
    b.render(move(), empty, null);
    const canvas = h.querySelector("canvas")!;
    b.dispose();
    const count = status.mock.calls.length;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    b.render(createGame(), empty, null);
    expect(h.children).toHaveLength(0);
    expect(status).toHaveBeenCalledTimes(count);
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);

if (ledger.length !== 140)
  throw Error(`Expected exactly 140 motion cases, got ${ledger.length}`);
