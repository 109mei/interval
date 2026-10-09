// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createBoard2D } from "../src/render/board2d";
import { createBoard3D } from "../src/render/board3d";
import { createGame, previewAction, applyAction } from "../src/game/engine";
import { boardTargets } from "../src/render/board-targets";
import { legalActions, pieceActions } from "../src/game/rules";
import type { GameState, Piece, Selection } from "../src/game/types";
vi.mock("three", async (original) => ({
  ...(await original<typeof import("three")>()),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    shadowMap = {};
    setPixelRatio() {}
    setClearColor() {}
    setSize() {}
    render() {}
    dispose() {}
  },
}));
const views: ReturnType<typeof createBoard2D>[] = [];
const p = (
  id: string,
  kind: Piece["kind"],
  square: number,
  side: Piece["side"] = "white",
  remaining = 3,
): Piece => ({ id, kind, square, side, remaining, summonedPly: -1 });
function state(pieces: Piece[], turn: GameState["turn"] = "white"): GameState {
  return { ...createGame(), pieces, turn };
}
function host(mode: "2d" | "3d") {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("devicePixelRatio", 1);
  const h = document.createElement("div");
  Object.defineProperty(h, "clientWidth", { value: 308 });
  document.body.append(h);
  const b =
    mode === "2d"
      ? createBoard2D(h, () => {})
      : createBoard3D(
          h,
          () => {},
          () => {
            throw Error("renderer failure");
          },
        );
  views.push(b);
  return { h, b };
}
afterEach(() => {
  views.splice(0).forEach((b) => b.dispose());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
for (const mode of ["2d", "3d"] as const) {
  it(`${mode}: empty move and enemy capture have distinct persistent shape markers`, () => {
    const { h, b } = host(mode);
    const s = state([p("m", "carver", 16), p("enemy", "bastion", 25, "black")]);
    b.render(s, { pieceId: "m", candidate: null }, null);
    expect(
      h.querySelector('[data-square="24"]')?.getAttribute("data-target-kind"),
    ).toBe("move");
    expect(
      h.querySelector('[data-square="25"]')?.getAttribute("data-target-kind"),
    ).toBe("capture");
    expect(
      h
        .querySelector('[data-square="25"] .destination-marker')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      h.querySelector('[data-square="25"]')?.getAttribute("aria-label"),
    ).toContain("捕獲");
    expect(
      h.querySelector('[data-square="16"]')?.classList.contains("selected"),
    ).toBe(true);
    expect(
      h.querySelector('[data-square="16"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
  it(`${mode}: Link swaps differ from captures and retain the ally lifetime`, () => {
    const { h, b } = host(mode);
    const s = state([
      p("m", "link", 16),
      p("ally", "leaper", 17),
      p("enemy", "carver", 15, "black"),
    ]);
    b.render(s, { pieceId: "m", candidate: null }, null);
    expect(
      h.querySelector('[data-square="17"]')?.getAttribute("data-target-kind"),
    ).toBe("swap");
    expect(
      h.querySelector('[data-square="17"]')?.getAttribute("aria-label"),
    ).toContain("交換");
    expect(
      h.querySelector('[data-square="15"]')?.getAttribute("data-target-kind"),
    ).toBeNull();
    expect(
      mode === "2d"
        ? h.querySelector('[data-square="17"] .life')?.textContent
        : h.querySelector('[data-life-for="ally"]')?.textContent,
    ).toBe("3");
  });
  it(`${mode}: summon markers are separate and clear completely after deselection`, () => {
    const { h, b } = host(mode);
    b.render(
      createGame(),
      {
        pieceId: null,
        candidate: null,
        summon: { kind: "carver", duration: 3 },
      },
      null,
    );
    expect(h.querySelectorAll('[data-target-kind="summon"]')).toHaveLength(20);
    expect(
      [...h.querySelectorAll<HTMLElement>('[data-target-kind="summon"]')]
        .map((cell) => Number(cell.dataset.square))
        .sort((a, b) => a - b),
    ).toEqual([
      0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    b.render(createGame(), { pieceId: null, candidate: null }, null);
    expect(h.querySelector(".destination-marker")).toBeNull();
  });
  it(`${mode}: inspection is visibly read-only and cannot advertise available actions`, () => {
    const { h, b } = host(mode);
    const s = state([p("m", "carver", 16, "black"), p("enemy", "bastion", 25)]);
    b.render(s, { pieceId: "m", candidate: null }, null);
    const t = h.querySelector<HTMLElement>('[data-square="25"]')!;
    expect(t.classList.contains("inspect-target")).toBe(true);
    expect(t.classList.contains("target")).toBe(false);
    expect(t.dataset.available).toBe("false");
    expect(t.querySelector(".destination-marker")).toBeNull();
    expect(t.getAttribute("aria-label")).toContain("捕獲先の参考");
  });
  it(`${mode}: chosen destination and selected origin coexist without dropping other moves`, () => {
    const { h, b } = host(mode);
    const s = state([p("m", "carver", 16)]);
    const sel: Selection = {
      pieceId: "m",
      candidate: { type: "move", pieceId: "m", to: 24 },
    };
    b.render(s, sel, previewAction(s, sel.candidate!));
    expect(
      h.querySelector('[data-square="24"]')?.classList.contains("candidate"),
    ).toBe(true);
    expect(
      h.querySelector('[data-square="24"]')?.getAttribute("aria-label"),
    ).toContain("選んだ行き先");
    expect(
      h.querySelector('[data-square="16"]')?.classList.contains("selected"),
    ).toBe(true);
    expect(h.querySelectorAll('[data-target-kind="move"]').length).toBe(
      pieceActions(s, s.pieces[0]).length,
    );
  });
  it(`${mode}: core capture is marked as capture and final state has no stale legal markers`, () => {
    const { h, b } = host(mode);
    const s = state([p("m", "carver", 37)]);
    b.render(s, { pieceId: "m", candidate: null }, null);
    expect(
      h.querySelector('[data-square="45"]')?.getAttribute("data-target-kind"),
    ).toBe("capture");
    const result = applyAction(s, { type: "move", pieceId: "m", to: 45 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    b.render(result.state, { pieceId: null, candidate: null }, null, {
      before: s,
      events: result.events,
    });
    expect(h.querySelector(".destination-marker")).toBeNull();
  });
}
it("classification preserves every legal target across pieces, sides, empty, blocked and occupied boards", () => {
  for (const side of ["white", "black"] as const)
    for (const kind of ["carver", "leaper", "link", "bastion"] as const)
      for (const square of [0, 8, 16, 24, 32, 40, 48]) {
        const s = state(
          [
            p("m", kind, square, side),
            ...[1, -1, 7, -7].flatMap((d, i) => {
              const q = square + d;
              return q < 0 || q > 48 || q === 3 || q === 45
                ? []
                : [
                    p(
                      `other${i}`,
                      "bastion",
                      q,
                      i % 2 ? side : side === "white" ? "black" : "white",
                    ),
                  ];
            }),
          ],
          side,
        );
        const expected = legalActions(s).flatMap((a) =>
          a.type === "move" && a.pieceId === "m"
            ? [a.to]
            : a.type === "swap" && a.pieceId === "m"
              ? [s.pieces.find((p) => p.id === a.allyId)!.square]
              : [],
        );
        expect(
          [...boardTargets(s, { pieceId: "m", candidate: null }).targets].sort(
            (a, b) => a - b,
          ),
        ).toEqual([...new Set(expected)].sort((a, b) => a - b));
      }
});

it("Nao and Mika see an adjacent destination legend without losing exact selection through an invalid tap", async () => {
  vi.resetModules();
  history.replaceState(null, "", "/?2d");
  document.body.innerHTML = '<div id="app"></div>';
  await import("../src/main");
  const click = (q: string) =>
    document.querySelector<HTMLButtonElement>(q)!.click();
  click("#choose-local");
  click("#start-game");
  click("#summon");
  click('[data-kind="carver"]');
  expect(document.getElementById("target-legend")?.textContent).toContain(
    "召喚 20",
  );
  click('[data-square="9"]');
  expect(document.getElementById("target-legend")?.textContent).toContain("c2");
  expect(document.getElementById("target-legend")?.textContent).toContain(
    "確定前",
  );
  click("#confirm");
  await Promise.resolve();
  await Promise.resolve();
  click("#pass");
  click("#confirm");
  await Promise.resolve();
  await Promise.resolve();
  click('[data-square="9"]');
  const before = document.querySelectorAll('[data-target-kind="move"]').length;
  expect(document.getElementById("target-legend")?.textContent).toContain(
    "c2 選択中",
  );
  expect(before).toBeGreaterThan(0);
  const legendNode = document.getElementById("target-legend")!.firstChild;
  click('[data-square="16"]');
  expect(document.getElementById("target-legend")!.firstChild).toBe(legendNode);
  expect(document.querySelectorAll('[data-target-kind="move"]').length).toBe(
    before,
  );
  expect(document.getElementById("target-legend")?.textContent).toContain(
    "c2 選択中",
  );
  click("#cancel");
  expect(document.getElementById("target-legend")?.hidden).toBe(true);
  // This real-main board is not in the fixture's `views` array. Settle its
  // animation before jsdom removes the window and its RAF globals.
  vi.spyOn(window, "confirm").mockReturnValue(true);
  click("#home-button");
  expect(document.getElementById("home")?.hidden).toBe(false);
  expect(
    document.querySelector("[data-moving-piece],[data-effect]"),
  ).toBeNull();
});
it("markers cannot paint over role and lifetime labels in either renderer", async () => {
  const { readFileSync } = await import("node:fs");
  const style = document.createElement("style");
  style.textContent = readFileSync("src/ui/styles.css", "utf8");
  document.head.append(style);
  const { h, b } = host("2d");
  b.render(
    state([p("m", "link", 16), p("ally", "leaper", 17)]),
    { pieceId: "m", candidate: null },
    null,
  );
  const life = h.querySelector('[data-square="17"] .life')!;
  const role = h.querySelector('[data-square="17"] .piece-mark')!;
  expect(Number(getComputedStyle(life).zIndex)).toBeGreaterThan(
    Number(getComputedStyle(h.querySelector(".destination-marker")!).zIndex),
  );
  expect(Number(getComputedStyle(role).zIndex)).toBeGreaterThan(
    Number(getComputedStyle(h.querySelector(".destination-marker")!).zIndex),
  );
  const three = host("3d");
  expect(
    Number(getComputedStyle(three.h.querySelector(".overlay-labels")!).zIndex),
  ).toBeGreaterThan(
    Number(getComputedStyle(three.h.querySelector(".three-keys")!).zIndex),
  );
  style.remove();
});

it("projected swap arrows stay between lifetime rows on narrow boards", async () => {
  const { readFileSync } = await import("node:fs");
  const style = document.createElement("style");
  style.textContent = readFileSync("src/ui/styles.css", "utf8");
  document.head.append(style);
  const { h, b } = host("3d");
  b.render(
    state([p("m", "link", 16), p("ally", "leaper", 17)]),
    { pieceId: "m", candidate: null },
    null,
  );
  const css = getComputedStyle(h.querySelector(".marker-swap")!);
  expect(
    h.querySelector(".marker-swap svg")?.getAttribute("preserveAspectRatio"),
  ).toBe("none");
  const camera = new THREE.OrthographicCamera(
    -3.92,
    3.92,
    3.92,
    -3.92,
    0.1,
    80,
  );
  camera.position.set(0, 13, 4.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  for (const size of [278, 308, 412]) {
    const project = (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: (v.x * size) / 2, y: (-v.y * size) / 2 };
    };
    const center = project(0, 0.05, 0);
    const keyW = size * 0.116,
      keyH = size * 0.108;
    const width = parseFloat(css.width),
      height = parseFloat(css.height);
    const x =
      css.left === "50%" ? 0 : keyW / 2 - parseFloat(css.right) - width / 2;
    const y =
      css.top === "25%"
        ? -keyH / 4
        : -keyH / 2 + parseFloat(css.top) + height / 2;
    for (let col = -1; col <= 1; col++)
      for (let row = -1; row <= 1; row++) {
        const anchor = project(col + 0.3, 0.12, -row + 0.3);
        const ax = anchor.x - center.x,
          ay = anchor.y - center.y;
        for (const label of [
          { left: ax - 10, right: ax + 10, top: ay - 10, bottom: ay + 10 },
          { left: ax - 30, right: ax - 13, top: ay - 9, bottom: ay + 9 },
        ]) {
          const overlapX = Math.max(
            0,
            Math.min(x + width / 2, label.right) -
              Math.max(x - width / 2, label.left),
          );
          const overlapY = Math.max(
            0,
            Math.min(y + height / 2, label.bottom) -
              Math.max(y - height / 2, label.top),
          );
          expect(
            overlapX * overlapY,
            `${size}px: swap must not overlap own or adjacent role/life`,
          ).toBe(0);
        }
      }
  }
  style.remove();
});
