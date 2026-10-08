// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { createGame } from "../src/game/engine";
const el = (id: string) => document.getElementById(id)!;
const click = (id: string) => (el(id) as HTMLButtonElement).click();
const room = (extra: any = {}) => ({
  id: "a".repeat(32),
  seat: "black",
  version: 2,
  status: "waiting",
  expiresAt: Date.now() + 86400000,
  joined: true,
  ready: { white: true, black: false },
  state: createGame(),
  ...extra,
});
const res = (v: any, status = 200) =>
  new Response(JSON.stringify(v), { status });
async function settle() {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
}
async function boot(path = "/?2d&room=" + "a".repeat(32)) {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", path);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
  await settle();
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
it("returning black guest sees ready host, own role, and truthful instant start notice", async () => {
  let current = room();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p.endsWith("/ready"))
        current = room({
          version: 3,
          status: "playing",
          ready: { white: true, black: true },
        });
      return res(p === "/api/session" ? { ok: true } : current);
    }),
  );
  await boot();
  expect(el("lobby").hidden).toBe(false);
  expect(el("host-seat").textContent).toContain("ホスト ✓ 準備完了");
  expect(el("guest-seat").textContent).toContain("あなた");
  expect(el("ready-note").textContent).toContain("すぐ始まります");
  expect((el("ready") as HTMLButtonElement).disabled).toBe(false);
  click("ready");
  await settle();
  expect(el("lobby").hidden).toBe(true);
  expect(el("mode-label").textContent).toBe("あなたは黒");
  expect(el("network-banner").textContent).toBe("フレンドの手番です");
});
it("stale-ready recovery directs guest to second ready and starts once without new ambiguous send", async () => {
  let ready = 0;
  let current = room();
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: any) => {
      if (p.endsWith("/ready")) {
        bodies.push(JSON.parse(init.body));
        ready++;
        if (ready === 1) return res({ error: "STALE_VERSION" }, 409);
        current = room({
          version: 3,
          status: "playing",
          ready: { white: true, black: true },
        });
      }
      return res(p === "/api/session" ? { ok: true } : current);
    }),
  );
  await boot();
  click("ready");
  await settle();
  expect(el("error").textContent).toContain("もう一度");
  expect(el("error").textContent).not.toContain("盤面");
  expect((el("ready") as HTMLButtonElement).disabled).toBe(false);
  click("ready");
  await settle();
  expect(el("lobby").hidden).toBe(true);
  expect(ready).toBe(2);
  expect(bodies[1].commandId).not.toBe(bodies[0].commandId);
});
it("lost ready response with server-started game keeps uncertainty and retries exact receipt", async () => {
  let ready = 0;
  let current = room();
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: any) => {
      if (p.endsWith("/ready")) {
        bodies.push(init.body);
        ready++;
        current = room({
          version: 3,
          status: "playing",
          ready: { white: true, black: true },
        });
        if (ready === 1) throw new Error("reply lost");
      }
      return res(p === "/api/session" ? { ok: true } : current);
    }),
  );
  await boot();
  click("ready");
  await settle();
  expect(el("hint").textContent).toContain("送信結果");
  expect(el("retry").hidden).toBe(false);
  expect((el("leave") as HTMLButtonElement).disabled).toBe(true);
  click("retry");
  await settle();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(el("retry").hidden).toBe(true);
  expect(el("network-banner").textContent).toBe("フレンドの手番です");
});
it("finished match room cap dialog can be closed and fresh local match played", async () => {
  const current = room({
    status: "finished",
    state: {
      ...createGame(),
      ply: 6,
      outcome: { kind: "draw", reason: "passes" },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/rooms"
        ? res({ error: "ROOM_LIMIT" }, 429)
        : res(p === "/api/session" ? { ok: true } : current),
    ),
  );
  await boot();
  click("again");
  click("create-room");
  await settle();
  expect(el("friend-error").textContent).toContain("終了・退出した部屋");
  click("close-friend");
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(el("ply").textContent).toBe("0 / 200 手");
  click("pass");
  click("confirm");
  await settle();
  expect(el("ply").textContent).toBe("1 / 200 手");
});
it("guest local warmup is not resurrected after explicitly abandoned for online game then capped rematch", async () => {
  let current = room();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p.endsWith("/ready"))
        current = room({
          version: 3,
          status: "playing",
          ready: { white: true, black: true },
        });
      return p === "/api/rooms"
        ? res({ error: "ROOM_LIMIT" }, 429)
        : res(p === "/api/session" ? { ok: true } : current);
    }),
  );
  await boot("/?2d#room=" + "a".repeat(32) + "&invite=" + "b".repeat(64));
  click("close-friend");
  click("pass");
  click("confirm");
  await settle();
  expect(el("ply").textContent).toBe("1 / 200 手");
  click("friend");
  click("join-room");
  await settle();
  expect(window.confirm).toHaveBeenCalledWith(
    "進行中の対局を終了して、フレンド対戦を始めますか？",
  );
  expect(el("lobby").hidden).toBe(false);
  click("ready");
  await settle();
  expect(el("lobby").hidden).toBe(true);
  current = room({
    version: 9,
    status: "finished",
    ready: { white: true, black: true },
    state: {
      ...createGame(),
      ply: 6,
      outcome: { kind: "draw", reason: "passes" },
    },
  });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  expect(el("turn").textContent).toBe("引き分け");
  click("again");
  click("create-room");
  await settle();
  click("close-friend");
  expect(el("ply").textContent).toBe("0 / 200 手");
});
