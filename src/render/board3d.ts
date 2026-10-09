import { createMotionPlayer } from "./motion-player";
import { trackPose, visibleCoreSides, type MotionPlan } from "./motion";
import * as THREE from "three";
import type { BoardView } from "./board-view";
import type { GameState, Selection, Preview } from "../game/types";
import { createPieceModel, createCoreModel, disposeObject } from "./pieces";
import {
  boardTargets,
  targetDescription,
  targetMarker,
  targetState,
} from "./board-targets";
import { INFO, squareName, PIECE_MARK, icon } from "../ui/piece-info";
export function createBoard3D(
  host: HTMLElement,
  onSquare: (q: number) => void,
  onFailure: () => void,
): BoardView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  let pixelRatio = Math.min(devicePixelRatio, 1.75),
    renderSize = 0;
  renderer.setPixelRatio(pixelRatio);
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
  camera.updateMatrixWorld();
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
  const pieceLabels = new Map<
    string,
    { life: HTMLElement; mark: HTMLElement }
  >();
  const keys = document.createElement("div");
  keys.className = "three-keys";
  const buttons = new Map<number, HTMLButtonElement>();
  for (let q = 0; q < 49; q++) {
    const b = document.createElement("button");
    b.dataset.square = String(q);
    b.tabIndex = q === 0 ? 0 : -1;
    b.onfocus = () => {
      for (const button of buttons.values()) button.tabIndex = -1;
      b.tabIndex = 0;
    };
    b.onclick = () => onSquare(q);
    b.addEventListener("keydown", (e) => {
      const d = (
        { ArrowUp: 7, ArrowDown: -7, ArrowLeft: -1, ArrowRight: 1 } as Record<
          string,
          number
        >
      )[e.key];
      if (!d) return;
      e.preventDefault();
      const next = q + d;
      if (
        next < 0 ||
        next > 48 ||
        (Math.abs(d) === 1 && Math.floor(q / 7) !== Math.floor(next / 7))
      )
        return;
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
    const lowQuality = document.body.classList.contains("low-quality");
    const nextRatio = lowQuality ? 1 : Math.min(devicePixelRatio, 1.75);
    if (nextRatio !== pixelRatio) {
      renderer.setPixelRatio(nextRatio);
      pixelRatio = nextRatio;
    }
    if (size !== renderSize) {
      renderer.setSize(size, size, false);
      renderSize = size;
    }
    renderer.shadowMap.enabled = !lowQuality;
    camera.updateMatrixWorld();
    for (const [q, b] of buttons) {
      const v = project((q % 7) - 3, 0.05, 3 - Math.floor(q / 7));
      b.style.left = `${(v.x + 1) * 50}%`;
      b.style.top = `${(1 - v.y) * 50}%`;
    }
    labels.replaceChildren();
    pieceLabels.clear();
    const displayed = new Map(state?.pieces.map((p) => [p.id, p]) ?? []);
    for (const track of activePlan?.tracks ?? [])
      if (!displayed.has(track.piece.id))
        displayed.set(track.piece.id, track.piece);
    if (state)
      for (const p of displayed.values()) {
        const v = project(
            (p.square % 7) - 3 + 0.3,
            0.12,
            3 - Math.floor(p.square / 7) + 0.3,
          ),
          el = document.createElement("span");
        el.className = "projected-life";
        el.dataset.lifeFor = p.id;
        el.textContent = String(p.remaining);
        el.style.left = `${(v.x + 1) * 50}%`;
        el.style.top = `${(1 - v.y) * 50}%`;
        if (p.remaining === 1) el.style.background = "#88512e";
        labels.append(el);
        const mark = document.createElement("span");
        mark.className = "projected-mark";
        mark.dataset.markFor = p.id;
        mark.textContent = PIECE_MARK[p.kind];
        mark.style.left = el.style.left;
        mark.style.top = el.style.top;
        labels.append(mark);
        pieceLabels.set(p.id, { life: el, mark });
      }
    if (selection.candidate?.type === "summon") {
      const a = selection.candidate,
        v = project((a.to % 7) - 3, 0.1, 3 - Math.floor(a.to / 7));
      const ghost = document.createElement("span");
      ghost.className = "projected-ghost ghost-piece";
      ghost.innerHTML = icon(a.kind);
      ghost.style.left = `${(v.x + 1) * 50}%`;
      ghost.style.top = `${(1 - v.y) * 50}%`;
      labels.append(ghost);
    }
  }
  const ro = new ResizeObserver(() => {
    if (disposed) return;
    try {
      draw();
      // Reapply the sampled pose after rebuilding labels, without an extra draw.
      paintFrame(activePlan, sampledElapsed, false);
    } catch {
      onFailure();
    }
  });
  ro.observe(host);
  const pieceModels = new Map<string, THREE.Group>();
  const coreModels = new Map<string, THREE.Group>();
  let activePlan: MotionPlan | null = null,
    sampledElapsed = 0,
    updating = false;
  function syncModels() {
    if (!state) return;
    const pieces = new Map(state.pieces.map((p) => [p.id, p]));
    for (const track of activePlan?.tracks ?? [])
      if (!pieces.has(track.piece.id)) pieces.set(track.piece.id, track.piece);
    for (const [id, model] of pieceModels)
      if (!pieces.has(id)) {
        disposeObject(model);
        models.remove(model);
        pieceModels.delete(id);
      }
    for (const [id, p] of pieces) {
      let model = pieceModels.get(id);
      const identity = `${p.kind}:${p.side}`;
      if (model && model.userData.identity !== identity) {
        disposeObject(model);
        models.remove(model);
        pieceModels.delete(id);
        model = undefined;
      }
      if (!model) {
        model = createPieceModel(p.kind, p.side);
        model.name = `piece:${id}`;
        model.userData.identity = identity;
        if (p.side === "black") model.rotation.y = Math.PI;
        pieceModels.set(id, model);
        models.add(model);
      }
      // Restore the authoritative baseline before applying the sampled tracks.
      model.position.set((p.square % 7) - 3, 0, 3 - Math.floor(p.square / 7));
      model.scale.setScalar(1);
      model.visible = true;
    }
    const visible = activePlan?.cues.some((c) => c.kind === "win")
      ? (["white", "black"] as const)
      : visibleCoreSides(state);
    for (const [side, model] of coreModels)
      if (!visible.some((s) => s === side)) {
        disposeObject(model);
        models.remove(model);
        coreModels.delete(side);
      }
    for (const side of visible)
      if (!coreModels.has(side)) {
        const model = createCoreModel(side),
          q = state.cores[side];
        model.name = `core:${side}`;
        model.position.set((q % 7) - 3, 0, 3 - Math.floor(q / 7));
        coreModels.set(side, model);
        models.add(model);
      }
  }
  function paintFrame(
    plan: MotionPlan | null,
    elapsed: number,
    refresh = plan !== activePlan || !plan,
  ) {
    if (disposed) return;
    activePlan = plan;
    sampledElapsed = elapsed;
    try {
      if (refresh) {
        syncModels();
        if (state) draw();
      }
      for (const track of plan?.tracks ?? []) {
        const model = pieceModels.get(track.piece.id);
        if (!model) continue;
        const pose = trackPose(track, elapsed);
        model.position.set(pose.x - 3, pose.lift, 3 - pose.y);
        model.scale.setScalar(
          pose.scale * (track.leave ? Math.max(0.01, pose.opacity) : 1),
        );
        model.visible = pose.opacity > 0.01;
        const v = project(pose.x - 3 + 0.3, 0.12 + pose.lift, 3 - pose.y + 0.3);
        const remaining =
          track.leave === "capture" ||
          elapsed < (track.leave === "expire" ? track.start : track.arrive)
            ? track.piece.remaining
            : track.remaining;
        const projected = pieceLabels.get(track.piece.id);
        if (projected) {
          for (const el of [projected.life, projected.mark]) {
            el.style.left = `${(v.x + 1) * 50}%`;
            el.style.top = `${(1 - v.y) * 50}%`;
            el.style.opacity = String(pose.opacity);
          }
          projected.life.textContent = String(remaining);
        }
      }
      const win = plan?.cues.find((c) => c.kind === "win");
      if (win && state?.outcome?.kind === "win") {
        const losingCore = coreModels.get(
          state.outcome.winner === "white" ? "black" : "white",
        );
        if (losingCore) losingCore.visible = elapsed < win.start;
      }
      renderer.render(scene, camera);
    } catch {
      onFailure();
    }
  }
  const motion = createMotionPlayer(
    host,
    (x, y) => {
      const p = project(x - 3, 0.15, 3 - y);
      return { x: (p.x + 1) * 50, y: (1 - p.y) * 50 };
    },
    (plan, elapsed) => {
      if (updating) {
        // update() can synchronously settle an old plan and start its successor.
        // Only the last sample is visible, so submit that scene once below.
        activePlan = plan;
        sampledElapsed = elapsed;
        return;
      }
      paintFrame(plan, elapsed);
    },
  );
  return {
    cancelMotion: motion.cancel,
    render(s, sel, pv, transition) {
      if (disposed) return;
      state = s;
      selection = sel;
      preview = pv;
      const { targets, kinds, inspectOnly } = boardTargets(s, sel);
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
                    ? inspectOnly
                      ? 0xcda478
                      : 0x4ab899
                    : ((q % 7) + Math.floor(q / 7)) % 2
                      ? 0x74998c
                      : 0xc3c6ac,
        );
        const button = buttons.get(q)!;
        targetState(
          button,
          kinds.get(q),
          inspectOnly,
          selected,
          !!pv?.targets.includes(q),
        );
        button.innerHTML = targetMarker(kinds.get(q), inspectOnly);
        buttons
          .get(q)!
          .setAttribute(
            "aria-label",
            `${squareName(q)} ${piece ? `${piece.side === "white" ? "白" : "黒"} ${INFO[piece.kind].name} 残り${piece.remaining}ターン` : q === 3 ? "白のコア" : q === 45 ? "黒のコア" : "空き"}${targetDescription(kinds.get(q), inspectOnly)}${pv?.targets.includes(q) ? " · 選んだ行き先（確定前）" : ""}`,
          );
      }
      updating = true;
      try {
        motion.update(s, transition);
      } finally {
        updating = false;
      }
      syncModels();
      draw();
      paintFrame(activePlan, sampledElapsed, false);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      motion.dispose();
      ro.disconnect();
      light.shadow.dispose();
      renderer.domElement.removeEventListener("pointerup", click);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      disposeObject(scene);
      renderer.dispose();
      host.replaceChildren();
      pieceLabels.clear();
    },
  };
}
