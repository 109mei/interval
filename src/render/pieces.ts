import * as THREE from "three";
import type { Kind, Side } from "../game/types";
export function createPieceModel(kind: Kind, side: Side): THREE.Group {
  const group = new THREE.Group(),
    mat = new THREE.MeshStandardMaterial({
      color: side === "white" ? 0xf1e6cc : 0x263948,
      roughness: 0.35,
      metalness: 0.12,
    });
  const trim = new THREE.MeshStandardMaterial({
    color: side === "white" ? 0xb28b48 : 0x7ca7ae,
    metalness: 0.7,
    roughness: 0.28,
  });
  function mesh(
    name: string,
    geo: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    material = mat,
  ) {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
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
    mesh("fortress", new THREE.BoxGeometry(0.52, 0.35, 0.48), 0, 0.3, 0);
    for (const x of [-0.19, 0, 0.19])
      for (const z of [-0.16, 0.16])
        mesh("battlement", new THREE.BoxGeometry(0.13, 0.17, 0.15), x, 0.55, z);
  }
  if (kind === "carver") {
    mesh("stem", new THREE.CylinderGeometry(0.16, 0.23, 0.2, 24), 0, 0.22, 0);
    const shape = new THREE.Shape();
    shape.moveTo(-0.2, 0);
    shape.bezierCurveTo(-0.4, 0.35, -0.04, 0.73, 0.29, 0.92);
    shape.bezierCurveTo(0.13, 0.6, -0.02, 0.3, 0.19, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.13,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 20,
    });
    mesh("curved-blade", geo, 0, 0.3, -0.07);
  }
  if (kind === "leaper") {
    mesh("haunch", new THREE.SphereGeometry(0.22, 20, 16), -0.08, 0.35, 0.05);
    const body = mesh(
      "arched-body",
      new THREE.CapsuleGeometry(0.11, 0.38, 8, 16),
      0.01,
      0.55,
      0,
    );
    body.rotation.z = -0.6;
    const head = mesh(
      "head",
      new THREE.SphereGeometry(0.16, 20, 16),
      0.2,
      0.76,
      0,
    );
    head.scale.set(1.1, 0.8, 0.85);
    mesh(
      "ear",
      new THREE.ConeGeometry(0.065, 0.23, 12),
      0.13,
      0.93,
      0,
    ).rotation.z = 0.25;
    mesh(
      "snout",
      new THREE.ConeGeometry(0.09, 0.22, 12),
      0.37,
      0.72,
      0,
    ).rotation.z = -Math.PI / 2;
  }
  if (kind === "link") {
    mesh(
      "pedestal",
      new THREE.CylinderGeometry(0.19, 0.24, 0.17, 24),
      0,
      0.23,
      0,
    );
    const a = mesh(
      "ring-a",
      new THREE.TorusGeometry(0.22, 0.065, 12, 32),
      -0.1,
      0.55,
      0,
    );
    a.rotation.y = 0.4;
    const b = mesh(
      "ring-b",
      new THREE.TorusGeometry(0.22, 0.065, 12, 32),
      0.1,
      0.77,
      0,
      trim,
    );
    b.rotation.y = -0.6;
  }
  return group;
}
export function createCoreModel(side: Side) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: side === "white" ? 0xe5d6af : 0x2e4551,
    metalness: 0.35,
    roughness: 0.23,
  });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.39, 0.2, 6),
    mat,
  );
  base.position.y = 0.1;
  g.add(base);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), mat);
  crystal.scale.y = 1.3;
  crystal.position.y = 0.65;
  crystal.castShadow = true;
  g.add(crystal);
  return g;
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
