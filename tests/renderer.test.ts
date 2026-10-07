// @vitest-environment jsdom
import { it, expect } from "vitest";
import * as THREE from "three";
import { createPieceModel, disposeObject } from "../src/render/pieces";
import { createAdaptiveBoard } from "../src/render/adaptive";
import { createGame } from "../src/game/engine";
it("four_distinct_models", () => {
  const signatures = new Set<string>();
  for (const k of ["bastion", "carver", "leaper", "link"] as const) {
    const g = createPieceModel(k, "white");
    let meshes = 0;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(1);
    signatures.add(g.children.map((o) => o.name).join(","));
    expect(new THREE.Box3().setFromObject(g).max.y).toBeGreaterThan(0.4);
    disposeObject(g);
  }
  expect(signatures.size).toBe(4);
});
it("dispose_releases_resources", () => {
  const g = createPieceModel("link", "black");
  let disposed = 0,
    meshes = 0;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      o.geometry.addEventListener("dispose", () => disposed++);
    }
  });
  disposeObject(g);
  expect(disposed).toBeGreaterThan(0);
  expect(disposed).toBeLessThanOrEqual(meshes);
});
it("fallback_preserves_state", () => {
  const h = document.createElement("div");
  let label = "";
  const b = createAdaptiveBoard(
      h,
      () => {},
      () => {
        throw Error("No GPU");
      },
      (m) => (label = m),
    ),
    s = createGame();
  const before = JSON.stringify(s);
  b.render(s, { pieceId: null, candidate: null }, null);
  expect(h.querySelectorAll("[data-square]")).toHaveLength(49);
  expect(label).toContain("2D");
  expect(JSON.stringify(s)).toBe(before);
  b.dispose();
});
it("context_loss_replays_latest_state", () => {
  const h = document.createElement("div");
  let fail = () => {};
  const s = createGame();
  let renders = 0;
  const b = createAdaptiveBoard(
    h,
    () => {},
    (failure) => {
      fail = failure;
      return {
        render() {
          renders++;
        },
        dispose() {},
      };
    },
    () => {},
  );
  b.render(s, { pieceId: null, candidate: null }, null);
  fail();
  expect(renders).toBe(1);
  expect(h.querySelectorAll("[data-square]")).toHaveLength(49);
  b.dispose();
});
