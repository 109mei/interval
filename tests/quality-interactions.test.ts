// @vitest-environment jsdom
import { afterEach, beforeEach, expect, vi } from "vitest";
import { createController } from "../src/app/controller";
import { createOnline, type RoomView } from "../src/app/online";
import { applyAction, createGame } from "../src/game/engine";
import type { Action, Kind, Side } from "../src/game/types";
import { createCaseLedger } from "./quality/case-ledger";
import {
  interactionCases,
  kindPrices,
  kindNames,
  type InteractionInput,
} from "./quality/interaction-cases";

const { registerCase } = createCaseLedger("interactions");
let documentListeners: [string, EventListenerOrEventListenerObject][] = [];
const controllers: ReturnType<typeof createController>[] = [];
const networks: ReturnType<typeof createOnline>[] = [];
const el = (id: string) => document.getElementById(id)!;
const button = (id: string) => el(id) as HTMLButtonElement;
const square = (n: number) =>
  document.querySelector<HTMLButtonElement>(`[data-square="${n}"]`)!;
const click = (selector: string) =>
  document.querySelector<HTMLButtonElement>(selector)!.click();
const name = (n: number) =>
  `${String.fromCharCode(97 + (n % 7))}${Math.floor(n / 7) + 1}`;
const owner = (side: Side) => (side === "white" ? "白" : "黒");
const otherKind: Record<Kind, Kind> = {
  bastion: "carver",
  carver: "leaper",
  leaper: "link",
  link: "bastion",
};
async function flush() {
  for (let i = 0; i < 24; i++) await Promise.resolve();
}
async function boot(path = "/?2d") {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  document.body.className = "";
  history.replaceState(null, "", path);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
  await flush();
}
async function commit() {
  click("#confirm");
  await flush();
}
async function pass() {
  click("#pass");
  await commit();
}
async function turn(side: Side) {
  if (side === "black") await pass();
}
function choose(kind: Kind, duration: number) {
  click("#summon");
  click(`[data-kind="${kind}"]`);
  while (Number(el("duration").textContent) > duration) click("#minus");
  while (Number(el("duration").textContent) < duration) click("#plus");
}
const target = (side: Side) => (side === "white" ? 9 : 39);
const alternative = (side: Side) => (side === "white" ? 8 : 40);
function numbers() {
  return [...el("summary").querySelectorAll(".preview-numbers b")].map((x) =>
    Number(x.textContent),
  );
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function room(side: Side, op = "action", version = 7): RoomView {
  const state = createGame();
  state.turn = side;
  state.grain = { white: 16, black: 16 };
  return {
    id: "a".repeat(32),
    seat: side,
    version,
    status: op === "ready" ? "waiting" : "playing",
    expiresAt: Date.now() + 86400000,
    joined: true,
    ready: { white: false, black: false },
    state,
    ...(side === "white" ? { invite: "b".repeat(64) } : {}),
  };
}
function network() {
  const n = createOnline(() => {});
  networks.push(n);
  return n;
}
function controller() {
  const c = createController(() => {});
  controllers.push(c);
  return c;
}
async function send(
  n: ReturnType<typeof createOnline>,
  op: "action" | "ready" | "leave",
) {
  return op === "action"
    ? n.submit({
        type: "summon",
        kind: "carver",
        duration: 2,
        to: n.room?.seat === "black" ? 39 : 9,
      })
    : op === "ready"
      ? n.ready()
      : n.leave();
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  documentListeners = [];
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type, listener, options) => {
      documentListeners.push([type, listener]);
      add(type, listener, options);
    },
  );
});
afterEach(() => {
  controllers.splice(0).forEach((c) => c.dispose());
  networks.splice(0).forEach((n) => n.dispose());
  for (const [type, listener] of documentListeners)
    document.removeEventListener(type, listener);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = "";
});
async function purchase(i: InteractionInput) {
  const side = i.side!,
    kind = i.kind!,
    duration = i.duration!;
  await boot();
  await turn(side);
  choose(kind, duration);
  let finalTarget = target(side),
    finalKind = kind;
  square(finalTarget).click();
  expect(el("hint").textContent).toContain(
    `${name(finalTarget)}に${kindNames[kind]}`,
  );
  expect(numbers()).toEqual([
    kindPrices[kind] * duration,
    0,
    16 - kindPrices[kind] * duration,
  ]);
  expect(el("summary").textContent).toContain(`期間${duration}回`);
  expect(el(`${side}-grain`).textContent).toBe("16");
  expect(el("ply").textContent).toBe(`${side === "white" ? 0 : 1} / 200 手`);
  if (i.flow === "rules-interruption") {
    click("#menu");
    expect(el("drawer").hasAttribute("open")).toBe(true);
    click("#close-menu");
    expect(el("confirm-row").hidden).toBe(false);
  }
  if (i.flow === "back-retarget") {
    click("#back");
    expect(document.querySelector(".ghost-piece")).toBeNull();
    expect(el("duration").textContent).toBe(String(duration));
    finalTarget = alternative(side);
    square(finalTarget).click();
  }
  if (i.flow === "change-kind") {
    click("#back");
    finalKind = otherKind[kind];
    click(`[data-kind="${finalKind}"]`);
    expect(el("duration").textContent).toBe(String(duration));
    square(finalTarget).click();
  }
  if (i.flow === "cancel-reenter") {
    click("#cancel");
    expect(el("confirm-row").hidden).toBe(true);
    expect(document.querySelector(".ghost-piece")).toBeNull();
    expect(el(`${side}-grain`).textContent).toBe("16");
    choose(kind, duration);
    finalTarget = alternative(side);
    square(finalTarget).click();
  }
  expect(numbers()).toEqual([
    kindPrices[finalKind] * duration,
    0,
    16 - kindPrices[finalKind] * duration,
  ]);
  await commit();
  click("#confirm");
  await flush();
  expect(el(`${side}-grain`).textContent).toBe(
    String(16 - kindPrices[finalKind] * duration),
  );
  expect(el("ply").textContent).toBe(`${side === "white" ? 1 : 2} / 200 手`);
  expect(square(finalTarget).getAttribute("aria-label")).toContain(
    `${owner(side)} ${kindNames[finalKind]} 残り${duration}回`,
  );
  expect(square(finalTarget).querySelector(".life")?.textContent).toBe(
    String(duration),
  );
  expect(document.querySelector(".ghost-piece")).toBeNull();
  expect(el("confirm-row").hidden).toBe(true);
}
async function invalidTarget(i: InteractionInput) {
  const side = i.side!,
    kind = i.kind!,
    duration = i.duration!;
  await boot();
  await turn(side);
  choose(kind, duration);
  square(target(side)).click();
  const whiteInvalid =
    i.invalid === "own-core" ? 3 : i.invalid === "occupied-wall" ? 10 : 14;
  square(side === "white" ? whiteInvalid : 48 - whiteInvalid).click();
  expect(el("confirm-row").hidden).toBe(true);
  expect(button("confirm").disabled).toBe(true);
  expect(document.querySelector(".ghost-piece")).toBeNull();
  expect(el("duration").textContent).toBe(String(duration));
  expect(el("kind-label").textContent).toBe(kindNames[kind]);
  expect(el(`${side}-grain`).textContent).toBe("16");
  expect(el("hint").textContent).toContain("自陣の空きマス");
  expect(document.querySelectorAll(".target")).toHaveLength(12);
  square(alternative(side)).click();
  expect(numbers()).toEqual([
    kindPrices[kind] * duration,
    0,
    16 - kindPrices[kind] * duration,
  ]);
  await commit();
  expect(square(alternative(side)).querySelector(".life")?.textContent).toBe(
    String(duration),
  );
  expect(el(`${side}-grain`).textContent).toBe(
    String(16 - kindPrices[kind] * duration),
  );
}
async function inspect(i: InteractionInput) {
  const side = i.side!,
    kind = i.kind!,
    duration = i.duration!;
  await boot();
  await turn(side);
  choose(kind, duration);
  square(target(side)).click();
  await commit();
  square(target(side)).click();
  expect(el("hint").textContent).toContain(
    `${owner(side)}の${kindNames[kind]} · 残り${duration}回`,
  );
  expect(el("summary").textContent).toContain("参考");
  expect(el("summary").textContent).toContain("今は操作できません");
  expect(document.querySelectorAll(".target")).toHaveLength(0);
  expect(el("confirm-row").hidden).toBe(true);
  const reference =
    document.querySelector<HTMLButtonElement>(".inspect-target");
  if (reference) {
    expect(reference.getAttribute("aria-label")).toContain("参考");
    reference.click();
    expect(el("confirm-row").hidden).toBe(true);
  }
  click("#cancel");
  await pass();
  square(target(side)).click();
  expect(el("hint").textContent).toContain(`残り${duration}回`);
  if (duration === 1)
    expect(el("summary").textContent).toContain(`この${owner(side)}の手番末`);
  expect(el("summary").textContent).not.toContain("今は操作できません");
}
async function transaction(i: InteractionInput) {
  const c = controller(),
    side = i.side!,
    kind = i.kind!,
    duration = i.duration!;
  if (side === "black")
    expect(await c.submit({ type: "pass" }, c.getToken())).toBe(true);
  const old = c.getToken(),
    purchase: Action = { type: "summon", kind, duration, to: target(side) },
    before = c.getState();
  if (i.flow === "duplicate")
    expect(
      await Promise.all([c.submit(purchase, old), c.submit(purchase, old)]),
    ).toEqual([true, false]);
  else {
    expect(await c.submit(purchase, old)).toBe(true);
    const committed = c.getState();
    if (i.flow === "stale-revision") {
      expect(await c.submit({ type: "pass" }, old)).toBe(false);
      expect(c.getState()).toBe(committed);
    } else {
      c.restart("local");
      const reset = c.getState();
      expect(await c.submit(purchase, old)).toBe(false);
      expect(c.getState()).toBe(reset);
      expect(c.getState().ply).toBe(0);
      expect(c.getState().grain.white).toBe(16);
      expect(
        await c.submit({ type: "summon", kind, duration, to: 9 }, c.getToken()),
      ).toBe(true);
      expect(c.getState().grain.white).toBe(16 - kindPrices[kind] * duration);
      expect(c.getBusy()).toBe(false);
      return;
    }
  }
  expect(c.getState().ply).toBe(before.ply + 1);
  expect(c.getState().grain[side]).toBe(16 - kindPrices[kind] * duration);
  expect(
    c.getState().pieces.filter((p) => p.square === target(side)),
  ).toMatchObject([{ kind, side, remaining: duration }]);
  expect(c.getBusy()).toBe(false);
}
async function display(i: InteractionInput) {
  await boot();
  if (i.context === "kind" || i.context === "candidate") {
    choose("carver", 2);
    if (i.context === "candidate") square(9).click();
  }
  if (i.context === "piece-info") square(10).click();
  if (i.context === "pass") click("#pass");
  const snapshot = () => [
    el("hint").textContent,
    el("summary").textContent,
    el("confirm-row").hidden,
    el("piece-picker").hidden,
    el("ply").textContent,
    el("white-grain").textContent,
  ];
  const initial = snapshot();
  click("#menu");
  click("#quality");
  if (!i.quality) click("#quality");
  click("#motion");
  if (!i.motion) click("#motion");
  click("#close-menu");
  expect(snapshot()).toEqual(initial);
  expect(button("quality").getAttribute("aria-pressed")).toBe(
    String(i.quality),
  );
  expect(button("motion").getAttribute("aria-pressed")).toBe(String(i.motion));
  expect(document.body.classList.contains("low-quality")).toBe(i.quality);
  expect(document.body.classList.contains("no-motion")).toBe(i.motion);
  expect(
    JSON.parse(localStorage.getItem("interval-display-preferences")!),
  ).toEqual({ quality: i.quality, motion: i.motion });
  expect(document.querySelectorAll("[data-square]")).toHaveLength(49);
}
async function keyboard(i: InteractionInput) {
  await boot();
  square(i.from!).focus();
  for (const key of i.keys!)
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  expect(document.activeElement).toBe(square(i.to!));
  expect(document.querySelectorAll('#board [tabindex="0"]')).toHaveLength(1);
  expect(el("ply").textContent).toBe("0 / 200 手");
  expect(el("white-grain").textContent).toBe("16");
  expect(el("confirm-row").hidden).toBe(true);
  expect(document.querySelector('[aria-pressed="true"]')).toBeNull();
}
async function rejection(i: InteractionInput) {
  const initial = room(i.side!, i.op),
    writes: string[] = [];
  let requests = 0;
  const status =
    i.code === "RATE_LIMIT"
      ? 429
      : i.code === "ROOM_EXPIRED"
        ? 410
        : i.code === "SESSION_REQUIRED"
          ? 401
          : ["NO_SEAT", "WRONG_TURN"].includes(i.code!)
            ? 403
            : i.code === "ILLEGAL_ACTION"
              ? 400
              : 409;
  const inaccessible = ["ROOM_EXPIRED", "NO_SEAT", "SESSION_REQUIRED"].includes(
    i.code!,
  );
  const latest: RoomView = {
    ...initial,
    version: 9,
    status:
      i.code === "ROOM_CLOSED"
        ? "closed"
        : i.code === "ALREADY_STARTED"
          ? "playing"
          : i.code === "NOT_STARTED"
            ? "waiting"
            : initial.status,
    state: {
      ...initial.state,
      turn:
        i.code === "WRONG_TURN"
          ? i.side === "white"
            ? "black"
            : "white"
          : initial.state.turn,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/api/session") return response({ ok: true });
      if (path.endsWith(`/${i.op}`)) {
        writes.push(String(init.body));
        return response({ error: i.code }, status);
      }
      requests++;
      if (requests > 1 && inaccessible)
        return response({ error: i.code }, status);
      return response(requests > 1 ? latest : initial);
    }),
  );
  const n = network();
  await n.resume(initial.id);
  expect(await send(n, i.op!)).toBe(false);
  expect(n.pending).toBe(false);
  expect(n.busy).toBe(false);
  expect(n.error.length).toBeGreaterThan(0);
  expect(n.room?.version).toBe(inaccessible ? 7 : 9);
  expect(writes).toHaveLength(1);
  expect(n.connected).toBe(!inaccessible);
  expect(n.unavailable).toBe(["ROOM_EXPIRED", "NO_SEAT"].includes(i.code!));
  if (!inaccessible) {
    expect(n.room?.status).toBe(latest.status);
    expect(n.room?.state.turn).toBe(latest.state.turn);
  }
  expect(sessionStorage.getItem(`interval-pending:${initial.id}`)).toBeNull();
  if (i.op === "ready" && i.code === "STALE_VERSION") {
    expect(n.error).toContain("準備状況");
    expect(n.error).not.toContain("盤面");
  }
  if (i.op === "action" && i.code === "STALE_VERSION")
    expect(n.error).toContain("盤面");
  const submitted = JSON.parse(writes[0]);
  expect(submitted.version).toBe(7);
  expect(typeof submitted.commandId).toBe("string");
}
async function receipt(i: InteractionInput) {
  const initial = room(i.side!, i.op),
    bodies: string[] = [],
    paths: string[] = [];
  let fail = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/api/session") return response({ ok: true });
      if (/\/(action|ready|leave)$/.test(path)) {
        paths.push(path);
        bodies.push(String(init.body));
        if (fail) {
          if (i.loss === "connection") throw new Error("response lost");
          if (i.loss === "malformed-json")
            return new Response("<html>gateway</html>", { status: 502 });
          return response({ error: "SERVICE_UNAVAILABLE" }, 503);
        }
        const applied =
          i.op === "action"
            ? applyAction(initial.state, JSON.parse(String(init.body)).action)
            : null;
        if (applied && !applied.ok) throw new Error("Invalid protocol fixture");
        return response({
          ...initial,
          version: 8,
          status: i.op === "leave" ? "closed" : initial.status,
          ready:
            i.op === "ready"
              ? { ...initial.ready, [i.side!]: true }
              : initial.ready,
          state: applied?.ok ? applied.state : initial.state,
        });
      }
      return response(initial);
    }),
  );
  let n = network();
  await n.resume(initial.id);
  expect(await send(n, i.op!)).toBe(false);
  expect(n.pending).toBe(true);
  const saved = sessionStorage.getItem(`interval-pending:${initial.id}`);
  expect(saved).not.toBeNull();
  await n.ready();
  await n.leave();
  await n.submit({ type: "pass" });
  expect(bodies).toHaveLength(1);
  if (i.recovery === "reload") {
    n.dispose();
    n = network();
    await n.resume(initial.id);
    expect(n.pending).toBe(true);
  }
  fail = false;
  await n.retry();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(paths[1]).toBe(paths[0]);
  expect(JSON.parse(bodies[1]).version).toBe(7);
  expect(n.pending).toBe(false);
  expect(n.error).toBe("");
  expect(n.room?.version).toBe(8);
  if (i.op === "action") expect(n.room?.state.ply).toBe(1);
  if (i.op === "ready") expect(n.room?.ready[i.side!]).toBe(true);
  if (i.op === "leave") expect(n.room?.status).toBe("closed");
  expect(sessionStorage.getItem(`interval-pending:${initial.id}`)).toBeNull();
}
async function lobby(i: InteractionInput) {
  let current = room(i.side!, "ready");
  current.joined = i.joined!;
  current.ready[i.side!] = i.ownReady!;
  current.ready[i.side === "white" ? "black" : "white"] = i.otherReady!;
  const writes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path.endsWith("/ready")) {
        writes.push(path);
        current = {
          ...current,
          version: current.version + 1,
          ready: { ...current.ready, [i.side!]: true },
          status: i.otherReady ? "playing" : "waiting",
        };
      }
      return response(path === "/api/session" ? { ok: true } : current);
    }),
  );
  await boot(`/?2d&room=${current.id}`);
  await flush();
  expect(el("lobby").hidden).toBe(false);
  expect(el("mode-label").textContent).toBe(`あなたは${owner(i.side!)}`);
  expect(
    el(i.side === "white" ? "host-seat" : "guest-seat").textContent,
  ).toContain("あなた");
  expect(button("ready").disabled).toBe(i.ownReady);
  expect(
    el(i.side === "white" ? "host-seat" : "guest-seat").textContent?.includes(
      "準備完了",
    ),
  ).toBe(i.ownReady);
  expect(
    el(i.side === "white" ? "guest-seat" : "host-seat").textContent?.includes(
      "準備完了",
    ),
  ).toBe(i.otherReady);
  expect(el("copy").hidden).toBe(i.side === "black");
  expect(button("summon").disabled).toBe(true);
  expect(button("pass").disabled).toBe(true);
  expect(el("ready-note").textContent).toContain("取り消せません");
  if (i.ownReady) {
    click("#ready");
    await flush();
    expect(writes).toHaveLength(0);
  } else {
    click("#ready");
    await flush();
    expect(writes).toHaveLength(1);
    if (i.otherReady) expect(el("lobby").hidden).toBe(true);
    else expect(button("ready").disabled).toBe(true);
  }
}
async function cpu(i: InteractionInput) {
  const workers: any[] = [];
  class FakeWorker {
    onmessage: any;
    onerror: any;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const c = controller();
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  await vi.advanceTimersByTimeAsync(300);
  const worker = workers[0];
  expect(worker).toBeDefined();
  const data: Record<string, unknown> = {
    null: null,
    undefined: undefined,
    "unknown-type": { type: "dance" },
    "illegal-move": { type: "move", pieceId: "guard-black", to: 31 },
    "invalid-summon": { type: "summon", kind: "carver", duration: 5, to: 10 },
    "empty-object": {},
  };
  if (i.workerResult === "stale-after-reset") {
    c.restart("local");
    worker.onmessage({ data: { type: "pass" } });
    await vi.advanceTimersByTimeAsync(7000);
    expect(c.getState().ply).toBe(0);
    expect(c.getBusy()).toBe(false);
    return;
  }
  if (i.workerResult === "error") worker.onerror();
  else if (i.workerResult === "timeout")
    await vi.advanceTimersByTimeAsync(6000);
  else if (i.workerResult === "double-valid") {
    worker.onmessage({ data: { type: "pass" } });
    worker.onmessage({ data: { type: "pass" } });
  } else worker.onmessage({ data: data[i.workerResult!] });
  await flush();
  expect(c.getState().ply).toBe(2);
  expect(c.getState().turn).toBe("white");
  expect(c.getBusy()).toBe(false);
  expect(worker.terminate).toHaveBeenCalled();
  const settled = c.getState();
  await vi.advanceTimersByTimeAsync(7000);
  expect(c.getState()).toBe(settled);
}
async function a11y() {
  await boot();
  click("#summon");
  click('[data-kind="carver"]');
  expect(
    document
      .querySelector('[data-kind="carver"]')!
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    document
      .querySelector('[data-kind="leaper"]')!
      .getAttribute("aria-pressed"),
  ).toBe("false");
  click('[data-kind="leaper"]');
  expect(
    document
      .querySelector('[data-kind="carver"]')!
      .getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    document
      .querySelector('[data-kind="leaper"]')!
      .getAttribute("aria-pressed"),
  ).toBe("true");
}
const runners: Record<string, (i: InteractionInput) => Promise<void>> = {
  summon: purchase,
  invalid: invalidTarget,
  inspection: inspect,
  controller: transaction,
  display,
  keyboard,
  rejection,
  receipt,
  lobby,
  cpu,
  a11y,
};
for (const scenario of interactionCases)
  registerCase(scenario, () =>
    runners[scenario.inputs.family](scenario.inputs),
  );
