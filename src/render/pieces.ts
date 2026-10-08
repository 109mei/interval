import * as THREE from "three";
import type { Kind, Side } from "../game/types";

// Shared palette, not shared GPU resources: each model can be retired independently.
function materials(side: Side) {
  return {
    body: new THREE.MeshStandardMaterial({
      color: side === "white" ? 0xf1e6cc : 0x263948,
      roughness: 0.46,
      metalness: 0.12,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: side === "white" ? 0x987137 : 0x7ca7ae,
      metalness: 0.55,
      roughness: 0.34,
    }),
  };
}
function addMesh(
  group: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

// Small bevels catch the existing lights without textures or extra draw calls.
function chamferedBlock(
  width: number,
  height: number,
  depth: number,
  bevel = 0.018,
) {
  const x = width / 2 - bevel,
    y = height / 2 - bevel;
  const shape = new THREE.Shape();
  shape.moveTo(-x, -y);
  shape.lineTo(x, -y);
  shape.lineTo(x, y);
  shape.lineTo(-x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2 + bevel);
  return geometry;
}

function cleanCapsule() {
  const geometry = new THREE.CapsuleGeometry(0.11, 0.38, 8, 16);
  // Three's lathed capsule duplicates pole vertices. Drop its zero-area pole
  // faces while retaining the builtin normals, UVs and compact vertex buffer.
  const position = geometry.getAttribute("position"),
    index = geometry.index!;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const indices: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i),
      ib = index.getX(i + 1),
      ic = index.getX(i + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 4e-18) indices.push(ia, ib, ic);
  }
  geometry.setIndex(indices);
  return geometry;
}

export function createPieceModel(kind: Kind, side: Side): THREE.Group {
  const group = new THREE.Group(),
    { body, trim } = materials(side);
  const mesh = (
    name: string,
    geometry: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    material = body,
  ) => addMesh(group, name, geometry, material, x, y, z);
  mesh(
    `${kind}-foot`,
    new THREE.CylinderGeometry(0.33, 0.38, 0.12, 32),
    0,
    0.06,
    0,
  );
  mesh(
    "rim",
    new THREE.TorusGeometry(0.31, 0.022, 8, 32),
    0,
    0.135,
    0,
    trim,
  ).rotation.x = Math.PI / 2;

  if (kind === "bastion") {
    mesh("fortress", chamferedBlock(0.52, 0.4, 0.48), 0, 0.31, 0);
    mesh(
      "parapet-band",
      chamferedBlock(0.57, 0.045, 0.53, 0.01),
      0,
      0.475,
      0,
      trim,
    );
    for (const [column, x] of [-0.19, 0, 0.19].entries())
      for (const [row, z] of [-0.16, 0.16].entries())
        mesh(
          `battlement-${column}-${row}`,
          chamferedBlock(0.14, 0.18, 0.16, 0.012),
          x,
          0.565,
          z,
        );
  }
  if (kind === "carver") {
    mesh("stem", new THREE.CylinderGeometry(0.16, 0.23, 0.22, 24), 0, 0.22, 0);
    mesh(
      "blade-guard",
      new THREE.CylinderGeometry(0.21, 0.2, 0.055, 24),
      0,
      0.32,
      0,
      trim,
    );
    const shape = new THREE.Shape();
    shape.moveTo(-0.2, 0);
    shape.bezierCurveTo(-0.4, 0.3, -0.04, 0.62, 0.29, 0.78);
    shape.bezierCurveTo(0.13, 0.5, -0.02, 0.25, 0.19, 0);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.17,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 18,
    });
    // Keep the blade upright: a shallow rake aligns the black-facing blade
    // with the board camera and collapses its curved silhouette into a bar.
    mesh("curved-blade", geometry, 0, 0.32, -0.085);
  }
  if (kind === "leaper") {
    mesh("haunch", new THREE.SphereGeometry(0.22, 20, 16), -0.08, 0.325, 0.035);
    mesh("arched-body", cleanCapsule(), 0.005, 0.54, 0).rotation.z = -0.56;
    const head = mesh(
      "head",
      new THREE.SphereGeometry(0.16, 20, 16),
      0.17,
      0.75,
      0,
    );
    head.scale.set(1.08, 0.8, 0.85);
    for (const [index, z] of [-0.075, 0.075].entries())
      mesh(
        `ear-${index}`,
        new THREE.ConeGeometry(0.048, 0.2, 10),
        0.11,
        0.91,
        z,
      ).rotation.z = 0.18;
    const snout = mesh(
      "snout",
      new THREE.SphereGeometry(0.1, 16, 12),
      0.315,
      0.712,
      0,
    );
    snout.scale.set(1.25, 0.73, 0.86);
    for (const [index, z] of [-0.128, 0.128].entries())
      mesh(
        `eye-${index}`,
        new THREE.SphereGeometry(0.024, 10, 8),
        0.2,
        0.782,
        z,
        trim,
      );
    // A restrained mane carries the team's metal accent beyond the shared foot.
    const mane = mesh(
      "mane",
      new THREE.SphereGeometry(0.1, 12, 10),
      -0.075,
      0.65,
      0,
      trim,
    );
    mane.scale.set(0.55, 1.8, 1.06);
    mane.rotation.z = -0.56;
  }
  if (kind === "link") {
    mesh(
      "pedestal",
      new THREE.CylinderGeometry(0.19, 0.24, 0.2, 24),
      0,
      0.205,
      0,
    );
    const a = mesh(
      "ring-a",
      new THREE.TorusGeometry(0.22, 0.062, 10, 28),
      -0.1,
      0.47,
      0,
    );
    a.rotation.set(-1, 0.4, -0.14);
    const b = mesh(
      "ring-b",
      new THREE.TorusGeometry(0.22, 0.062, 10, 28),
      0.1,
      0.72,
      0,
      trim,
    );
    b.rotation.set(-1, -0.6, 0.14);
  }
  return group;
}

export function createCoreModel(side: Side) {
  const group = new THREE.Group(),
    { body, trim } = materials(side);
  addMesh(
    group,
    "core-foot",
    new THREE.CylinderGeometry(0.3, 0.39, 0.2, 6),
    body,
    0,
    0.1,
    0,
  );
  addMesh(
    group,
    "core-collar",
    new THREE.CylinderGeometry(0.275, 0.3, 0.045, 6),
    trim,
    0,
    0.21,
    0,
  );
  const crystal = addMesh(
    group,
    "core-crystal",
    new THREE.OctahedronGeometry(0.38),
    body,
    0,
    0.65,
    0,
  );
  crystal.scale.y = 1.3;
  addMesh(
    group,
    "core-girdle",
    new THREE.CylinderGeometry(0.38, 0.38, 0.035, 4),
    trim,
    0,
    0.65,
    0,
  );
  return group;
}

export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        materials.add(m);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
