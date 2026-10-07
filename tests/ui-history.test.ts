// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { createGame } from "../src/game/engine";
const click = (selector: string) =>
  document.querySelector<HTMLButtonElement>(selector)!.click();
const text = (id: string) => document.getElementById(id)!.textContent;
async function boot() {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
}
async function move() {
  click("#summon");
  click('[data-kind="carver"]');
  click('[data-square="9"]');
  click("#confirm");
  await vi.waitFor(() => expect(text("ply")).toBe("1 / 200 手"));
  expect(text("log")).toBe("c2に召喚");
  expect(text("history")).toBe("c2に召喚");
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
});
it("restart resets the previous-match footer and drawer history", async () => {
  await boot();
  await move();
  click("#restart");
  expect(text("log")).toBe("まだ指されていません。");
  expect(text("history")).toBe("まだ指されていません。");
});
it("local to CPU and CPU to local reset only the new session display", async () => {
  await boot();
  await move();
  click("#cpu");
  expect(text("log")).toBe("まだ指されていません。");
  expect(text("history")).toBe("まだ指されていません。");
  await move();
  click("#local");
  expect(text("log")).toBe("まだ指されていません。");
  expect(text("history")).toBe("まだ指されていません。");
});
it("a new friend room clears old match text but polling does not reset current room text", async () => {
  await boot();
  await move();
  const room = {
    id: "a".repeat(32),
    seat: "white",
    version: 0,
    status: "waiting",
    expiresAt: Date.now() + 86400000,
    joined: false,
    ready: { white: false, black: false },
    state: createGame(),
    invite: "b".repeat(64),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (p: string) =>
        new Response(
          JSON.stringify(p === "/api/session" ? { ok: true } : room),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  click("#create-room");
  await vi.waitFor(() => expect(text("mode-label")).toBe("あなたは白"));
  expect(text("log")).toBe("まだ指されていません。");
  expect(text("history")).toBe("まだ指されていません。");
  document.getElementById("log")!.textContent = "同じ部屋の表示";
  document.getElementById("history")!.textContent = "同じ部屋の表示";
  room.version = 1;
  room.joined = true;
  click("#retry");
  await vi.waitFor(() =>
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(2),
  );
  expect(text("log")).toBe("同じ部屋の表示");
  expect(text("history")).toBe("同じ部屋の表示");
  click("#leave");
  await new Promise((r) => setTimeout(r, 1));
});
