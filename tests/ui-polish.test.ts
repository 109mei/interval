// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { createGame } from "../src/game/engine";
const click = (s: string) =>
  document.querySelector<HTMLButtonElement>(s)!.click();
const el = (id: string) => document.getElementById(id)!;
async function boot() {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("an immobile starting wall explains its role and keeps summon available", async () => {
  await boot();
  click('[data-square="10"]');
  expect(el("hint").textContent).toContain("移動できません");
  expect(el("idle-controls").hidden).toBe(false);
});
it("summon choice teaches movement and confirms an exact piece and square", async () => {
  await boot();
  click("#summon");
  click('[data-kind="carver"]');
  expect(el("summary").textContent).toContain("直角");
  click('[data-square="16"]');
  click('[data-square="9"]');
  expect(el("hint").textContent).toContain("c2にカーヴァー");
  expect(el("log").textContent).not.toContain("光っている");
  expect(
    document.querySelector('[data-square="9"] .ghost-piece'),
  ).not.toBeNull();
  expect(el("summary").textContent).toContain("期間3回");
  click("#back");
  expect(document.querySelector(".ghost-piece")).toBeNull();
});
it("pieces have visible identifying labels and a lifetime key", async () => {
  await boot();
  expect(
    document.querySelector('[data-square="10"] .piece-mark')?.textContent,
  ).toBe("守");
  expect(el("board-legend").textContent).toContain("残り期間");
  click('[data-square="38"]');
  expect(el("hint").textContent).toContain("黒");
  expect(el("summary").textContent).toContain("バスティオン");
});
it("draw results explain the stopping condition and rematch resets the board", async () => {
  await boot();
  for (let i = 0; i < 6; i++) {
    click("#pass");
    click("#confirm");
    await Promise.resolve();
    await Promise.resolve();
  }
  expect(el("hint").textContent).toContain("6回連続");
  click("#again");
  expect(el("ply").textContent).toBe("0 / 200 手");
});
it("an uncertain online operation never claims it was not committed", async () => {
  const room = {
    id: "a".repeat(32),
    seat: "white",
    version: 0,
    status: "playing",
    expiresAt: Date.now() + 86400000,
    joined: true,
    ready: { white: true, black: true },
    state: createGame(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p.endsWith("/action")) throw new Error("lost reply");
      return new Response(
        JSON.stringify(p === "/api/session" ? { ok: true } : room),
        { status: 200 },
      );
    }),
  );
  await boot();
  click("#create-room");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("あなたは白"),
  );
  click("#pass");
  click("#confirm");
  await vi.waitFor(() => expect(el("retry").hidden).toBe(false));
  expect(el("hint").textContent).toContain("送信結果");
  expect(el("network-banner").textContent).not.toContain("確定されていません");
  expect((el("leave") as HTMLButtonElement).disabled).toBe(true);
});
it("entering a friend room cannot discard a local match without confirmation", async () => {
  await boot();
  click("#pass");
  click("#confirm");
  await Promise.resolve();
  await Promise.resolve();
  vi.mocked(window.confirm).mockReturnValue(false);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  click("#create-room");
  expect(window.confirm).toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(el("ply").textContent).toBe("1 / 200 手");
});
it("Escape from a menu preserves the current board decision", async () => {
  await boot();
  click("#summon");
  click('[data-kind="carver"]');
  click('[data-square="9"]');
  click("#menu");
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(el("confirm-row").hidden).toBe(false);
  expect(el("drawer").getAttribute("aria-labelledby")).toBe("drawer-title");
});
it("switching mode during slow room creation cancels the late transition into that room", async () => {
  await boot();
  let resolveRoom!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/api/session"
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Promise<Response>((r) => {
            resolveRoom = r;
          }),
    ),
  );
  click("#create-room");
  await vi.waitFor(() => expect(resolveRoom).toBeDefined());
  click("#close-friend");
  click("#cpu");
  expect(el("mode-label").textContent).toContain("CPU");
  resolveRoom(
    new Response(
      JSON.stringify({
        id: "c".repeat(32),
        seat: "white",
        version: 0,
        status: "waiting",
        expiresAt: Date.now() + 86400000,
        joined: false,
        ready: { white: false, black: false },
        state: createGame(),
        invite: "d".repeat(64),
      }),
      { status: 200 },
    ),
  );
  await new Promise((r) => setTimeout(r, 30));
  expect(el("mode-label").textContent).toContain("CPU");
  expect(el("friend-error").hidden).toBe(true);
});
