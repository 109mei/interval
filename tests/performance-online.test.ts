// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createOnline, type RoomView } from "../src/app/online";
import { createGame } from "../src/game/engine";

const id = "a".repeat(32);
const room = (): RoomView => ({
  id,
  seat: "white",
  version: 3,
  status: "waiting",
  expiresAt: 1900000000000,
  joined: false,
  ready: { white: false, black: false },
  state: createGame(),
  invite: "b".repeat(64),
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const clients: ReturnType<typeof createOnline>[] = [];
function client(notify: () => void) {
  const c = createOnline(notify);
  clients.push(c);
  return c;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  sessionStorage.clear();
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.dispose());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it("ten unchanged polls preserve requests and cadence without rerender notifications", async () => {
  const notify = vi.fn();
  const fetch = vi.fn(async (path: string) =>
    response(path === "/api/session" ? { ok: true } : room()),
  );
  vi.stubGlobal("fetch", fetch);
  const c = client(notify);
  await c.resume(id);
  const initialNotifications = notify.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1499);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(13501);
  expect(fetch).toHaveBeenCalledTimes(12);
  expect(notify).toHaveBeenCalledTimes(initialNotifications);
  expect(c.room).toEqual(room());
});

it.each([
  ["seat", (r: RoomView) => ({ ...r, seat: "black" as const })],
  ["status", (r: RoomView) => ({ ...r, status: "playing" as const })],
  ["expiry", (r: RoomView) => ({ ...r, expiresAt: r.expiresAt + 1 })],
  ["joined", (r: RoomView) => ({ ...r, joined: true })],
  ["ready", (r: RoomView) => ({ ...r, ready: { white: true, black: false } })],
  ["invite", (r: RoomView) => ({ ...r, invite: "c".repeat(64) })],
  [
    "state",
    (r: RoomView) => ({
      ...r,
      state: { ...r.state, grain: { ...r.state.grain, white: 17 } },
    }),
  ],
] as const)(
  "equal-version %s changes still notify the UI",
  async (_, change) => {
    let current = room();
    const notify = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        response(path === "/api/session" ? { ok: true } : current),
      ),
    );
    const c = client(notify);
    await c.resume(id);
    const before = notify.mock.calls.length;
    current = change(current);
    await c.retry();
    expect(c.room).toEqual(current);
    expect(notify).toHaveBeenCalledTimes(before + 1);
    await c.retry();
    expect(notify).toHaveBeenCalledTimes(before + 1);
  },
);

it("connection failure and recovery notify even with an unchanged room", async () => {
  let failed = false;
  const seen: { connected: boolean; error: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (failed) throw Error("offline");
      return response(path === "/api/session" ? { ok: true } : room());
    }),
  );
  const c = client(() => seen.push({ connected: c.connected, error: c.error }));
  await c.resume(id);
  const before = seen.length;
  failed = true;
  await c.retry();
  expect(seen).toHaveLength(before + 1);
  expect(seen.at(-1)).toMatchObject({ connected: false });
  expect(seen.at(-1)?.error).not.toBe("");
  await c.retry();
  expect(seen).toHaveLength(before + 1);
  failed = false;
  await c.retry();
  expect(seen).toHaveLength(before + 2);
  expect(seen.at(-1)).toEqual({ connected: true, error: "" });
});

it("busy and pending receipt transitions remain visible without room changes", async () => {
  let failed = true;
  const seen: { busy: boolean; pending: boolean; error: string }[] = [];
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith("/ready")) {
        bodies.push(init.body as string);
        if (failed) throw Error("offline");
      }
      return response(path === "/api/session" ? { ok: true } : room());
    }),
  );
  const c = client(() =>
    seen.push({ busy: c.busy, pending: c.pending, error: c.error }),
  );
  await c.resume(id);
  seen.length = 0;
  await c.ready();
  expect(seen[0]).toEqual({ busy: true, pending: true, error: "" });
  expect(seen.at(-1)).toMatchObject({ busy: false, pending: true });
  expect(seen.at(-1)?.error).not.toBe("");
  failed = false;
  seen.length = 0;
  await c.retry();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(seen).toEqual([
    { busy: true, pending: true, error: "" },
    { busy: true, pending: false, error: "" },
    { busy: false, pending: false, error: "" },
  ]);
});

it("unavailable and stop transitions notify while identical stopped state does not", async () => {
  let missing = false;
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      missing
        ? response({ error: "ROOM_EXPIRED" }, 404)
        : response(path === "/api/session" ? { ok: true } : room()),
    ),
  );
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  missing = true;
  await c.retry();
  expect(c.unavailable).toBe(true);
  expect(notify).toHaveBeenCalledTimes(before + 1);
  c.stop();
  expect(c.unavailable).toBe(false);
  expect(c.room).toBeNull();
  expect(notify).toHaveBeenCalledTimes(before + 2);
  c.stop();
  expect(notify).toHaveBeenCalledTimes(before + 2);
});

it("ignored older snapshots do not notify but newer versions do", async () => {
  let current = room();
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(path === "/api/session" ? { ok: true } : current),
    ),
  );
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  current = { ...current, version: 2, joined: true };
  await c.retry();
  expect(c.room?.version).toBe(3);
  expect(c.room?.joined).toBe(false);
  expect(notify).toHaveBeenCalledTimes(before);
  current = { ...current, version: 4 };
  await c.retry();
  expect(c.room?.version).toBe(4);
  expect(notify).toHaveBeenCalledTimes(before + 1);
});

it("a failed callback can retry the same exposed snapshot", async () => {
  let fail = false;
  const notify = vi.fn(() => {
    if (fail) {
      fail = false;
      throw Error("render failed");
    }
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(path === "/api/session" ? { ok: true } : room()),
    ),
  );
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  fail = true;
  expect(() => c.stop()).toThrow("render failed");
  c.stop();
  expect(notify).toHaveBeenCalledTimes(before + 2);
  expect(c.room).toBeNull();
});
