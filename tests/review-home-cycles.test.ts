// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Scenarios C01–C10. These exercise real main/controller/rules and
// real 2D DOM rendering. No browser, production service, room or GPU is used.
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
const click = (id: string) => el<HTMLButtonElement>(id).click();
const square = (q: number) =>
  document.querySelector<HTMLButtonElement>(`[data-square="${q}"]`)!;
const choose = (kind: string) =>
  document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!.click();
const flush = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};
let listeners: [string, EventListenerOrEventListenerObject][] = [];
const clearListeners = () => {
  for (const [name, listener] of listeners)
    document.removeEventListener(name, listener);
  listeners = [];
};
async function boot(path = "/?2d") {
  clearListeners();
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  document.body.className = "";
  history.replaceState(null, "", path);
  await import("../src/main");
  await flush();
}
function startLocal() {
  click("choose-local");
  click("start-game");
}
async function commit() {
  click("confirm");
  await flush();
}
async function pass() {
  click("pass");
  await commit();
}
function setDuration(life: number) {
  while (Number(el("duration").textContent) > life) click("minus");
  while (Number(el("duration").textContent) < life) click("plus");
}
async function summon(kind: string, to: number, life: number) {
  click("summon");
  choose(kind);
  setDuration(life);
  square(to).click();
  await commit();
}
function focusIsUsable() {
  const active = document.activeElement as HTMLElement;
  expect.soft(active).not.toBe(document.body);
  expect.soft(active.isConnected).toBe(true);
  expect.soft(active.closest("[hidden]")?.id).toBeUndefined();
  expect.soft(active.matches(":disabled")).toBe(false);
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (name, listener, options) => {
      listeners.push([name, listener]);
      add(name, listener, options);
    },
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network must not be used by these home cycles");
    }),
  );
});
afterEach(() => {
  clearListeners();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

it("C01: Nao compares all three modes then deliberately starts CPU without an early action", async () => {
  const workers: {
    onmessage?: (e: { data: unknown }) => void;
    terminate: ReturnType<typeof vi.fn>;
  }[] = [];
  class W {
    onmessage?: (e: { data: unknown }) => void;
    onerror?: () => void;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal("Worker", W);
  await boot("/");
  expect(el<HTMLButtonElement>("start-game").disabled).toBe(true);
  for (const mode of ["cpu", "local", "friend", "cpu"]) {
    click(`choose-${mode}`);
    expect(el("choose-" + mode).getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelectorAll('.mode-choice[aria-pressed="true"]'),
    ).toHaveLength(1);
    expect(el("arena").hidden).toBe(true);
    expect(document.querySelector("[data-square]")).toBeNull();
  }
  await vi.advanceTimersByTimeAsync(1000);
  expect(workers).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  // Select the real 2D renderer through the UI; WebGL is outside jsdom evidence.
  click("menu");
  click("view");
  click("close-menu");
  expect(document.querySelector("[data-square]")).toBeNull();
  click("start-game");
  expect(el("mode-label").textContent).toContain("あなたは白");
  expect(document.querySelectorAll(".piece.core")).toHaveLength(2);
  expect(document.querySelectorAll(".piece:not(.core)")).toHaveLength(0);
  await pass();
  expect(el<HTMLButtonElement>("summon").disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(301);
  expect(workers).toHaveLength(1);
  workers[0].onmessage!({
    data: { type: "summon", kind: "bastion", to: 28, duration: 1 },
  });
  await flush();
  expect(el("turn").textContent).toBe("白の手番");
  expect(el("ply").textContent).toBe("2 / 200 手");
  expect(square(28).getAttribute("aria-label")).toContain(
    "黒 バスティオン 残り1ターン",
  );
});

it("C02: Nao changes home mode through rules and receives matching mode guidance", async () => {
  await boot();
  click("choose-local");
  expect(el("home-hint").textContent).toContain("相手も人");
  click("home-rules");
  click("cpu");
  expect(el("home").hidden).toBe(false);
  expect(el("choose-cpu").getAttribute("aria-pressed")).toBe("true");
  expect(el("home-hint").textContent).toContain("あなたが先手");
  expect(el("home-hint").textContent).not.toContain("相手も人");
  expect(document.querySelector("[data-square]")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("C03: Nao validates a two-turn contract through both human turns and natural retirement", async () => {
  await boot();
  startLocal();
  expect(el("home").textContent).toContain("最初は王（コア）だけ");
  expect(el("drawer").textContent).toContain("中央の1列");
  await summon("carver", 14, 2);
  expect(el("white-grain").textContent).toBe("10");
  expect(square(14).getAttribute("aria-label")).toContain("残り2ターン");
  expect(el("hint").textContent).toContain("黒の人の番");
  click("summon");
  choose("bastion");
  setDuration(2);
  expect(square(21).dataset.available).not.toBe("true");
  square(28).click();
  await commit();
  expect(square(14).getAttribute("aria-label")).toContain("残り2ターン");
  expect(square(28).getAttribute("aria-label")).toContain("残り2ターン");
  await pass();
  expect(square(14).getAttribute("aria-label")).toContain("残り1ターン");
  expect(square(28).getAttribute("aria-label")).toContain("残り2ターン");
  await pass();
  square(14).click();
  expect(el("summary").textContent).toContain("この白の手番末に退場");
  click("cancel");
  click("pass");
  expect(el("summary").textContent).toContain("a3 カーヴァー");
  await commit();
  expect(square(14).querySelector(".piece")).toBeNull();
  expect(square(28).getAttribute("aria-label")).toContain("残り1ターン");
});

it("C04: Nao recovers from a retained unaffordable duration without buying the stale proposal", async () => {
  await boot();
  startLocal();
  await summon("carver", 14, 5);
  expect(el("white-grain").textContent).toBe("1");
  await pass();
  expect(el("white-grain").textContent).toBe("5");
  click("summon");
  choose("carver");
  expect(el("purchase-facts").textContent).toContain("10糧不足");
  expect(document.querySelectorAll("#board .target")).toHaveLength(0);
  square(15).click();
  expect(el("confirm-row").hidden).toBe(true);
  expect(el("hint").textContent).toContain("期間を短く");
  setDuration(1);
  expect(el("purchase-facts").textContent).toBe("1ターンで3糧 · 残り2糧");
  expect(document.querySelectorAll("#board .target")).toHaveLength(19);
  square(15).click();
  expect(el("summary").textContent).toContain("支払う 3");
  await commit();
  expect(el("white-grain").textContent).toBe("2");
  expect(square(15).getAttribute("aria-label")).toContain("残り1ターン");
  expect(square(14).getAttribute("aria-label")).toContain("残り4ターン");
});

it("C05: Mika replaces invalid targets after an interrupted purchase and spends only once", async () => {
  await boot();
  startLocal();
  click("summon");
  choose("leaper");
  setDuration(4);
  square(20).click();
  click("menu");
  click("quality");
  click("motion");
  click("close-menu");
  expect(el("confirm-row").hidden).toBe(false);
  expect(square(20).querySelector(".ghost-piece")).not.toBeNull();
  square(3).click(); // Occupied core; previous purchase must be gone.
  expect(el("confirm-row").hidden).toBe(true);
  expect(document.querySelector(".ghost-piece")).toBeNull();
  click("confirm"); // A stale synthetic activation cannot spend either.
  square(21).click(); // Middle rank remains excluded.
  expect(el("confirm-row").hidden).toBe(true);
  expect(el("duration").textContent).toBe("4");
  square(19).click();
  expect(el("hint").textContent).toContain("f3");
  await commit();
  click("confirm");
  await flush();
  expect(el("white-grain").textContent).toBe("8");
  expect(el("ply").textContent).toBe("1 / 200 手");
  expect(square(19).getAttribute("aria-label")).toContain(
    "リーパー 残り4ターン",
  );
  expect(square(20).querySelector(".piece")).toBeNull();
});

it("C06: Mika declines an in-menu mode reset and keeps the exact uncommitted purchase", async () => {
  await boot();
  startLocal();
  await summon("bastion", 14, 4);
  await pass();
  click("summon");
  choose("link");
  setDuration(2);
  square(15).click();
  const proposal = el("summary").textContent;
  const grain = el("white-grain").textContent;
  click("menu");
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  click("cpu");
  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining("進行中の対局"),
  );
  expect(el("drawer").hasAttribute("open")).toBe(true);
  click("close-menu");
  expect(el("summary").textContent).toBe(proposal);
  expect(el("white-grain").textContent).toBe(grain);
  expect(el("mode-label").textContent).toBe("この端末で2人");
  await commit();
  expect(el("ply").textContent).toBe("3 / 200 手");
  expect(square(15).getAttribute("aria-label")).toContain("リンク 残り2ターン");
});

it("C07: keyboard Start and Resume move focus to a visible game control", async () => {
  await boot();
  click("choose-local");
  el("start-game").focus();
  click("start-game");
  focusIsUsable();
  expect
    .soft((document.activeElement as HTMLElement).closest("#arena"))
    .not.toBeNull();
  click("home-button");
  expect(document.activeElement).toBe(el("resume-game"));
  click("resume-game");
  focusIsUsable();
  expect
    .soft((document.activeElement as HTMLElement).closest("#arena"))
    .not.toBeNull();
  square(20).focus();
  const up = new KeyboardEvent("keydown", {
    key: "ArrowUp",
    bubbles: true,
    cancelable: true,
  });
  square(20).dispatchEvent(up);
  expect(up.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(square(27));
  const edge = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true,
  });
  square(27).dispatchEvent(edge);
  expect(edge.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(square(27));
  expect(document.querySelectorAll('#board [tabindex="0"]')).toHaveLength(1);

  // A waiting room deliberately hides its board via .is-lobby .board-shell.
  // Returning must therefore focus a lobby control rather than that hidden board.
  const { createGame } = await import("../src/game/engine");
  const room = {
    id: "d".repeat(32),
    seat: "white",
    version: 0,
    status: "waiting",
    joined: false,
    ready: { white: false, black: false },
    state: createGame(),
    expiresAt: Date.now() + 86400000,
  };
  const fetcher = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(path === "/api/session" ? { ok: true } : room),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await boot(`/?2d&room=${room.id}`);
  expect(el("lobby").hidden).toBe(false);
  expect(document.querySelector("main")!.classList.contains("is-lobby")).toBe(
    true,
  );
  click("home-button");
  click("resume-game");
  expect
    .soft(
      (document.activeElement as HTMLElement).closest(".board-shell")
        ?.className,
    )
    .toBeUndefined();
  focusIsUsable();
  click("home-button");
  click("choose-friend");
  el("start-game").focus();
  click("start-game");
  expect
    .soft(
      (document.activeElement as HTMLElement).closest(".board-shell")
        ?.className,
    )
    .toBeUndefined();
  focusIsUsable();
  expect(fetcher).toHaveBeenCalledTimes(2); // Session/state fixture reads only.

  const readyGuest = {
    ...room,
    seat: "black",
    joined: true,
    ready: { white: false, black: true },
  };
  fetcher.mockImplementation(
    async (path: string) =>
      new Response(
        JSON.stringify(path === "/api/session" ? { ok: true } : readyGuest),
      ),
  );
  await boot(`/?2d&room=${room.id}`);
  expect(el<HTMLButtonElement>("ready").disabled).toBe(true);
  expect(el("copy").hidden).toBe(true);
  click("home-button");
  click("resume-game");
  expect
    .soft(
      (document.activeElement as HTMLElement).closest(".board-shell")
        ?.className,
    )
    .toBeUndefined();
  focusIsUsable();
});

it("C08: Mika rejects replacement of a paused match, then resumes without aging or income twice", async () => {
  await boot();
  startLocal();
  await summon("link", 14, 3);
  await pass();
  const before = {
    grain: el("white-grain").textContent,
    ply: el("ply").textContent,
    piece: square(14).getAttribute("aria-label"),
  };
  click("home-button");
  click("choose-cpu");
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  click("start-game");
  expect(el("home").hidden).toBe(false);
  expect(window.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("中断した対局"),
  );
  click("resume-game");
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(el("white-grain").textContent).toBe(before.grain);
  expect(el("ply").textContent).toBe(before.ply);
  expect(square(14).getAttribute("aria-label")).toBe(before.piece);
  click("home-button");
  click("resume-game");
  expect(el("white-grain").textContent).toBe(before.grain);
  expect(el("ply").textContent).toBe(before.ply);
  await pass();
  expect(square(14).getAttribute("aria-label")).toContain("残り2ターン");
});

it("C09: display flags chosen on first-visit home survive reload without saving a game", async () => {
  await boot();
  expect(el("view").textContent).toBe("3Dに切替");
  click("home-rules");
  click("quality");
  click("motion");
  click("close-menu");
  expect(document.querySelector("[data-square]")).toBeNull();
  expect(
    JSON.parse(localStorage.getItem("interval-display-preferences")!),
  ).toEqual({ quality: true, motion: true });
  startLocal();
  await summon("leaper", 14, 2);
  expect(el("ply").textContent).toBe("1 / 200 手");
  await boot();
  expect(el("home").hidden).toBe(false);
  expect(el("resume-game").hidden).toBe(true);
  expect(el<HTMLButtonElement>("start-game").disabled).toBe(true);
  expect(el("quality").getAttribute("aria-pressed")).toBe("true");
  expect(el("motion").getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.length).toBe(1);
  startLocal();
  expect(el("ply").textContent).toBe("0 / 200 手");
  expect(el("white-grain").textContent).toBe("16");
  expect(document.querySelectorAll(".piece:not(.core)")).toHaveLength(0);
});

it("C10: friend setup can be canceled for a shared-device start without any room request", async () => {
  await boot();
  click("choose-friend");
  expect(el("start-game").textContent).toBe("フレンド対戦へ");
  click("start-game");
  expect(el("friend-dialog").hasAttribute("open")).toBe(true);
  expect(el("home").hidden).toBe(false);
  expect(el("arena").hidden).toBe(true);
  expect(el("create-room").hidden).toBe(false);
  expect(el("join-room").hidden).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  click("close-friend");
  click("choose-local");
  click("start-game");
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(el("friend-dialog").hasAttribute("open")).toBe(false);
  await summon("bastion", 14, 1);
  expect(el("hint").textContent).toContain("黒の人の番");
  expect(el<HTMLButtonElement>("summon").disabled).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
