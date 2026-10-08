// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { createBoard2D } from "../src/render/board2d";
import { createGame, applyAction } from "../src/game/engine";
const selection = { pieceId: null, candidate: null };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.className = "";
});
it("committed summon has a bounded action cue, previews never do", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const board = createBoard2D(host, () => {});
  const before = createGame();
  board.render(before, selection, null);
  expect(host.querySelector(".board-effects [data-effect]")).toBeNull();
  const result = applyAction(before, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 9,
  });
  if (!result.ok) throw Error();
  (board.render as Function)(result.state, selection, null, {
    before,
    events: result.events,
  });
  expect(host.querySelector('[data-effect="summon"]')?.textContent).toContain(
    "召喚",
  );
  board.dispose();
  expect(host.children).toHaveLength(0);
  host.remove();
});
it("last-life capture shows reward and expiry at destination, without an extra live piece", () => {
  const host = document.createElement("div");
  const board = createBoard2D(host, () => {});
  const before = createGame();
  before.pieces = [
    {
      id: "mover",
      kind: "carver",
      side: "white",
      square: 9,
      remaining: 1,
      summonedPly: -1,
    },
    {
      id: "victim",
      kind: "carver",
      side: "black",
      square: 18,
      remaining: 3,
      summonedPly: -1,
    },
  ];
  board.render(before, selection, null);
  const result = applyAction(before, {
    type: "move",
    pieceId: "mover",
    to: 18,
  });
  if (!result.ok) throw Error();
  (board.render as Function)(result.state, selection, null, {
    before,
    events: result.events,
  });
  expect(host.querySelector('[data-effect="capture"]')?.textContent).toBe(
    "+9糧",
  );
  expect(
    host.querySelector('[data-effect="expire"]')?.getAttribute("data-at"),
  ).toBe("18");
  expect(host.querySelectorAll(".square .piece:not(.core)")).toHaveLength(0);
  board.dispose();
});
it("real main starts feedback exactly once for a commit and clears it on restart", async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
  const click = (q: string) =>
    document.querySelector<HTMLButtonElement>(q)!.click();
  click("#summon");
  click('[data-kind="carver"]');
  click('[data-square="9"]');
  click("#confirm");
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelectorAll('[data-effect="summon"]')).toHaveLength(1);
  click("#restart");
  expect(document.querySelectorAll("[data-effect]")).toHaveLength(0);
});
