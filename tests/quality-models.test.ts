import { expect } from "vitest";
import * as THREE from "three";
import {
  createPieceModel,
  createCoreModel,
  disposeObject,
} from "../src/render/pieces";
import type { Side } from "../src/game/types";
import { createCaseLedger } from "./quality/case-ledger";
import {
  modelScenarios,
  type ModelKind,
  type ModelScenario,
  type ModelView,
} from "./quality/model-cases";

// These tests use real Three.js geometry and a CPU triangle rasterizer.
// They never instantiate or mock WebGLRenderer and never establish GPU fidelity.
const { registerCase } = createCaseLedger("models");
const build = (kind: ModelKind, side: Side) =>
  kind === "core" ? createCoreModel(side) : createPieceModel(kind, side);
const meshes = (root: THREE.Object3D) => {
  const result: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
  >[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
};
const materials = (root: THREE.Object3D) => [
  ...new Set(
    meshes(root).flatMap((mesh) =>
      Array.isArray(mesh.material) ? mesh.material : [mesh.material],
    ),
  ),
];
const geometries = (root: THREE.Object3D) => [
  ...new Set(meshes(root).map((mesh) => mesh.geometry)),
];
const luminance = (color: THREE.Color) =>
  0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
const contrast = (a: THREE.Color, b: THREE.Color) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
const box = (root: THREE.Object3D) =>
  new THREE.Box3().setFromObject(root, true);
const triangleCount = (geometry: THREE.BufferGeometry) =>
  (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
const isFoot = (mesh: THREE.Mesh) => /foot|plinth|^base$/.test(mesh.name);
const projectionCache = new Map<string, Uint8Array>();
function projectRole(kind: ModelKind, side: Side, view: ModelView) {
  const key = `${kind}:${side}:${view}`;
  if (projectionCache.has(key)) return projectionCache.get(key)!;
  const root = build(kind, side);
  // Match the board's white/black facing and exact 13:4.8 camera slope.
  if (side === "black") root.rotation.y = Math.PI;
  root.updateMatrixWorld(true);
  const camera = new THREE.OrthographicCamera(-0.8, 0.8, 0.8, -0.8, 0.1, 40);
  camera.position.set(
    ...((view === "board"
      ? [0, 13.4, 4.8]
      : view === "top"
        ? [0, 13.4, 0.0001]
        : [4.8, 7.4, 6.8]) as [number, number, number]),
  );
  camera.lookAt(0, 0.4, 0);
  camera.updateMatrixWorld(true);
  const size = 96,
    mask = new Uint8Array(size * size);
  const vector = new THREE.Vector3();
  for (const mesh of meshes(root)) {
    if (isFoot(mesh) || mesh.name === "rim") continue;
    const position = mesh.geometry.getAttribute("position"),
      index = mesh.geometry.index;
    const projected = Array.from({ length: position.count }, (_, i) => {
      vector
        .fromBufferAttribute(position, i)
        .applyMatrix4(mesh.matrixWorld)
        .project(camera);
      return [((vector.x + 1) * size) / 2, ((1 - vector.y) * size) / 2];
    });
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const points = [0, 1, 2].map(
        (d) => projected[index ? index.getX(i + d) : i + d],
      );
      const minX = Math.max(
        0,
        Math.floor(Math.min(...points.map((v) => v[0]))),
      );
      const maxX = Math.min(
        size - 1,
        Math.ceil(Math.max(...points.map((v) => v[0]))),
      );
      const minY = Math.max(
        0,
        Math.floor(Math.min(...points.map((v) => v[1]))),
      );
      const maxY = Math.min(
        size - 1,
        Math.ceil(Math.max(...points.map((v) => v[1]))),
      );
      const edge = (a: number[], b: number[], x: number, y: number) =>
        (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (
        Math.abs(edge(points[0], points[1], points[2][0], points[2][1])) < 1e-8
      )
        continue;
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const signs = points.map((point, j) =>
            edge(point, points[(j + 1) % 3], x + 0.5, y + 0.5),
          );
          if (signs.every((v) => v >= -1e-8) || signs.every((v) => v <= 1e-8))
            mask[y * size + x] = 1;
        }
    }
  }
  disposeObject(root);
  projectionCache.set(key, mask);
  return mask;
}
function checkGeometry(root: THREE.Group, scenario: ModelScenario) {
  const allMeshes = meshes(root),
    allGeometries = geometries(root),
    bounds = box(root);
  switch (scenario.check) {
    case "finite-positions":
      for (const geometry of allGeometries) {
        const p = geometry.getAttribute("position");
        expect(p.count).toBeGreaterThan(2);
        expect([...p.array].every(Number.isFinite)).toBe(true);
      }
      break;
    case "finite-normals":
      for (const geometry of allGeometries) {
        expect(geometry.getAttribute("normal").count).toBe(
          geometry.getAttribute("position").count,
        );
        expect(
          [...geometry.getAttribute("normal").array].every(Number.isFinite),
        ).toBe(true);
      }
      break;
    case "unit-normals":
      for (const geometry of allGeometries) {
        const n = geometry.getAttribute("normal");
        for (let i = 0; i < n.count; i++)
          expect(
            Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1),
          ).toBeLessThan(0.002);
      }
      break;
    case "bounded-uvs":
      for (const geometry of allGeometries)
        for (const value of geometry.getAttribute("uv").array) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(-1);
          expect(value).toBeLessThanOrEqual(2);
        }
      break;
    case "nondegenerate-triangles":
      for (const mesh of allMeshes) {
        const geometry = mesh.geometry,
          p = geometry.getAttribute("position"),
          index = geometry.index;
        for (let i = 0; i < (index?.count ?? p.count); i += 3) {
          const [a, b, c] = [0, 1, 2].map((d) =>
            new THREE.Vector3().fromBufferAttribute(
              p,
              index ? index.getX(i + d) : i + d,
            ),
          );
          expect(
            b.sub(a).cross(c.sub(a)).length() / 2,
            `${mesh.name} triangle ${i / 3}`,
          ).toBeGreaterThan(1e-9);
        }
      }
      break;
    case "valid-indices":
      for (const geometry of allGeometries) {
        const p = geometry.getAttribute("position"),
          index = geometry.index;
        expect((index?.count ?? p.count) % 3).toBe(0);
        if (index)
          for (const value of index.array) {
            expect(
              Number.isInteger(value) && value >= 0 && value < p.count,
            ).toBe(true);
          }
      }
      break;
    case "floor-contact":
      expect(Math.abs(bounds.min.y)).toBeLessThan(1e-6);
      break;
    case "tile-clearance":
      for (const axis of ["x", "z"] as const) {
        expect(bounds.min[axis]).toBeGreaterThanOrEqual(-0.46);
        expect(bounds.max[axis]).toBeLessThanOrEqual(0.46);
      }
      break;
    case "height-envelope":
      expect(bounds.max.y).toBeLessThanOrEqual(1.16);
      break;
    case "substantial-volume":
      {
        const size = bounds.getSize(new THREE.Vector3());
        expect(size.x).toBeGreaterThanOrEqual(0.6);
        expect(size.z).toBeGreaterThanOrEqual(0.6);
        expect(size.y).toBeGreaterThanOrEqual(0.55);
      }
      break;
    case "unique-part-names":
      expect(allMeshes.every((mesh) => mesh.name.trim().length > 0)).toBe(true);
      expect(new Set(allMeshes.map((mesh) => mesh.name)).size).toBe(
        allMeshes.length,
      );
      break;
    case "positive-scales":
      for (const mesh of allMeshes) {
        expect(
          mesh.scale.toArray().every((v) => Number.isFinite(v) && v > 0),
        ).toBe(true);
        expect(
          [
            ...mesh.position.toArray(),
            mesh.rotation.x,
            mesh.rotation.y,
            mesh.rotation.z,
          ].every(Number.isFinite),
        ).toBe(true);
      }
      break;
    case "cast-shadows":
      expect(allMeshes.every((mesh) => mesh.castShadow)).toBe(true);
      break;
    case "receive-shadows":
      expect(allMeshes.every((mesh) => mesh.receiveShadow)).toBe(true);
      break;
    case "draw-call-budget":
      expect(allMeshes.length).toBeLessThanOrEqual(18);
      break;
    case "triangle-budget":
      expect(
        allMeshes.reduce((sum, mesh) => sum + triangleCount(mesh.geometry), 0),
      ).toBeLessThanOrEqual(5000);
      break;
    case "material-budget":
      expect(materials(root).length).toBeGreaterThanOrEqual(2);
      expect(materials(root).length).toBeLessThanOrEqual(3);
      break;
    case "solid-plinth-support":
      {
        const foot = allMeshes.find(isFoot) ?? allMeshes[0];
        const footMaterial = foot.material;
        const solids = allMeshes.filter(
          (mesh) =>
            mesh !== foot &&
            mesh.material === footMaterial &&
            mesh.name !== "rim",
        );
        expect(solids.length).toBeGreaterThan(0);
        const bottom = Math.min(...solids.map((mesh) => box(mesh).min.y));
        expect(bottom - box(foot).max.y).toBeLessThanOrEqual(0.002);
        // Bounding boxes alone can mistake a decorative rim or an overhang for
        // support. Confirm actual opposing surfaces overlap at a shared x/z.
        const down = new THREE.Vector3(0, -1, 0),
          up = new THREE.Vector3(0, 1, 0);
        const ray = new THREE.Raycaster();
        let supported = false;
        for (const x of [-0.24, -0.12, 0, 0.12, 0.24]) {
          for (const z of [-0.24, -0.12, 0, 0.12, 0.24]) {
            ray.set(new THREE.Vector3(x, 0.5, z), down);
            const footTop = ray.intersectObject(foot, false)[0]?.point.y;
            ray.set(new THREE.Vector3(x, -0.1, z), up);
            const bodyBottom = ray.intersectObjects(solids, false)[0]?.point.y;
            if (
              footTop !== undefined &&
              bodyBottom !== undefined &&
              bodyBottom <= footTop + 0.002
            )
              supported = true;
          }
        }
        expect(supported).toBe(true);
      }
      break;
    default:
      throw Error(`Missing geometry oracle: ${scenario.check}`);
  }
}
function checkSurface(root: THREE.Group, check: string) {
  const mats = materials(root);
  switch (check) {
    case "standard-pbr":
      for (const material of mats) {
        expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
        for (const value of Object.values(material))
          expect(value instanceof THREE.Texture).toBe(false);
      }
      break;
    case "opaque-surfaces":
      for (const material of mats) {
        expect(material.transparent).toBe(false);
        expect(material.opacity).toBe(1);
        expect(material.depthWrite).toBe(true);
        expect(material.side).toBe(THREE.FrontSide);
      }
      break;
    case "roughness-range":
      for (const material of mats) {
        expect(material.roughness).toBeGreaterThanOrEqual(0.3);
        expect(material.roughness).toBeLessThanOrEqual(0.75);
      }
      break;
    case "metalness-range":
      for (const material of mats) {
        expect(material.metalness).toBeGreaterThanOrEqual(0);
        expect(material.metalness).toBeLessThanOrEqual(0.65);
      }
      break;
    case "accent-grayscale-contrast":
      expect(mats.length).toBeGreaterThanOrEqual(2);
      expect(contrast(mats[0].color, mats[1].color)).toBeGreaterThanOrEqual(3);
      break;
    case "buffer-budget":
      {
        const bytes = geometries(root).reduce(
          (sum, geometry) =>
            sum +
            Object.values(geometry.attributes).reduce(
              (value, attr) => value + attr.array.byteLength,
              0,
            ) +
            (geometry.index?.array.byteLength ?? 0),
          0,
        );
        expect(bytes).toBeLessThanOrEqual(200000);
      }
      break;
    default:
      throw Error(`Missing surface oracle: ${check}`);
  }
}
function checkTeam(kind: ModelKind, check: string) {
  const white = build(kind, "white"),
    black = build(kind, "black");
  try {
    if (check === "matching-geometry") {
      const wa = meshes(white),
        ba = meshes(black);
      expect(wa.length).toBe(ba.length);
      wa.forEach((mesh, i) => {
        expect(mesh.geometry.getAttribute("position").array).toEqual(
          ba[i].geometry.getAttribute("position").array,
        );
        expect(mesh.geometry.index?.array).toEqual(ba[i].geometry.index?.array);
      });
    } else if (check === "matching-part-transforms") {
      const describe = (root: THREE.Group) =>
        meshes(root).map((mesh) => ({
          name: mesh.name,
          position: mesh.position.toArray(),
          scale: mesh.scale.toArray(),
          rotation: mesh.rotation.toArray(),
        }));
      expect(describe(white)).toEqual(describe(black));
    } else if (check === "grayscale-team-contrast")
      expect(
        contrast(materials(white)[0].color, materials(black)[0].color),
      ).toBeGreaterThanOrEqual(7);
    else if (check === "independent-ownership") {
      expect(
        geometries(white).every(
          (geometry) => !geometries(black).includes(geometry),
        ),
      ).toBe(true);
      expect(
        materials(white).every(
          (material) => !materials(black).includes(material),
        ),
      ).toBe(true);
    } else throw Error(`Missing team oracle: ${check}`);
  } finally {
    disposeObject(white);
    disposeObject(black);
  }
}
function checkDisposal(root: THREE.Group, check: string) {
  const geo = geometries(root),
    mats = materials(root),
    counts = new Map<THREE.BufferGeometry | THREE.Material, number>();
  for (const resource of [...geo, ...mats]) {
    counts.set(resource, 0);
    resource.addEventListener("dispose", () =>
      counts.set(resource, counts.get(resource)! + 1),
    );
  }
  if (check === "all-geometries-once") {
    disposeObject(root);
    for (const resource of geo) expect(counts.get(resource)).toBe(1);
  } else if (check === "all-materials-once") {
    disposeObject(root);
    for (const resource of mats) expect(counts.get(resource)).toBe(1);
  } else if (check === "nested-group-ownership") {
    const parent = new THREE.Group(),
      scene = new THREE.Group(),
      unrelated = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial(),
      );
    let unrelatedDisposals = 0;
    unrelated.geometry.addEventListener("dispose", () => unrelatedDisposals++);
    scene.add(parent, unrelated);
    parent.add(root);
    disposeObject(parent);
    for (const count of counts.values()) expect(count).toBe(1);
    expect(unrelatedDisposals).toBe(0);
    disposeObject(unrelated);
  } else if (check === "shared-reference-deduplication") {
    const duplicate = new THREE.Mesh(geo[0], [
      mats[0],
      mats[0],
      mats[1] ?? mats[0],
    ]);
    root.add(duplicate);
    disposeObject(root);
    for (const count of counts.values()) expect(count).toBe(1);
  } else if (check === "preserve-transforms") {
    root.position.set(3, 0.2, -3);
    root.rotation.y = Math.PI;
    const before = root.toJSON();
    disposeObject(root);
    expect(root.toJSON()).toEqual(before);
    for (const count of counts.values()) expect(count).toBe(1);
  } else throw Error(`Missing disposal oracle: ${check}`);
}
for (const scenario of modelScenarios)
  registerCase(scenario, () => {
    if (scenario.category === "model.team-parity") {
      checkTeam(scenario.kind, scenario.check);
      return;
    }
    if (scenario.check === "distinct") {
      const a = projectRole(scenario.kind, scenario.side!, scenario.view!),
        b = projectRole(scenario.other!, scenario.side!, scenario.view!);
      let union = 0,
        difference = 0;
      a.forEach((value, i) => {
        if (value || b[i]) union++;
        if (value !== b[i]) difference++;
      });
      expect(difference / union).toBeGreaterThanOrEqual(0.12);
      return;
    }
    if (scenario.check === "coverage") {
      const mask = projectRole(scenario.kind, scenario.side!, scenario.view!);
      const occupied = Array.from(mask.entries())
        .filter(([, value]) => value)
        .map(([i]) => [i % 96, Math.floor(i / 96)]);
      expect(occupied.length).toBeGreaterThanOrEqual(80);
      for (const axis of [0, 1]) {
        const min = Math.min(...occupied.map((point) => point[axis])),
          max = Math.max(...occupied.map((point) => point[axis]));
        expect(min).toBeGreaterThan(0);
        expect(max).toBeLessThan(95);
        expect(max - min).toBeGreaterThanOrEqual(8);
      }
      if (scenario.view === "board" && scenario.kind === "carver") {
        const root = build("carver", scenario.side!);
        if (scenario.side === "black") root.rotation.y = Math.PI;
        root.updateMatrixWorld(true);
        const blade = root.getObjectByName("curved-blade") as THREE.Mesh;
        const camera = new THREE.OrthographicCamera(
          -0.8,
          0.8,
          0.8,
          -0.8,
          0.1,
          40,
        );
        camera.position.set(0, 13.4, 4.8);
        camera.lookAt(0, 0.4, 0);
        camera.updateMatrixWorld(true);
        const p = blade.geometry.getAttribute("position");
        const heights = Array.from(
          { length: p.count },
          (_, index) =>
            new THREE.Vector3()
              .fromBufferAttribute(p, index)
              .applyMatrix4(blade.matrixWorld)
              .project(camera).y,
        );
        try {
          // 0.3 world units projects to ~12 px at the 308px board size.
          // This checks the blade itself, so the common plinth cannot hide a
          // camera-aligned blade collapsing into an unrecognizable thin bar.
          expect(
            (Math.max(...heights) - Math.min(...heights)) * 0.8,
          ).toBeGreaterThanOrEqual(0.3);
        } finally {
          disposeObject(root);
        }
      }
      if (scenario.view === "board" && scenario.kind === "link") {
        const root = build("link", scenario.side!);
        if (scenario.side === "black") root.rotation.y = Math.PI;
        root.updateMatrixWorld(true);
        const viewDirection = new THREE.Vector3(0, 13, 4.8).normalize();
        try {
          for (const name of ["ring-a", "ring-b"]) {
            const ring = root.getObjectByName(name)!;
            const normal = new THREE.Vector3(0, 0, 1).transformDirection(
              ring.matrixWorld,
            );
            // Bound foreshortening of each ring's aperture for both facings.
            expect(Math.abs(normal.dot(viewDirection))).toBeGreaterThanOrEqual(
              0.42,
            );
          }
        } finally {
          disposeObject(root);
        }
      }
      return;
    }
    const root = build(scenario.kind, scenario.side!);
    try {
      if (scenario.category === "model.geometry") checkGeometry(root, scenario);
      else if (scenario.category === "model.surface-resource")
        checkSurface(root, scenario.check);
      else if (scenario.category === "model.resource-disposal") {
        checkDisposal(root, scenario.check);
        return;
      } else throw Error(`Missing model scenario: ${scenario.id}`);
    } finally {
      if (scenario.category !== "model.resource-disposal") disposeObject(root);
    }
  });
