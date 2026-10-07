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
