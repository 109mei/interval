// @vitest-environment jsdom
// C11–C20 are distinct investigations, not a generated case-count campaign.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createController, type Controller } from "../src/app/controller";
import { chooseCpuAction } from "../src/cpu/choose-action";
import { applyAction, createGame, previewAction } from "../src/game/engine";
import { isLegal, legalActions, PRICES, validState } from "../src/game/rules";
import type { Action, GameState, Kind, Piece, Side } from "../src/game/types";
import { createAdaptiveBoard } from "../src/render/adaptive";
import { createBoard2D } from "../src/render/board2d";
import { createBoard3D } from "../src/render/board3d";
import type { BoardView } from "../src/render/board-view";
import { boardTargets } from "../src/render/board-targets";
import { expiryExplanation, outcomeNotice } from "../src/ui/feedback";
import { INFO, PIECE_MARK } from "../src/ui/piece-info";

const gpu = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  quality: vi.fn(),
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
      setPixelRatio() {
        gpu.quality();
      }
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
const sel = { pieceId: null, candidate: null };
const boards: BoardView[] = [];
const controllers: Controller[] = [];
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0,
  now = 0;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const piece = (
  id: string,
  kind: Kind,
  side: Side,
  square: number,
  remaining: number,
): Piece => ({ id, kind, side, square, remaining, summonedPly: -1 });
function next(state: GameState, action: Action) {
  const result = applyAction(state, action);
  if (!result.ok) throw Error(`Invalid fixture: ${JSON.stringify(action)}`);
  return result;
}
function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}
function controller() {
  const c = createController(() => {});
  controllers.push(c);
  c.restart("cpu");
  return c;
}
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  input: GameState | undefined;
  postMessage(state: GameState) {
    this.input = structuredClone(state);
  }
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
function tick(time: number) {
  now = time;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(time));
}
function resources(scene: THREE.Object3D) {
  const all = new Set<THREE.BufferGeometry | THREE.Material>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    all.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material])
      all.add(material);
  });
  return [...all];
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  gpu.render.mockReset();
  gpu.dispose.mockReset();
  gpu.quality.mockReset();
  gpu.disconnect.mockReset();
  gpu.scene = null;
  FakeWorker.instances = [];
  now = frameId = 0;
  frames.clear();
  document.body.innerHTML = "";
  document.body.className = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
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
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  gpu.render.mockReset();
  for (const board of boards.splice(0)) board.dispose();
  for (const c of controllers.splice(0)) c.dispose();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("C11 — explicit local opening exposes bilateral paid third ranks and rejects the central rank", async () => {
  // Mutation sensitivity: eager opening, free pieces, wrong side zone, or incorrect cost breaks this route.
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await import("../src/main");
  await flush();
  const el = (id: string) => document.getElementById(id)!;
  const click = (id: string) => (el(id) as HTMLButtonElement).click();
  const square = (q: number) =>
    document.querySelector<HTMLButtonElement>(`[data-square="${q}"]`)!;
  expect(el("home").hidden).toBe(false);
  click("choose-local");
  expect(document.querySelector("[data-square]")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  click("start-game");
  expect(document.querySelectorAll(".square .piece:not(.core)")).toHaveLength(
    0,
  );
  expect(document.querySelectorAll(".square .core")).toHaveLength(2);
  for (const [side, q, cost] of [
    ["white", 14, 6],
    ["black", 28, 6],
  ] as const) {
    click("summon");
    document.querySelector<HTMLButtonElement>('[data-kind="leaper"]')!.click();
    const prior = Number(el(`${side}-grain`).textContent);
    const targets = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-target-kind="summon"]',
      ),
    ].map((b) => Number(b.dataset.square));
    const expected = Array.from({ length: 21 }, (_, i) =>
      side === "white" ? i : i + 28,
    ).filter((i) => i !== (side === "white" ? 3 : 45));
    expect(targets.sort((a, b) => a - b)).toEqual(expected);
    square(21).click();
    expect((el("confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(el(`${side}-grain`).textContent).toBe(String(prior));
    square(q).click();
    expect(el("purchase-facts").textContent).toContain(`3ターンで${cost}糧`);
    click("confirm");
    await flush();
    expect(el(`${side}-grain`).textContent).toBe(String(prior - cost));
    expect(square(q).getAttribute("aria-label")).toContain("残り3ターン");
  }
  expect(el("board-legend").textContent).toContain("持ち主の手番");
  expect(FakeWorker.instances).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
  // A real-main fixture must cancel its internal board before the DOM environment ends.
  expect(vi.getTimerCount()).toBe(1);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  click("home-button");
  expect(vi.getTimerCount()).toBe(0);
  expect(frames.size).toBe(0);
});

it("C12 — every paid duration survives its summon and opponent turns, expiring at exactly N own ends", () => {
  const prices = { bastion: 1, carver: 3, leaper: 2, link: 1 };
  expect(PRICES).toEqual(prices);
  // Independent countdown, prices and side schedule are the oracle, not engine-derived expected values.
  for (const side of ["white", "black"] as const)
    for (const kind of ["bastion", "carver", "leaper", "link"] as const)
      for (let duration = 1; duration <= 5; duration++) {
        let s = createGame();
        s.turn = side;
        s.grain = { white: 100, black: 100 };
        const to = side === "white" ? 20 : 28;
        const initial = JSON.stringify(s);
        const purchase: Action = { type: "summon", kind, duration, to };
        expect(previewAction(s, purchase)).toMatchObject({
          cost: prices[kind] * duration,
          grainAfter: 100 - prices[kind] * duration,
          expires: [],
        });
        expect(JSON.stringify(s)).toBe(initial);
        s = next(s, purchase).state;
        const id = s.pieces[0].id;
        expect(s.pieces[0].remaining).toBe(duration);
        expect(s.grain[side]).toBe(100 - prices[kind] * duration);
        for (let elapsed = 1; elapsed <= duration; elapsed++) {
          // Buying instead of consecutive passes prevents the unrelated six-pass terminal rule.
          const rival = side === "white" ? "black" : "white";
          const rivalTo = (
            rival === "white" ? [0, 1, 2, 4, 5] : [48, 47, 46, 44, 43]
          )[elapsed - 1];
          s = next(s, {
            type: "summon",
            kind: "bastion",
            duration: 1,
            to: rivalTo,
          }).state;
          expect(s.pieces.find((p) => p.id === id)?.remaining).toBe(
            duration - elapsed + 1,
          );
          if (elapsed === duration)
            expect(
              expiryExplanation(
                s,
                s.pieces.find((p) => p.id === id)!,
              ),
            ).toMatch(/^この(白|黒)の手番末/);
          const r = next(s, { type: "pass" });
          s = r.state;
          expect(s.pieces.find((p) => p.id === id)?.remaining).toBe(
            elapsed === duration ? undefined : duration - elapsed,
          );
          expect(
            r.events.some(
              (event) => event.type === "expire" && event.pieceIds.includes(id),
            ),
          ).toBe(elapsed === duration);
        }
        expect(s.outcome).toBeNull();
      }
});

it("C13 — Ren's mirrored support, last-life capture and core-limit decisions match previews", () => {
  for (const side of ["white", "black"] as const) {
    const enemy = side === "white" ? "black" : "white";
    const q = (square: number) => (side === "white" ? square : 48 - square);
    let s: GameState = {
      ...createGame(),
      turn: side,
      ply: 20,
      grain: { white: 20, black: 20 },
      pieces: [
        piece("link", "link", side, q(23), 2),
        piece("leaper", "leaper", side, q(24), 2),
        piece("victim", "carver", enemy, q(25), 3),
      ],
    };
    const swap: Action = { type: "swap", pieceId: "link", allyId: "leaper" };
    expect(previewAction(s, swap)?.expires).toEqual([]);
    s = next(s, swap).state;
    expect(
      s.pieces.filter((p) => p.side === side).map((p) => p.remaining),
    ).toEqual([1, 1]);
    s = next(s, { type: "pass" }).state;
    const capture: Action = { type: "move", pieceId: "leaper", to: q(25) };
    const before = JSON.stringify(s);
    expect(previewAction(s, capture)).toMatchObject({
      cost: 0,
      reward: 6,
      grainAfter: 30,
      expires: ["link", "leaper"],
    });
    expect(JSON.stringify(s)).toBe(before);
    const captured = next(s, capture);
    expect(captured.state.pieces).toEqual([]);
    expect(captured.state.grain[side]).toBe(30);
    expect(captured.events.map((event) => event.type)).toEqual([
      "capture",
      "move",
      "expire",
      "income",
    ]);
    const winState = {
      ...createGame(),
      turn: side,
      ply: 199,
      consecutivePasses: 5,
      pieces: [
        piece("winner", "carver", side, q(36), 1),
        piece("support", "link", side, q(14), 1),
      ],
    };
    const win = next(winState, { type: "move", pieceId: "winner", to: q(45) });
    expect(win.state.outcome).toEqual({ kind: "win", winner: side });
    expect(win.state.pieces.every((p) => p.remaining === 1)).toBe(true);
    expect(win.events.map((event) => event.type)).toEqual(["move", "finish"]);
    expect(outcomeNotice(win.state.outcome)).toContain("勝利");
    expect(win.state.ply).toBe(200);
  }
});

it("C14 — normal CPU reply uses the actual strategy and commits exactly once from a core-only start", async () => {
  const c = controller();
  expect(c.getState().pieces).toEqual([]);
  await c.submit(
    { type: "summon", kind: "link", duration: 2, to: 14 },
    c.getToken(),
  );
  expect(FakeWorker.instances).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(299);
  expect(FakeWorker.instances).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  const worker = FakeWorker.instances[0];
  expect(worker.input).toEqual(c.getState());
  const action = chooseCpuAction(worker.input!)!;
  expect(isLegal(worker.input!, action)).toBe(true);
  const expected = next(worker.input!, action).state;
  worker.onmessage?.({ data: action });
  await flush();
  expect(c.getState()).toEqual(expected);
  expect(c.getBusy()).toBe(false);
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.onmessage?.({ data: action });
  worker.onerror?.();
  await vi.advanceTimersByTimeAsync(6500);
  expect(c.getState()).toEqual(expected);
  expect(vi.getTimerCount()).toBe(0);
});

it("C15 — timeout, malformed reply, worker error and absent worker recover to the same legal strategy", async () => {
  for (const failure of [
    "timeout",
    "invalid-zone",
    "null",
    "error",
    "absent",
    "constructor",
  ] as const) {
    if (failure === "absent") vi.stubGlobal("Worker", undefined);
    else if (failure === "constructor")
      vi.stubGlobal(
        "Worker",
        class {
          constructor() {
            throw Error("Worker unavailable");
          }
        },
      );
    else vi.stubGlobal("Worker", FakeWorker);
    const c = controller();
    await c.submit(
      { type: "summon", kind: "bastion", duration: 1, to: 20 },
      c.getToken(),
    );
    const before = c.getState();
    const expected = next(before, chooseCpuAction(before)!).state;
    await vi.advanceTimersByTimeAsync(300);
    const worker = FakeWorker.instances.at(-1);
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(6000);
    else if (failure === "error") worker!.onerror?.();
    else if (failure === "null") worker!.onmessage?.({ data: null });
    else if (failure === "invalid-zone")
      worker!.onmessage?.({
        data: { type: "summon", kind: "carver", duration: 1, to: 21 },
      });
    await flush();
    expect(c.getState(), failure).toEqual(expected);
    expect(c.getBusy(), failure).toBe(false);
    expect(vi.getTimerCount(), failure).toBe(0);
    c.dispose();
  }
});

it("C16 — repeated CPU pause/resume rejects old generations and restarts one unfinished search", async () => {
  const c = controller();
  await c.submit(
    { type: "summon", kind: "carver", duration: 2, to: 14 },
    c.getToken(),
  );
  const position = c.getState();
  for (let round = 0; round < 4; round++) {
    await vi.advanceTimersByTimeAsync(300);
    const old = FakeWorker.instances.at(-1)!;
    const oldToken = c.getToken();
    c.pause();
    c.pause();
    expect(old.terminate).toHaveBeenCalledOnce();
    old.onmessage?.({ data: { type: "pass" } });
    old.onerror?.();
    await vi.advanceTimersByTimeAsync(9000);
    expect(c.getState()).toBe(position);
    expect(await c.submit({ type: "pass" }, oldToken)).toBe(false);
    expect(await c.submit({ type: "pass" }, c.getToken())).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    c.resume();
    c.resume();
    expect(vi.getTimerCount()).toBe(1);
  }
  await vi.advanceTimersByTimeAsync(300);
  const active = FakeWorker.instances.at(-1)!;
  active.onmessage?.({ data: chooseCpuAction(position) });
  await flush();
  expect(c.getState().turn).toBe("white");
  expect(c.getState().ply).toBe(2);
  expect(FakeWorker.instances).toHaveLength(5);
  expect(
    FakeWorker.instances.every((w) => w.terminate.mock.calls.length === 1),
  ).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("C17 — a 200-ply controller session conserves grain and resources through 100 CPU handoffs", async () => {
  // A deterministic nonterminal deployment script exercises session duration, not CPU playing strength.
  const c = controller();
  let retired: FakeWorker | undefined;
  for (let round = 0; round < 100; round++) {
    const humanSquare = round % 2 === 0 ? 0 : 1;
    expect(
      await c.submit(
        { type: "summon", kind: "bastion", duration: 1, to: humanSquare },
        c.getToken(),
      ),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    const worker = FakeWorker.instances.at(-1)!;
    retired?.onmessage?.({ data: { type: "pass" } });
    expect(worker.terminate).not.toHaveBeenCalled();
    const action: Action = {
      type: "summon",
      kind: "bastion",
      duration: 1,
      to: round % 2 === 0 ? 48 : 47,
    };
    expect(isLegal(worker.input!, action)).toBe(true);
    worker.onmessage?.({ data: action });
    await flush();
    const s = c.getState();
    expect(s.ply).toBe((round + 1) * 2);
    expect(s.pieces).toHaveLength(2);
    expect(s.pieces.every((p) => p.remaining === 1)).toBe(true);
    expect(s.grain.black).toBe(12 + (round + 1) * 3);
    expect(s.grain.white).toBe(16 + (round + 1) * 3 - (round === 99 ? 4 : 0));
    expect(validState(s)).toBe(true);
    expect(c.getBusy()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    retired = worker;
  }
  expect(c.getState().outcome).toEqual({ kind: "draw", reason: "limit" });
  expect(await c.submit({ type: "pass" }, c.getToken())).toBe(false);
  expect(FakeWorker.instances).toHaveLength(100);
  expect(
    FakeWorker.instances.every(
      (worker) => worker.terminate.mock.calls.length === 1,
    ),
  ).toBe(true);
  c.restart("cpu");
  retired!.onmessage?.({ data: { type: "pass" } });
  expect(c.getState()).toEqual(createGame());
});

it("C18 — capture/expiry motion superseded by a summon settles authoritative pieces on backgrounding", async () => {
  for (const mode of ["2d", "3d"] as const) {
    const element = host();
    const board =
      mode === "2d"
        ? createBoard2D(element, () => {})
        : createBoard3D(
            element,
            () => {},
            () => {
              throw Error("Unexpected renderer failure");
            },
          );
    boards.push(board);
    const before: GameState = {
      ...createGame(),
      pieces: [
        piece("mover", "leaper", "white", 23, 1),
        piece("pad", "link", "white", 24, 1),
        piece("victim", "carver", "black", 25, 3),
      ],
    };
    board.render(before, sel, null);
    const captured = next(before, { type: "move", pieceId: "mover", to: 25 });
    board.render(captured.state, sel, null, {
      before,
      events: captured.events,
    });
    tick(now + 100);
    const stale = [...frames.values()][0];
    const summoned = next(captured.state, {
      type: "summon",
      kind: "leaper",
      duration: 3,
      to: 28,
    });
    board.render(summoned.state, sel, null, {
      before: captured.state,
      events: summoned.events,
    });
    const count = gpu.render.mock.calls.length;
    stale(now + 300);
    expect(gpu.render.mock.calls.length).toBe(count);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1000);
    board.render(structuredClone(summoned.state), sel, null);
    expect(
      element.querySelectorAll(
        "[data-effect], [data-moving-piece], .motion-hidden",
      ),
    ).toHaveLength(0);
    expect(
      element.querySelector('[data-square="28"]')?.getAttribute("aria-label"),
    ).toContain("黒 リーパー 残り3ターン");
    expect(
      element.querySelector('[data-square="25"]')?.getAttribute("aria-label"),
    ).toContain("空き");
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    board.dispose();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  }
});

it("C19 — failed live rendering releases owned scene resources and preserves the proposal in 2D", () => {
  const element = host();
  let status = "";
  const board = createAdaptiveBoard(
    element,
    () => {},
    (failed) => createBoard3D(element, () => {}, failed),
    (value) => {
      status = value;
    },
  );
  boards.push(board);
  const before: GameState = {
    ...createGame(),
    pieces: [piece("mover", "carver", "white", 14, 3)],
  };
  const proposal: Action = { type: "move", pieceId: "mover", to: 23 };
  const selection = { pieceId: "mover", candidate: proposal };
  const preview = previewAction(before, proposal)!;
  expect(preview).not.toBeNull();
  board.render(before, selection, preview);
  const owned = resources(gpu.scene as THREE.Scene);
  const disposal = owned.map((resource) => vi.spyOn(resource, "dispose"));
  const oldCanvas = element.querySelector("canvas")!;
  gpu.render.mockImplementationOnce(() => {
    throw Error("Injected rendering loss");
  });
  board.render(before, selection, preview);
  expect(status).toContain("2D");
  expect(element.querySelectorAll(".board-grid [data-square]")).toHaveLength(
    49,
  );
  expect(
    element
      .querySelector('[data-square="23"]')
      ?.classList.contains("candidate"),
  ).toBe(true);
  expect(
    element.querySelector('[data-square="14"]')?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(disposal.every((release) => release.mock.calls.length === 1)).toBe(
    true,
  );
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(gpu.disconnect).toHaveBeenCalledOnce();
  oldCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("C20 — bilateral models keep side/type/lifetime semantics and keyboard inspection after replacement", () => {
  const realNames = ["bastion", "carver", "leaper", "link"] as const;
  for (const renderer of ["2d", "3d"] as const) {
    const element = host();
    const clicked = vi.fn();
    const board =
      renderer === "2d"
        ? createBoard2D(element, clicked)
        : createBoard3D(element, clicked, () => {
            throw Error("Unexpected renderer failure");
          });
    boards.push(board);
    const pieces = (["white", "black"] as const).flatMap((side, sideIndex) =>
      realNames.map((kind, index) =>
        piece(
          `${side}:${kind}`,
          kind,
          side,
          (sideIndex ? 28 : 14) + index,
          index + 1,
        ),
      ),
    );
    const state = { ...createGame(), pieces };
    board.render(state, { pieceId: "black:carver", candidate: null }, null);
    for (const p of pieces) {
      const square = element.querySelector<HTMLButtonElement>(
        `[data-square="${p.square}"]`,
      )!;
      expect(square.getAttribute("aria-label")).toContain(
        `${p.side === "white" ? "白" : "黒"} ${INFO[p.kind].name} 残り${p.remaining}ターン`,
      );
      expect(
        renderer === "2d"
          ? square.querySelector(".piece-mark")?.textContent
          : element.querySelector(`[data-mark-for="${p.id}"]`)?.textContent,
      ).toBe(PIECE_MARK[p.kind]);
    }
    const references = boardTargets(state, {
      pieceId: "black:carver",
      candidate: null,
    });
    expect(references.targets.size).toBeGreaterThan(0);
    expect(element.querySelectorAll('[data-available="true"]')).toHaveLength(0);
    for (const q of references.targets)
      expect(
        element
          .querySelector(`[data-square="${q}"]`)
          ?.getAttribute("aria-label"),
      ).toContain("参考（操作できません）");
    const first =
      element.querySelector<HTMLButtonElement>('[data-square="0"]')!;
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    const focus =
      element.querySelector<HTMLButtonElement>('[data-square="7"]')!;
    expect(document.activeElement).toBe(focus);
    expect(element.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    const priorModel =
      renderer === "3d"
        ? (gpu.scene as THREE.Scene).getObjectByName("piece:black:carver")!
        : null;
    const oldResources = priorModel
      ? resources(priorModel).map((resource) => vi.spyOn(resource, "dispose"))
      : [];
    const changed = {
      ...state,
      pieces: pieces.map((p) =>
        p.id === "black:carver"
          ? { ...p, kind: "link" as const, remaining: 5 }
          : p,
      ),
    };
    board.render(changed, sel, null);
    expect(document.activeElement).toBe(focus);
    expect(
      element.querySelector('[data-square="29"]')?.getAttribute("aria-label"),
    ).toContain("黒 リンク 残り5ターン");
    expect(element.querySelectorAll(".inspect-target")).toHaveLength(0);
    if (renderer === "3d") {
      const replacement = (gpu.scene as THREE.Scene).getObjectByName(
        "piece:black:carver",
      )!;
      expect(replacement).not.toBe(priorModel);
      expect(replacement.getObjectByName("ring-a")).toBeDefined();
      expect(replacement.getObjectByName("curved-blade")).toBeUndefined();
      expect(
        oldResources.every((release) => release.mock.calls.length === 1),
      ).toBe(true);
    }
    focus.click();
    expect(clicked).toHaveBeenCalledWith(7);
  }
});
