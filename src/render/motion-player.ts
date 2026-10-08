import type { GameState } from "../game/types";
import { motionPlan, type BoardTransition, type MotionPlan } from "./motion";
export function createMotionPlayer(
  host: HTMLElement,
  point: (x: number, y: number) => { x: number; y: number },
  frame: (plan: MotionPlan | null, elapsed: number) => void,
) {
  const layer = document.createElement("div");
  layer.className = "board-effects";
  layer.setAttribute("aria-hidden", "true");
  host.append(layer);
  const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let raf: number | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    plan: MotionPlan | null = null,
    dead = false,
    key = "",
    lastElapsed = 0,
    animating = false;
  const reduced = () =>
    !!preference?.matches || document.body.classList.contains("no-motion");
  function cancel() {
    if (raf !== undefined) cancelAnimationFrame(raf);
    if (timer !== undefined) clearTimeout(timer);
    raf = undefined;
    timer = undefined;
    plan = null;
    animating = false;
    layer.replaceChildren();
    frame(null, 0);
  }
  function stopMotion() {
    if (plan) cancel();
  }
  const observer = new MutationObserver(() => {
    if (reduced()) stopMotion();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  preference?.addEventListener?.("change", stopMotion);
  const visibility = () => {
    if (document.hidden) stopMotion();
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    layer,
    update(state: GameState, transition?: BoardTransition | null) {
      if (dead) return;
      const nextKey = JSON.stringify(state);
      if (nextKey === key) {
        if (plan && animating) frame(plan, lastElapsed);
        return;
      }
      key = nextKey;
      cancel();
      if (!transition || document.hidden) return;
      lastElapsed = 0;
      plan = motionPlan(state, transition);
      const current = plan;
      const simple = reduced() || typeof requestAnimationFrame !== "function";
      animating = !simple;
      layer.classList.toggle("reduced", simple);
      for (const cue of current.cues) {
        const el = document.createElement("span");
        el.className = `action-cue cue-${cue.kind}`;
        el.dataset.effect = cue.kind;
        el.dataset.at = String(cue.square);
        el.textContent = cue.label;
        const p = point(cue.square % 7, Math.floor(cue.square / 7));
        el.style.left = `${p.x}%`;
        el.style.top = `${p.y}%`;
        el.style.setProperty("--cue-delay", `${simple ? 0 : cue.start}ms`);
        layer.append(el);
      }
      if (!simple) {
        const start = performance.now();
        const tick = (now: number) => {
          if (dead || current !== plan) return;
          if (reduced() || document.hidden) {
            cancel();
            return;
          }
          const elapsed = now - start;
          lastElapsed = elapsed;
          if (elapsed >= current.duration) {
            cancel();
            return;
          }
          frame(current, elapsed);
          if (!dead && current === plan) raf = requestAnimationFrame(tick);
        };
        frame(current, 0);
        if (!dead && current === plan) raf = requestAnimationFrame(tick);
      }
      if (!dead && current === plan)
        timer = setTimeout(cancel, current.duration + 50);
    },
    cancel,
    dispose() {
      if (dead) return;
      dead = true;
      cancel();
      observer.disconnect();
      preference?.removeEventListener?.("change", stopMotion);
      document.removeEventListener("visibilitychange", visibility);
      layer.remove();
    },
  };
}
