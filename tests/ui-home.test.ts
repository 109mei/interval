// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const el = (id: string) => document.getElementById(id)!;
const click = (id: string) => (el(id) as HTMLButtonElement).click();
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
async function boot(path = "/?2d") {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", path);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
  await flush();
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
it("Nao opens a neutral home and chooses local before explicitly starting an empty board", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await boot();
  expect(el("home").hidden).toBe(false);
  expect(el("arena").hidden).toBe(true);
  expect(document.querySelector("[data-square]")).toBeNull();
  expect((el("start-game") as HTMLButtonElement).disabled).toBe(true);
  click("choose-local");
  expect(el("arena").hidden).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  click("start-game");
  expect(el("home").hidden).toBe(true);
  expect(el("arena").hidden).toBe(false);
  expect(document.querySelectorAll(".piece:not(.core)")).toHaveLength(0);
  expect(document.querySelectorAll(".piece.core")).toHaveLength(2);
  expect(el("hint").textContent).toContain("召喚");
  expect(el("mode-label").textContent).toContain("2人");
});
it("Mika can cancel going home or pause and resume the exact local match", async () => {
  await boot();
  click("choose-local");
  click("start-game");
  click("pass");
  click("confirm");
  await flush();
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  click("home-button");
  expect(el("arena").hidden).toBe(false);
  expect(el("ply").textContent).toContain("1 /");
  click("home-button");
  expect(el("home").hidden).toBe(false);
  click("pass");
  click("confirm");
  await flush();
  expect(el("ply").textContent).toContain("1 /");
  click("resume-game");
  expect(el("arena").hidden).toBe(false);
  expect(el("ply").textContent).toContain("1 /");
});
it("Ren sees turns, symmetric own-half guidance, and compact badge accessibility", async () => {
  await boot();
  click("choose-local");
  click("start-game");
  click("summon");
  click("choose-local");
  document.querySelector<HTMLButtonElement>('[data-kind="carver"]')!.click();
  expect(el("purchase-facts").textContent).toContain("3ターン");
  expect(el("summary").textContent).toContain("3 ターン");
  expect(el("drawer").textContent).toContain("手前3列");
  expect(el("drawer").textContent).toContain("中央の1列");
  document.querySelector<HTMLButtonElement>('[data-square="14"]')!.click();
  click("confirm");
  await flush();
  expect(
    document.querySelector('[data-square="14"]')?.getAttribute("aria-label"),
  ).toContain("残り3ターン");
});
it("Sora opens an invitation over home and joins only after an explicit action", async () => {
  const id = "a".repeat(32),
    invite = "b".repeat(64);
  const { createGame } = await import("../src/game/engine");
  const room = {
    id,
    seat: "black",
    version: 1,
    status: "waiting",
    joined: true,
    ready: { white: false, black: false },
    state: createGame(),
    expiresAt: Date.now() + 86400000,
  };
  const fetcher = vi.fn(
    async (p: string) =>
      new Response(JSON.stringify(p === "/api/session" ? { ok: true } : room)),
  );
  vi.stubGlobal("fetch", fetcher);
  await boot(`/?2d#room=${id}&invite=${invite}`);
  expect(location.hash).toBe("");
  expect(el("home").hidden).toBe(false);
  expect(el("arena").hidden).toBe(true);
  expect(el("friend-title").textContent).toContain("招待");
  expect(fetcher).not.toHaveBeenCalled();
  click("join-room");
  await vi.waitFor(() => expect(el("lobby").hidden).toBe(false));
  expect(el("home").hidden).toBe(true);
  expect(history.state?.invite).toBeUndefined();
  expect(fetcher.mock.calls.some(([p]) => p.endsWith("/ready"))).toBe(false);
});
it("solo choice does not launch CPU before Start and home pauses a waiting reply", async () => {
  vi.useFakeTimers();
  const workers: any[] = [];
  class W {
    onmessage: any;
    onerror: any;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal("Worker", W);
  await boot();
  click("choose-cpu");
  await vi.advanceTimersByTimeAsync(10000);
  expect(workers).toHaveLength(0);
  expect(el("arena").hidden).toBe(true);
  click("start-game");
  click("pass");
  click("confirm");
  await flush();
  expect(el("hint").textContent).toContain("CPU");
  await vi.advanceTimersByTimeAsync(350);
  expect(workers).toHaveLength(1);
  click("home-button");
  workers[0].onmessage({ data: { type: "pass" } });
  await flush();
  await vi.advanceTimersByTimeAsync(10000);
  expect(el("home").hidden).toBe(false);
  click("resume-game");
  expect(el("ply").textContent).toBe("1 / 200 手");
  await vi.advanceTimersByTimeAsync(350);
  workers[1].onmessage({ data: { type: "pass" } });
  await flush();
  expect(el("ply").textContent).toBe("2 / 200 手");
  expect(el("turn").textContent).toBe("白の手番");
  vi.useRealTimers();
});
it("local handoff names the next human and badges say whose turns are counted", async () => {
  await boot();
  click("choose-local");
  click("start-game");
  click("pass");
  click("confirm");
  await flush();
  expect(el("hint").textContent).toContain("黒の人の番");
  expect(el("board-legend").textContent).toContain("持ち主の手番");
});
it("returning participant can go home without leaving or resetting the authoritative room", async () => {
  const id = "c".repeat(32);
  const { createGame } = await import("../src/game/engine");
  const game = { ...createGame(), ply: 4, turn: "black" };
  const room = {
    id,
    seat: "black",
    version: 7,
    status: "playing",
    joined: true,
    ready: { white: true, black: true },
    state: game,
    expiresAt: Date.now() + 86400000,
  };
  const fetcher = vi.fn(
    async (p: string) =>
      new Response(JSON.stringify(p === "/api/session" ? { ok: true } : room)),
  );
  vi.stubGlobal("fetch", fetcher);
  await boot(`/?2d&room=${id}`);
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("あなたは黒"),
  );
  click("home-button");
  expect(el("home").hidden).toBe(false);
  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining("一時停止されません"),
  );
  click("resume-game");
  expect(el("ply").textContent).toBe("4 / 200 手");
  expect(fetcher.mock.calls.some(([p]) => p.endsWith("/leave"))).toBe(false);
});
it("a late room creation cannot replace a new explicitly started local match", async () => {
  let finish!: (r: Response) => void;
  const { createGame } = await import("../src/game/engine");
  const room = {
    id: "a".repeat(32),
    seat: "white",
    version: 0,
    status: "waiting",
    joined: false,
    ready: { white: false, black: false },
    state: createGame(),
    expiresAt: Date.now() + 86400000,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? new Response('{"ok":true}')
        : new Promise<Response>((r) => (finish = r)),
    ),
  );
  await boot();
  click("choose-friend");
  click("start-game");
  click("create-room");
  await flush();
  click("close-friend");
  click("choose-local");
  click("start-game");
  finish(new Response(JSON.stringify(room)));
  await flush();
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(el("lobby").hidden).toBe(true);
  click("pass");
  click("confirm");
  await flush();
  expect(el("ply").textContent).toBe("1 / 200 手");
});
it("home display changes discard the old renderer and rebuild only on resume", async () => {
  await boot();
  click("choose-local");
  click("start-game");
  const old = document.querySelector('[data-square="0"]');
  click("home-button");
  click("menu");
  click("view");
  click("view");
  click("close-menu");
  expect(document.querySelector('[data-square="0"]')).toBeNull();
  click("resume-game");
  expect(document.querySelector('[data-square="0"]')).not.toBe(old);
  expect(document.querySelectorAll("[data-square]")).toHaveLength(49);
});
it("a late room creation cannot replace a resumed local match", async () => {
  let finish!: (r: Response) => void;
  const { createGame } = await import("../src/game/engine");
  const room = {
    id: "a".repeat(32),
    seat: "white",
    version: 0,
    status: "waiting",
    joined: false,
    ready: { white: false, black: false },
    state: createGame(),
    expiresAt: Date.now() + 86400000,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? new Response('{"ok":true}')
        : new Promise<Response>((r) => (finish = r)),
    ),
  );
  await boot();
  click("choose-local");
  click("start-game");
  click("pass");
  click("confirm");
  await flush();
  click("home-button");
  click("choose-friend");
  click("start-game");
  click("create-room");
  await flush();
  click("close-friend");
  click("resume-game");
  finish(new Response(JSON.stringify(room)));
  await flush();
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(el("lobby").hidden).toBe(true);
  expect(el("ply").textContent).toBe("1 / 200 手");
});
it("home menu reflects completed online requests before re-entering the board", async () => {
  let finish!: (r: Response) => void;
  const { createGame } = await import("../src/game/engine");
  const room = {
    id: "a".repeat(32),
    seat: "white",
    version: 0,
    status: "waiting",
    joined: true,
    ready: { white: false, black: false },
    state: createGame(),
    expiresAt: Date.now() + 86400000,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p.endsWith("/ready")
        ? new Promise<Response>((r) => (finish = r))
        : new Response(
            JSON.stringify(p === "/api/session" ? { ok: true } : room),
          ),
    ),
  );
  await boot("/?2d&room=" + room.id);
  await flush();
  click("ready");
  await flush();
  expect((el("leave") as HTMLButtonElement).disabled).toBe(true);
  click("home-button");
  finish(
    new Response(
      JSON.stringify({
        ...room,
        version: 1,
        ready: { white: true, black: false },
      }),
    ),
  );
  await flush();
  expect(el("home").hidden).toBe(false);
  expect((el("leave") as HTMLButtonElement).disabled).toBe(false);
});
