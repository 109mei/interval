// @vitest-environment jsdom
import { it, expect } from "vitest";
import { createBoard2D } from "../src/render/board2d";
import { createGame } from "../src/game/engine";
function gameWithWall() {
  const state = createGame();
  state.pieces = [
    {
      id: "wall",
      side: "white",
      kind: "bastion",
      square: 10,
      remaining: 3,
      summonedPly: -1,
    },
  ];
  return state;
}
it("49_accessible_squares_and_selection", () => {
  const h = document.createElement("div");
  let picked = -1;
  const b = createBoard2D(h, (q) => (picked = q));
  b.render(createGame(), { pieceId: null, candidate: null }, null);
  const squares = h.querySelectorAll<HTMLButtonElement>("[data-square]");
  expect(squares).toHaveLength(49);
  squares[0].click();
  expect(picked).toBe(Number(squares[0].dataset.square));
  expect(h.textContent).not.toContain("杭");
  b.dispose();
  expect(h.children).toHaveLength(0);
});
it("readonly_render_and_big_balance", () => {
  const h = document.createElement("div");
  const b = createBoard2D(h, () => {}),
    s = createGame();
  s.grain.white = 9999;
  const before = JSON.stringify(s);
  b.render(s, { pieceId: null, candidate: null }, null);
  expect(JSON.stringify(s)).toBe(before);
  b.dispose();
});
it("selected_route_is_visible", () => {
  const h = document.createElement("div");
  const b = createBoard2D(h, () => {});
  const s = createGame();
  b.render(
    s,
    { pieceId: null, candidate: null },
    {
      cost: 0,
      reward: 0,
      grainAfter: 16,
      expires: [],
      targets: [18],
      paths: [[16, 17, 18]],
    },
  );
  expect(
    h.querySelector('[data-square="17"]')?.classList.contains("route"),
  ).toBe(true);
  b.dispose();
});
it("summoning lights only legal cells with selected cost and duration", () => {
  const h = document.createElement("div"),
    b = createBoard2D(h, () => {});
  b.render(
    gameWithWall(),
    { pieceId: null, candidate: null, summon: { kind: "carver", duration: 3 } },
    null,
  );
  expect(
    h.querySelector('[data-square="9"]')?.classList.contains("target"),
  ).toBe(true);
  expect(
    h.querySelector('[data-square="38"]')?.classList.contains("target"),
  ).toBe(false);
  expect(
    h.querySelector('[data-square="10"]')?.classList.contains("target"),
  ).toBe(false);
  for (const square of [0, 14, 20])
    expect(
      h
        .querySelector(`[data-square="${square}"]`)
        ?.classList.contains("target"),
    ).toBe(true);
  for (const square of [3, 21, 27, 28])
    expect(
      h
        .querySelector(`[data-square="${square}"]`)
        ?.classList.contains("target"),
    ).toBe(false);
  b.dispose();
});
it("keyboard descriptions identify legal destinations and lifetime", () => {
  const h = document.createElement("div"),
    b = createBoard2D(h, () => {});
  b.render(
    gameWithWall(),
    { pieceId: null, candidate: null, summon: { kind: "carver", duration: 3 } },
    null,
  );
  expect(
    h.querySelector('[data-square="9"]')?.getAttribute("aria-label"),
  ).toContain("召喚できます");
  expect(
    h.querySelector('[data-square="10"]')?.getAttribute("aria-label"),
  ).toContain("残り3ターン");
  b.dispose();
});
it("pointer focus preserves one board tab stop when followed by arrow navigation", () => {
  const h = document.createElement("div");
  document.body.append(h);
  const b = createBoard2D(h, () => {});
  b.render(createGame(), { pieceId: null, candidate: null }, null);
  const square = h.querySelector<HTMLButtonElement>('[data-square="10"]')!;
  square.focus();
  square.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(h.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  expect((document.activeElement as HTMLElement).dataset.square).toBe("11");
  b.dispose();
  h.remove();
});
it("arrow keys at board edges do not scroll the page", () => {
  const h = document.createElement("div");
  const b = createBoard2D(h, () => {});
  const event = new KeyboardEvent("keydown", {
    key: "ArrowLeft",
    bubbles: true,
    cancelable: true,
  });
  h.querySelector<HTMLButtonElement>('[data-square="0"]')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  b.dispose();
});
