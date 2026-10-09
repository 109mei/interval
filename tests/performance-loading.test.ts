// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

let imports = 0;
let mounts = 0;
const boards: {
  dispose: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
}[] = [];
async function boot(path = "/", gate?: Promise<void>, failLoad = false) {
  vi.resetModules();
  imports = 0;
  mounts = 0;
  boards.length = 0;
  vi.doMock("../src/render/board3d", async () => {
    imports++;
    if (gate) await gate;
    if (failLoad) throw new Error("chunk unavailable");
    return {
      createBoard3D(host: HTMLElement) {
        mounts++;
        const marker = document.createElement("div");
        marker.dataset.gpu = "true";
        for (let q = 0; q < 49; q++) {
          const button = document.createElement("button");
          button.dataset.square = String(q);
          button.tabIndex = q === 0 ? 0 : -1;
          marker.append(button);
        }
        host.append(marker);
        const board = {
          render: vi.fn(),
          dispose: vi.fn(() => marker.remove()),
        };
        boards.push(board);
        return board;
      },
    };
  });
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", path);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
}
const click = (id: string) => document.getElementById(id)!.click();
afterEach(() => {
  vi.doUnmock("../src/render/board3d");
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
it("home and explicit 2D play never evaluate the 3D module", async () => {
  await boot("/?2d");
  expect(imports).toBe(0);
  click("choose-local");
  click("start-game");
  expect(document.querySelectorAll("[data-square]")).toHaveLength(49);
  expect(imports).toBe(0);
});
it("default home defers the 3D module until a match starts", async () => {
  await boot();
  expect(imports).toBe(0);
  click("choose-local");
  expect(imports).toBe(0);
  click("start-game");
  await vi.waitFor(() => expect(mounts).toBe(1));
  expect(boards[0].render).toHaveBeenCalled();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("loading preserves playable input, latest state, and the keyboard square on upgrade", async () => {
  const load = deferred();
  await boot("/", load.promise);
  click("choose-local");
  click("start-game");
  expect(document.querySelectorAll("[data-square]")).toHaveLength(49);
  click("pass");
  click("confirm");
  await Promise.resolve();
  await Promise.resolve();
  const square = document.querySelector<HTMLElement>('[data-square="16"]')!;
  square.focus();
  load.resolve();
  await vi.waitFor(() => expect(mounts).toBe(1));
  expect(boards[0].render.mock.lastCall?.[0].ply).toBe(1);
  expect((document.activeElement as HTMLElement).dataset.square).toBe("16");
  expect(
    document
      .querySelector('#board [tabindex="0"]')
      ?.getAttribute("data-square"),
  ).toBe("16");
});
it("returning home during loading does not mount hidden GPU resources and resume uses the latest match", async () => {
  const load = deferred();
  await boot("/", load.promise);
  click("choose-local");
  click("start-game");
  click("pass");
  click("confirm");
  await Promise.resolve();
  await Promise.resolve();
  click("home-button");
  expect(document.querySelectorAll("#board > *")).toHaveLength(0);
  load.resolve();
  await vi.waitFor(() => expect(imports).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(mounts).toBe(0);
  click("resume-game");
  await vi.waitFor(() => expect(mounts).toBe(1));
  expect(boards[0].render.mock.lastCall?.[0].ply).toBe(1);
  click("home-button");
  expect(boards[0].dispose).toHaveBeenCalledTimes(1);
});
it("choosing 2D during a pending import prevents a stale 3D replacement", async () => {
  const load = deferred();
  await boot("/", load.promise);
  click("choose-local");
  click("start-game");
  click("view");
  load.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(mounts).toBe(0);
  expect(document.querySelectorAll("[data-square]")).toHaveLength(49);
  expect(document.getElementById("board-status")!.textContent).toBe("2D表示");
});
it("a failed dynamic import leaves the exact playable 2D position available", async () => {
  await boot("/", undefined, true);
  click("choose-local");
  click("start-game");
  click("pass");
  click("confirm");
  await vi.waitFor(() =>
    expect(document.getElementById("board-status")!.textContent).toContain(
      "読み込めない",
    ),
  );
  expect(document.getElementById("ply")!.textContent).toBe("1 / 200 手");
  expect(document.querySelectorAll("[data-square]")).toHaveLength(49);
  expect(document.getElementById("view")!.textContent).toBe("3Dに切替");
});

it("leaving during import, resolve at home, restart upgrades correctly", async () => {
  const load = deferred();
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
    vi.fn(
      async (p: string) =>
        new Response(
          JSON.stringify(
            p === "/api/session"
              ? { ok: true }
              : p.endsWith("/leave")
                ? { ...room, version: 1, status: "closed" }
                : room,
          ),
        ),
    ),
  );
  await boot("/?room=" + room.id, load.promise);
  await vi.waitFor(() =>
    expect(document.getElementById("lobby")!.hidden).toBe(false),
  );
  click("leave");
  await vi.waitFor(() =>
    expect(document.getElementById("home")!.hidden).toBe(false),
  );
  load.resolve();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mounts).toBe(0);
  click("choose-local");
  click("start-game");
  await vi.waitFor(() => expect(mounts).toBe(1));
  vi.unstubAllGlobals();
});
