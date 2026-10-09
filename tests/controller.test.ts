import { it, expect } from "vitest";
import { createController } from "../src/app/controller";
it("duplicate_confirmation", async () => {
  const c = createController(() => {});
  const t = c.getToken();
  const [a, b] = await Promise.all([
    c.submit({ type: "pass" }, t),
    c.submit({ type: "pass" }, t),
  ]);
  expect([a, b]).toEqual([true, false]);
  expect(c.getState().ply).toBe(1);
  c.dispose();
});
it("stale_selection", async () => {
  const c = createController(() => {}),
    t = c.getToken();
  await c.submit({ type: "pass" }, t);
  expect(await c.submit({ type: "pass" }, t)).toBe(false);
  c.dispose();
});
it("cancel_free", () => {
  const c = createController(() => {}),
    s = c.getState();
  c.getToken();
  expect(c.getState()).toBe(s);
  c.dispose();
});
it("finished_locked", async () => {
  const c = createController(() => {});
  for (let i = 0; i < 6; i++) await c.submit({ type: "pass" }, c.getToken());
  expect(c.getState().outcome?.kind).toBe("draw");
  expect(await c.submit({ type: "pass" }, c.getToken())).toBe(false);
  c.dispose();
});
it("restart_invalidates_input", async () => {
  const c = createController(() => {}),
    t = c.getToken();
  c.restart("local");
  expect(await c.submit({ type: "pass" }, t)).toBe(false);
  expect(c.getState().ply).toBe(0);
  c.dispose();
});
it("disposed_controller_rejects", async () => {
  const c = createController(() => {});
  c.dispose();
  expect(await c.submit({ type: "pass" }, c.getToken())).toBe(false);
});
it("human_cannot_play_cpu_turn", async () => {
  const c = createController(() => {});
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  expect(await c.submit({ type: "pass" }, c.getToken())).toBe(false);
  c.dispose();
});
it("cpu_restart_stale", async () => {
  const c = createController(() => {});
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  c.restart("local");
  await new Promise((r) => setTimeout(r, 300));
  expect(c.getState().ply).toBe(0);
  expect(c.getMode()).toBe("local");
  c.dispose();
});
it("cpu_plays_black", async () => {
  const c = createController(() => {});
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  await new Promise((r) => setTimeout(r, 600));
  expect(c.getState().ply).toBe(2);
  expect(c.getState().turn).toBe("white");
  c.dispose();
});
it("CPU search runs in a worker and late results cannot change a restarted game", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  let worker: any;
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      worker = this;
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const c = createController(() => {});
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  await vi.advanceTimersByTimeAsync(400);
  expect(worker).toBeDefined();
  expect(worker.postMessage).toHaveBeenCalled();
  c.restart("local");
  expect(worker.terminate).toHaveBeenCalled();
  worker.onmessage?.({ data: { type: "pass" } });
  await Promise.resolve();
  expect(c.getState().ply).toBe(0);
  c.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("late old worker output cannot terminate the next match search", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  const workers: any[] = [];
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const c = createController(() => {});
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  await vi.advanceTimersByTimeAsync(350);
  const old = workers[0];
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  await vi.advanceTimersByTimeAsync(350);
  old.onmessage({ data: { type: "pass" } });
  expect(workers[1].terminate).not.toHaveBeenCalled();
  workers[1].onmessage({ data: { type: "pass" } });
  await Promise.resolve();
  expect(c.getState().ply).toBe(2);
  c.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("worker failure falls back to a legal CPU action instead of leaving the turn stuck", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  let worker: any;
  class FakeWorker {
    onmessage: any;
    onerror: any;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      worker = this;
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const c = createController(() => {});
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  await vi.advanceTimersByTimeAsync(350);
  worker.onerror();
  await Promise.resolve();
  await Promise.resolve();
  expect(c.getState().ply).toBe(2);
  expect(c.getBusy()).toBe(false);
  c.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("render callback exceptions cannot leave a committed local turn permanently busy", async () => {
  let throwOnce = true;
  const c = createController(() => {
    if (throwOnce) {
      throwOnce = false;
      throw Error("render failed");
    }
  });
  await expect(c.submit({ type: "pass" }, c.getToken())).rejects.toThrow(
    "render failed",
  );
  expect(c.getBusy()).toBe(false);
  expect(await c.submit({ type: "pass" }, c.getToken())).toBe(true);
  expect(c.getState().ply).toBe(2);
  c.dispose();
});
it("pausing CPU preserves a turn and rejects late worker replies until resumed", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  const workers: any[] = [];
  class W {
    onmessage: any;
    onerror: any;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal("Worker", W);
  const c = createController(() => {});
  c.restart("cpu");
  await c.submit({ type: "pass" }, c.getToken());
  await vi.advanceTimersByTimeAsync(350);
  const old = workers[0];
  const s = c.getState();
  c.pause();
  old.onmessage({ data: { type: "pass" } });
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(8000);
  expect(c.getState()).toBe(s);
  expect(await c.submit({ type: "pass" }, c.getToken())).toBe(false);
  c.resume();
  await vi.advanceTimersByTimeAsync(350);
  workers[1].onmessage({ data: { type: "pass" } });
  await Promise.resolve();
  expect(c.getState().ply).toBe(2);
  c.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
