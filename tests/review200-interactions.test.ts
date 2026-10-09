// @vitest-environment jsdom
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { Controller } from "../src/app/controller";
import type { Action, GameState, Kind, Piece } from "../src/game/types";

// R200-I001..050: real UI/controller/rules. Only initial fixture, Worker and time are injected.
// These are 50 automated semantic scenarios, not 50 human/device playtests.
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
const click = (id: string) => {
  const button = el<HTMLButtonElement>(id);
  expect(
    button.closest("[hidden]"),
    `${id} must be visible in the scenario`,
  ).toBeNull();
  expect(button.disabled, `${id} must be enabled in the scenario`).toBe(false);
  button.click();
};
const square = (q: number) =>
  document.querySelector<HTMLButtonElement>(`[data-square="${q}"]`)!;
const flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
let controller: Controller;
let listeners: [string, EventListenerOrEventListenerObject][] = [];
let workers: W[] = [];
let workerFailure = "";
class W {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  postMessage = vi.fn(() => {
    if (workerFailure === "post") throw Error("worker send failed");
  });
  terminate = vi.fn();
  constructor() {
    if (workerFailure === "construct") throw Error("worker unavailable");
    workers.push(this);
  }
}
const p = (
  id: string,
  kind: Kind,
  square: number,
  remaining = 3,
  side: "white" | "black" = "white",
): Piece => ({ id, kind, square, remaining, side, summonedPly: 0 });
const fixture = (
  pieces: Piece[] = [],
  extra: Partial<GameState> = {},
): GameState => ({
  pieces,
  cores: { white: 3, black: 45 },
  grain: { white: 20, black: 20 },
  turn: "white",
  ply: 20,
  consecutivePasses: 0,
  outcome: null,
  ...extra,
});
async function boot(initial?: GameState, mode: "local" | "cpu" = "local") {
  vi.resetModules();
  vi.doMock("../src/app/controller", async () => {
    const actual = await vi.importActual<
      typeof import("../src/app/controller")
    >("../src/app/controller");
    return {
      ...actual,
      createController(callback: (s: GameState) => void) {
        controller = actual.createController(callback);
        return controller;
      },
    };
  });
  if (initial)
    vi.doMock("../src/game/engine", async () => {
      const actual =
        await vi.importActual<typeof import("../src/game/engine")>(
          "../src/game/engine",
        );
      return { ...actual, createGame: () => structuredClone(initial) };
    });
  else vi.doUnmock("../src/game/engine");
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  await import("../src/main");
  click(`choose-${mode}`);
  click("start-game");
  await flush();
}
function propose(action: Action) {
  if (action.type === "pass") click("pass");
  else if (action.type === "summon") {
    click("summon");
    document
      .querySelector<HTMLButtonElement>(`[data-kind="${action.kind}"]`)!
      .click();
    while (Number(el("duration").textContent) < action.duration) click("plus");
    while (Number(el("duration").textContent) > action.duration) click("minus");
    square(action.to).click();
  } else {
    square(
      controller.getState().pieces.find((p) => p.id === action.pieceId)!.square,
    ).click();
    square(
      action.type === "move"
        ? action.to
        : controller.getState().pieces.find((p) => p.id === action.allyId)!
            .square,
    ).click();
  }
}
const cases: Record<string, unknown>[] = [];
function scenario(
  category: string,
  persona: string,
  task: string,
  precondition: string,
  sequence: string[],
  assertion: string,
  run: () => Promise<void>,
) {
  const id = `R200-I${String(cases.length + 1).padStart(3, "0")}`;
  const row = {
    id,
    category,
    persona,
    task,
    precondition,
    sequence,
    assertion,
    observations: "not run",
    changeOrNoChange: "awaiting execution",
    retest: "not run",
    limitations:
      "Automated jsdom + real controller/engine; fixture initialization, Worker and time injected. No actual phone, screen reader, GPU, browser layout, or CPU device-performance evidence.",
  };
  cases.push(row);
  it(`${id}: ${task}`, async () => {
    try {
      await run();
      row.observations = "All assertions passed against the prepared source.";
      row.changeOrNoChange = "No production change justified by this scenario.";
      row.retest = "pass";
    } catch (error) {
      row.observations = String(error);
      row.changeOrNoChange = "Failure requires product/fixture classification.";
      row.retest = "fail";
      throw error;
    }
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  workers = [];
  workerFailure = "";
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = "";
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (name, listener, options) => {
      listeners.push([name, listener]);
      add(name, listener, options);
    },
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("Worker", W);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("No network permitted in interaction scenarios");
    }),
  );
});
afterEach(() => {
  controller?.dispose();
  for (const [name, listener] of listeners)
    document.removeEventListener(name, listener);
  listeners = [];
  vi.doUnmock("../src/app/controller");
  vi.doUnmock("../src/game/engine");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = "";
});
afterAll(() => {
  expect(cases).toHaveLength(50);
  writeFileSync(
    join(tmpdir(), "interval-review200-interaction-results.json"),
    JSON.stringify(cases, null, 2),
  );
});

type PreviewCase = {
  name: string;
  s: GameState;
  a: Action;
  cost: number;
  reward: number;
  expires: string[];
  notice?: string;
  at?: number;
  kind?: Kind;
  life?: number;
  outcome?: "win" | "draw";
};
const previews: PreviewCase[] = [
  {
    name: "new contract while an unrelated allied wall expires",
    s: fixture([p("old", "bastion", 7, 1)]),
    a: { type: "summon", kind: "carver", to: 14, duration: 2 },
    cost: 6,
    reward: 0,
    expires: ["old"],
    at: 14,
    kind: "carver",
    life: 2,
  },
  {
    name: "last-turn defender replaced by a paid blocking wall",
    s: fixture([
      p("old", "bastion", 0, 1),
      p("enemy", "carver", 11, 4, "black"),
    ]),
    a: { type: "summon", kind: "bastion", to: 4, duration: 3 },
    cost: 3,
    reward: 0,
    expires: ["old"],
    at: 4,
    kind: "bastion",
    life: 3,
    notice: "注意",
  },
  {
    name: "cheap summon leaves a two-path core attack visible",
    s: fixture([p("enemy", "carver", 11, 4, "black")]),
    a: { type: "summon", kind: "link", to: 14, duration: 2 },
    cost: 2,
    reward: 0,
    expires: [],
    at: 14,
    kind: "link",
    life: 2,
    notice: "注意",
  },
  {
    name: "capture reward survives the mover's own expiry",
    s: fixture([p("m", "carver", 9, 1), p("v", "leaper", 17, 4, "black")]),
    a: { type: "move", pieceId: "m", to: 17 },
    cost: 0,
    reward: 8,
    expires: ["m"],
  },
  {
    name: "capture preserves a two-turn moving contract",
    s: fixture([p("m", "carver", 9, 3), p("v", "link", 17, 5, "black")]),
    a: { type: "move", pieceId: "m", to: 17 },
    cost: 0,
    reward: 5,
    expires: [],
    at: 17,
    kind: "carver",
    life: 2,
  },
  {
    name: "enemy bridge leap captures only the destination",
    s: fixture([
      p("m", "leaper", 9, 3),
      p("bridge", "bastion", 16, 5, "black"),
      p("v", "carver", 23, 2, "black"),
    ]),
    a: { type: "move", pieceId: "m", to: 23 },
    cost: 0,
    reward: 6,
    expires: [],
    at: 23,
    kind: "leaper",
    life: 2,
  },
  {
    name: "swap moves a last-turn link before retiring it",
    s: fixture([p("m", "link", 9, 1), p("ally", "carver", 10, 3)]),
    a: { type: "swap", pieceId: "m", allyId: "ally" },
    cost: 0,
    reward: 0,
    expires: ["m"],
    at: 9,
    kind: "carver",
    life: 2,
  },
  {
    name: "swap partner retires at its relocated square",
    s: fixture([p("m", "link", 9, 3), p("ally", "bastion", 10, 1)]),
    a: { type: "swap", pieceId: "m", allyId: "ally" },
    cost: 0,
    reward: 0,
    expires: ["ally"],
    at: 10,
    kind: "link",
    life: 2,
  },
  {
    name: "last-turn capture of the core takes precedence over expiry",
    s: fixture([p("m", "carver", 37, 1)]),
    a: { type: "move", pieceId: "m", to: 45 },
    cost: 0,
    reward: 0,
    expires: [],
    at: 45,
    kind: "carver",
    life: 1,
    outcome: "win",
    notice: "勝利",
  },
  {
    name: "pass expires both own contracts but not the enemy",
    s: fixture([
      p("a", "bastion", 7, 1),
      p("b", "link", 8, 1),
      p("enemy", "carver", 39, 1, "black"),
    ]),
    a: { type: "pass" },
    cost: 0,
    reward: 0,
    expires: ["a", "b"],
  },
  {
    name: "sixth pass draw includes same-turn expiry",
    s: fixture([p("a", "leaper", 7, 1)], { consecutivePasses: 5 }),
    a: { type: "pass" },
    cost: 0,
    reward: 0,
    expires: ["a"],
    outcome: "draw",
    notice: "6回連続",
  },
  {
    name: "limit draw retains capture proceeds and expiry",
    s: fixture([p("m", "carver", 9, 1), p("v", "bastion", 17, 5, "black")], {
      ply: 199,
    }),
    a: { type: "move", pieceId: "m", to: 17 },
    cost: 0,
    reward: 5,
    expires: ["m"],
    outcome: "draw",
    notice: "200手",
  },
  {
    name: "last legal summon purchases its exact contract at the limit",
    s: fixture([p("old", "link", 9, 1)], { ply: 199 }),
    a: { type: "summon", kind: "leaper", to: 14, duration: 5 },
    cost: 10,
    reward: 0,
    expires: ["old"],
    at: 14,
    kind: "leaper",
    life: 5,
    outcome: "draw",
    notice: "200手",
  },
  {
    name: "moving a defender exposes the core after shared simulation",
    s: fixture([
      p("m", "carver", 4, 3),
      p("block", "bastion", 10, 4),
      p("enemy", "carver", 11, 3, "black"),
    ]),
    a: { type: "move", pieceId: "m", to: 12 },
    cost: 0,
    reward: 0,
    expires: [],
    at: 12,
    kind: "carver",
    life: 2,
    notice: "注意",
  },
  {
    name: "capturing the only attacker clears the tactical warning",
    s: fixture([p("m", "carver", 19, 4), p("enemy", "carver", 11, 4, "black")]),
    a: { type: "move", pieceId: "m", to: 11 },
    cost: 0,
    reward: 12,
    expires: [],
    at: 11,
    kind: "carver",
    life: 3,
  },
];
for (const f of previews)
  for (const interruption of ["compare", "settings"] as const) {
    scenario(
      "shared simulation and interrupted decision",
      interruption === "compare"
        ? "Strategy player comparing alternatives"
        : "Mobile player using reduced-motion controls",
      `${f.name}: ${interruption === "compare" ? "replace pass and rebuild proposal" : "keep preview through quality/motion changes"}`,
      `Fixture ply ${f.s.ply}; ${JSON.stringify(f.s.pieces)}; grain20 each`,
      [
        "Start explicitly in local mode on the stated position",
        `Propose ${JSON.stringify(f.a)}`,
        interruption === "compare"
          ? "Back, visibly cancel the current selection, prepare Pass, Back, rebuild the original action"
          : "Open menu, toggle quality and reduced motion, close menu",
        "Check exact preview/feedback without changing state",
        "Confirm twice synchronously; settle microtasks",
      ],
      `One action only; cost${f.cost}, reward${f.reward}, expires${JSON.stringify(f.expires)}; all rules and state preserved across preview`,
      async () => {
        await boot(f.s);
        const before = structuredClone(controller.getState());
        propose(f.a);
        expect(el("confirm-row").hidden).toBe(false);
        if (interruption === "compare") {
          click("back");
          if (!el("cancel").hidden) click("cancel");
          click("pass");
          click("back");
          propose(f.a);
        } else {
          click("menu");
          click("quality");
          click("motion");
          click("close-menu");
        }
        expect(controller.getState()).toEqual(before);
        expect(el("confirm-row").hidden).toBe(false);
        const numbers = [...el("summary").querySelectorAll("b")].map((b) =>
          Number(b.textContent),
        );
        expect(numbers.slice(0, 3)).toEqual([
          f.cost,
          f.reward,
          20 - f.cost + f.reward,
        ]);
        if (f.expires.length)
          expect(el("summary").textContent).toContain(
            `${f.expires.length} 体が退場`,
          );
        else expect(el("summary").textContent).toContain("退場なし");
        if (f.notice)
          expect(el("tactical-note").textContent).toContain(f.notice);
        else expect(el("tactical-note").hidden).toBe(true);
        click("confirm");
        // Inject duplicate input defensively; it is not a second visible click.
        el("confirm").click();
        await flush();
        const after = controller.getState();
        expect(after.ply).toBe(before.ply + 1);
        expect(after.grain.white).toBe(20 - f.cost + f.reward);
        expect(after.grain.black).toBe(f.outcome ? 20 : 24);
        expect(after.outcome?.kind ?? null).toBe(f.outcome ?? null);
        if (f.outcome === "win")
          expect(after.outcome).toEqual({ kind: "win", winner: "white" });
        if (f.outcome === "draw")
          expect(after.outcome).toEqual({
            kind: "draw",
            reason: f.s.ply === 199 ? "limit" : "passes",
          });
        if (f.reward) {
          const action = f.a;
          const captured =
            action.type === "move"
              ? before.pieces.find((p) => p.square === action.to)
              : undefined;
          expect(captured).toBeDefined();
          expect(after.pieces.some((p) => p.id === captured!.id)).toBe(false);
        }
        for (const enemy of before.pieces.filter((p) => p.side === "black")) {
          if (f.a.type === "move" && enemy.square === f.a.to) continue;
          expect(after.pieces.find((p) => p.id === enemy.id)).toEqual(enemy);
        }
        for (const id of f.expires)
          expect(after.pieces.some((p) => p.id === id)).toBe(false);
        if (f.at !== undefined) {
          const piece = after.pieces.find((p) => p.square === f.at);
          expect(piece?.kind).toBe(f.kind);
          expect(piece?.remaining).toBe(f.life);
        }
        expect(el("confirm-row").hidden).toBe(true);
        expect(document.querySelector(".ghost-piece")).toBeNull();
        expect(controller.getBusy()).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
      },
    );
  }

const faults = [
  { name: "Worker constructor denial", kind: "construct", payload: null },
  {
    name: "Worker postMessage structured-clone failure",
    kind: "post",
    payload: null,
  },
  { name: "missing message data", kind: "message", payload: undefined },
  { name: "array instead of action", kind: "message", payload: [] },
  {
    name: "unknown action discriminator",
    kind: "message",
    payload: { type: "castle" },
  },
  {
    name: "expired or absent mover identifier",
    kind: "message",
    payload: { type: "move", pieceId: "missing", to: 14 },
  },
  {
    name: "attempt to move the human piece",
    kind: "message",
    payload: { type: "move", pieceId: "white-0-14", to: 22 },
  },
  {
    name: "central-rank summon",
    kind: "message",
    payload: { type: "summon", kind: "bastion", to: 24, duration: 1 },
  },
  {
    name: "out-of-contract duration",
    kind: "message",
    payload: { type: "summon", kind: "carver", to: 28, duration: 6 },
  },
  {
    name: "timeout followed by late error and legal reply",
    kind: "timeout",
    payload: { type: "pass" },
  },
];
for (const fault of faults)
  for (const interrupted of [false, true]) {
    scenario(
      "CPU failure and state generations",
      interrupted
        ? "Long-session player returning after a pause"
        : "Novice waiting for their first CPU reply",
      `${fault.name} ${interrupted ? "after pause/resume and a stale worker failure" : "while inspecting a one-turn human contract"}`,
      "Fresh explicit CPU match; human Carver1 on square14",
      [
        "Start CPU and purchase Carver1",
        interrupted
          ? "Create worker; Home; stale error/reply; Resume"
          : "Inspect human piece before worker reply",
        `Deliver ${fault.name}`,
        "After recovery inject extra old error/reply; wait past timeout",
        "Human Pass and verify normal next turn",
      ],
      "One current CPU action completes, old messages cannot advance it again, UI unlocks and no timer/Worker accumulation survives Home",
      async () => {
        await boot(undefined, "cpu");
        propose({ type: "summon", kind: "carver", to: 14, duration: 1 });
        click("confirm");
        await flush();
        expect(controller.getState().ply).toBe(1);
        expect(controller.getBusy()).toBe(true);
        if (interrupted) {
          await vi.advanceTimersByTimeAsync(301);
          const old = workers[0];
          click("home-button");
          old.onerror?.();
          old.onmessage?.({ data: { type: "pass" } });
          await flush();
          expect(controller.getState().ply).toBe(1);
          expect(old.terminate).toHaveBeenCalledTimes(1);
          click("resume-game");
        } else {
          square(14).click();
          expect(el("summary").textContent).toContain("操作できません");
        }
        workerFailure = fault.kind;
        await vi.advanceTimersByTimeAsync(301);
        const current = workers.at(-1);
        if (fault.kind === "message")
          current!.onmessage?.({ data: fault.payload });
        if (fault.kind === "timeout") await vi.advanceTimersByTimeAsync(6001);
        await flush();
        expect(controller.getState().ply).toBe(2);
        expect(controller.getState().turn).toBe("white");
        expect(controller.getBusy()).toBe(false);
        const once = structuredClone(controller.getState());
        current?.onerror?.();
        current?.onmessage?.({ data: { type: "pass" } });
        await vi.advanceTimersByTimeAsync(7000);
        await flush();
        expect(controller.getState()).toEqual(once);
        expect(el<HTMLButtonElement>("pass").disabled).toBe(false);
        click("pass");
        click("confirm");
        await flush();
        expect(controller.getState().ply).toBe(3);
        expect(
          controller.getState().pieces.some((p) => p.id === "white-0-14"),
        ).toBe(false);
        click("home-button");
        await vi.advanceTimersByTimeAsync(7000);
        expect(controller.getState().ply).toBe(3);
        expect(workers.every((w) => w.terminate.mock.calls.length === 1)).toBe(
          true,
        );
        expect(fetch).not.toHaveBeenCalled();
      },
    );
  }
