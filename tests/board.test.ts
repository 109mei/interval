// @vitest-environment jsdom
import { it, expect } from "vitest";
import { createBoard2D } from "../src/render/board2d";
import { createGame } from "../src/game/engine";
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
