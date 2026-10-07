import * as THREE from "three";
import type { BoardView } from "./board-view";
import type { GameState, Selection, Preview } from "../game/types";
import { createPieceModel, createCoreModel, disposeObject } from "./pieces";
import { legalActions } from "../game/rules";
import { INFO, squareName } from "../ui/piece-info";
export function createBoard3D(
  host: HTMLElement,
  onSquare: (q: number) => void,
  onFailure: () => void,
): BoardView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x243031, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(-3.92, 3.92, 3.92, -3.92, 0.1, 80);
  camera.position.set(0, 13, 4.8);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3f5a63, 2));
  const light = new THREE.DirectionalLight(0xffebc7, 4);
  light.position.set(-4, 9, 4);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, {
    left: -5,
    right: 5,
    top: 5,
    bottom: -5,
  });
  light.shadow.bias = -0.0008;
  scene.add(light);
  const fill = new THREE.DirectionalLight(0xc6e5ff, 1.3);
  fill.position.set(4, 4, -4);
  scene.add(fill);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(7.35, 0.2, 7.35),
    new THREE.MeshStandardMaterial({ color: 0x293e3b, roughness: 0.6 }),
  );
  base.position.y = -0.16;
  scene.add(base);
  const tiles: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
  for (let q = 0; q < 49; q++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.985, 0.08, 0.985),
      new THREE.MeshStandardMaterial({
        color: ((q % 7) + Math.floor(q / 7)) % 2 ? 0x74998c : 0xc3c6ac,
        roughness: 0.72,
      }),
    );
    m.position.set((q % 7) - 3, -0.02, 3 - Math.floor(q / 7));
    m.receiveShadow = true;
    m.userData.square = q;
    tiles.push(m);
    scene.add(m);
  }
  const models = new THREE.Group();
  scene.add(models);
  const labels = document.createElement("div");
  labels.className = "overlay-labels";
  const keys = document.createElement("div");
  keys.className = "three-keys";
  const buttons = new Map<number, HTMLButtonElement>();
  for (let q = 0; q < 49; q++) {
    const b = document.createElement("button");
    b.dataset.square = String(q);
    b.tabIndex = q === 0 ? 0 : -1;
    b.onclick = () => onSquare(q);
    b.addEventListener("keydown", (e) => {
      const d = (
        { ArrowUp: 7, ArrowDown: -7, ArrowLeft: -1, ArrowRight: 1 } as Record<
          string,
          number
        >
      )[e.key];
      if (!d) return;
      const next = q + d;
      if (
        next < 0 ||
        next > 48 ||
        (Math.abs(d) === 1 && Math.floor(q / 7) !== Math.floor(next / 7))
      )
        return;
      e.preventDefault();
      b.tabIndex = -1;
      buttons.get(next)!.tabIndex = 0;
      buttons.get(next)!.focus();
    });
    buttons.set(q, b);
    keys.append(b);
  }
  host.append(renderer.domElement, labels, keys);
  let state: GameState | undefined,
    selection: Selection = { pieceId: null, candidate: null },
    preview: Preview | null = null,
    key = "",
    disposed = false;
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  function click(e: PointerEvent) {
    if (disposed) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(tiles)[0];
    if (hit) onSquare(hit.object.userData.square);
  }
  const lost = (e: Event) => {
    e.preventDefault();
    onFailure();
  };
  renderer.domElement.addEventListener("pointerup", click);
  renderer.domElement.addEventListener("webglcontextlost", lost);
  function project(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).project(camera);
  }
  function draw() {
    if (disposed) return;
    const size = Math.max(1, host.clientWidth);
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(
      document.body.classList.contains("no-motion")
        ? 1
        : Math.min(devicePixelRatio, 1.75),
    );
    renderer.shadowMap.enabled = !document.body.classList.contains("no-motion");
    camera.updateMatrixWorld();
    for (const [q, b] of buttons) {
      const v = project((q % 7) - 3, 0.05, 3 - Math.floor(q / 7));
      b.style.left = `${(v.x + 1) * 50}%`;
      b.style.top = `${(1 - v.y) * 50}%`;
    }
    labels.replaceChildren();
    if (state)
      for (const p of state.pieces) {
        const v = project(
            (p.square % 7) - 3 + 0.3,
            0.12,
            3 - Math.floor(p.square / 7) + 0.3,
          ),
          el = document.createElement("span");
        el.className = "projected-life";
        el.textContent = String(p.remaining);
        el.style.left = `${(v.x + 1) * 50}%`;
        el.style.top = `${(1 - v.y) * 50}%`;
        if (p.remaining === 1) el.style.background = "#88512e";
        labels.append(el);
      }
    renderer.render(scene, camera);
  }
  const ro = new ResizeObserver(() => {
    try {
      draw();
    } catch {
      onFailure();
    }
  });
  ro.observe(host);
  return {
    render(s, sel, pv) {
      state = s;
      selection = sel;
      preview = pv;
      const nextKey = JSON.stringify(
        s.pieces.map((p) => [p.id, p.kind, p.side, p.square]),
      );
      if (nextKey !== key) {
        disposeObject(models);
        models.clear();
        for (const p of s.pieces) {
          const g = createPieceModel(p.kind, p.side);
          g.position.set((p.square % 7) - 3, 0, 3 - Math.floor(p.square / 7));
          if (p.side === "black") g.rotation.y = Math.PI;
          models.add(g);
        }
        for (const side of ["white", "black"] as const) {
          const q = s.cores[side],
            g = createCoreModel(side);
          g.position.set((q % 7) - 3, 0, 3 - Math.floor(q / 7));
          models.add(g);
        }
        key = nextKey;
      }
      const targets = new Set(
        legalActions(s).flatMap((a) =>
          a.type === "move" && a.pieceId === sel.pieceId
            ? [a.to]
            : a.type === "swap" && a.pieceId === sel.pieceId
              ? [s.pieces.find((p) => p.id === a.allyId)!.square]
              : [],
        ),
      );
      for (let q = 0; q < 49; q++) {
        const piece = s.pieces.find((p) => p.square === q);
        const selected = piece?.id === sel.pieceId && !!piece;
        const expiry = piece && pv?.expires.includes(piece.id);
        tiles[q].material.color.setHex(
          pv?.targets.includes(q)
            ? 0xe8c878
            : selected
              ? 0xcbb77c
              : expiry
                ? 0xc79e76
                : pv?.paths[0]?.slice(0, -1).includes(q)
                  ? 0x96d7bd
                  : targets.has(q)
                    ? 0x4ab899
                    : ((q % 7) + Math.floor(q / 7)) % 2
                      ? 0x74998c
                      : 0xc3c6ac,
        );
        buttons
          .get(q)!
          .setAttribute(
            "aria-label",
            `${squareName(q)} ${piece ? `${piece.side === "white" ? "白" : "黒"} ${INFO[piece.kind].name} 残り${piece.remaining}` : q === 3 ? "白のコア" : q === 45 ? "黒のコア" : "空き"}`,
          );
      }
      draw();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerup", click);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      disposeObject(scene);
      renderer.dispose();
      host.replaceChildren();
    },
  };
}
