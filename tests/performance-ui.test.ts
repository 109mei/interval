// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/game/rules", { spy: true });
vi.mock("../src/render/motion", { spy: true });
const click = (selector: string) =>
  document.querySelector<HTMLElement>(selector)!.click();
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
it("board inspection and selected-piece moves do not enumerate unrelated summon choices", async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  await import("../src/main");
  const rules = await import("../src/game/rules");
  click("#choose-local");
  click("#start-game");
  vi.mocked(rules.legalActions).mockClear();
  click('[data-square="3"]');
  expect(rules.legalActions).not.toHaveBeenCalled();
  click("#summon");
  click('[data-kind="carver"]');
  click('[data-square="9"]');
  click("#confirm");
  await Promise.resolve();
  await Promise.resolve();
  click("#pass");
  click("#confirm");
  await Promise.resolve();
  await Promise.resolve();
  vi.mocked(rules.legalActions).mockClear();
  click('[data-square="9"]');
  click('[data-square="18"]');
  expect(rules.legalActions).not.toHaveBeenCalled();
  expect(document.getElementById("confirm-row")!.hidden).toBe(false);
  expect(document.getElementById("ply")!.textContent).toBe("2 / 200 手");
});
it("confirmation preview and tactical notice share one fully validated simulation", async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  await import("../src/main");
  const rules = await import("../src/game/rules");
  click("#choose-local");
  click("#start-game");
  vi.mocked(rules.isLegal).mockClear();
  click("#pass");
  expect(rules.isLegal).toHaveBeenCalledTimes(1);
  expect(document.getElementById("confirm-row")!.hidden).toBe(false);
  expect(document.getElementById("ply")!.textContent).toBe("0 / 200 手");
});

it("online move history and animation share one transition recovery", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const { createGame, applyAction } = await import("../src/game/engine");
  const initial = createGame();
  const result = applyAction(initial, { type: "pass" });
  if (!result.ok) throw Error("fixture");
  let next = false;
  const room = {
    id: "a".repeat(32),
    seat: "white",
    version: 0,
    status: "playing",
    joined: true,
    ready: { white: true, black: true },
    state: initial,
    expiresAt: Date.now() + 86400000,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path === "/api/session"
              ? { ok: true }
              : next
                ? { ...room, version: 1, state: result.state }
                : room,
          ),
        ),
    ),
  );
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d&room=" + room.id);
  await import("../src/main");
  await vi.waitFor(() =>
    expect(document.getElementById("home")!.hidden).toBe(true),
  );
  const motion = await import("../src/render/motion");
  vi.mocked(motion.recoverTransition).mockClear();
  next = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() =>
    expect(document.getElementById("ply")!.textContent).toBe("1 / 200 手"),
  );
  expect(motion.recoverTransition).toHaveBeenCalledTimes(1);
  expect(document.getElementById("history")!.textContent).toContain("パス");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
