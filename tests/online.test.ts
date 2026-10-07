// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { createOnline } from "../src/app/online";
import { createGame } from "../src/game/engine";
const room = (v = 0) => ({
  id: "a".repeat(32),
  seat: "white",
  version: v,
  status: "waiting",
  expiresAt: Date.now() + 86400000,
  joined: false,
  ready: { white: false, black: false },
  state: createGame(),
  invite: "b".repeat(64),
});
const response = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("poll state never rolls back to an older version", async () => {
  vi.useFakeTimers();
  let polls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      response(
        p === "/api/session" ? { ok: true } : room(++polls === 1 ? 5 : 4),
      ),
    ),
  );
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  expect(c.room?.version).toBe(5);
  await vi.advanceTimersByTimeAsync(2000);
  expect(c.room?.version).toBe(5);
  c.dispose();
});
it("hidden tab stops polling; visibility restoration refreshes", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async (p: string) =>
    response(p === "/api/session" ? { ok: true } : room()),
  );
  vi.stubGlobal("fetch", fetch);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  hidden.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  const count = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(12000);
  expect(fetch.mock.calls.length).toBe(count);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch.mock.calls.length).toBeGreaterThan(count);
  c.dispose();
});
it("uncertain command retries exact command id and version", async () => {
  vi.useFakeTimers();
  let fail = true;
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/ready")) {
        bodies.push(init.body as string);
        if (fail) {
          fail = false;
          throw new Error("offline");
        }
        return response(room(1));
      }
      return response(p === "/api/session" ? { ok: true } : room());
    }),
  );
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  await c.ready();
  expect(c.pending).toBe(true);
  await c.retry();
  expect(bodies[0]).toBe(bodies[1]);
  expect(c.pending).toBe(false);
  expect(c.room?.version).toBe(1);
  c.dispose();
});
it("uncertain creation retries same idempotency key", async () => {
  vi.useFakeTimers();
  let fail = true;
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p === "/api/rooms") {
        bodies.push(init.body as string);
        if (fail) {
          fail = false;
          throw new Error("offline");
        }
        return response(room());
      }
      return response({ ok: true });
    }),
  );
  const c = createOnline(() => {});
  await expect(c.create()).rejects.toThrow();
  await c.create();
  expect(bodies[0]).toBe(bodies[1]);
  c.dispose();
});
it("failed leave preserves its error and does not report success", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p.endsWith("/leave")
        ? response({ error: "STALE_VERSION" }, 409)
        : response(
            p === "/api/session"
              ? { ok: true }
              : { ...room(2), status: "playing" },
          ),
    ),
  );
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  expect(await c.leave()).toBe(false);
  expect(c.error).toContain("盤面が更新");
  expect(c.room?.status).toBe("playing");
  c.dispose();
});
it("failed initial resume can retry once network returns", async () => {
  vi.useFakeTimers();
  let fails = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p === "/api/session") return response({ ok: true });
      if (fails) throw new Error("offline");
      return response(room(4));
    }),
  );
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  expect(c.room).toBeNull();
  fails = false;
  await c.retry();
  expect(c.room?.version).toBe(4);
  c.dispose();
});
it("late old-room action response cannot overwrite a new room", async () => {
  vi.useFakeTimers();
  let resolveAction!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p.endsWith("/action"))
        return new Promise<Response>((r) => (resolveAction = r));
      return response(
        p === "/api/session"
          ? { ok: true }
          : p.includes("cccc")
            ? { ...room(0), id: "c".repeat(32) }
            : { ...room(1), status: "playing" },
      );
    }),
  );
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  const action = c.submit({ type: "pass" });
  c.stop();
  await c.resume("c".repeat(32));
  resolveAction(response({ ...room(2), status: "finished" }));
  await action;
  expect(c.room?.id).toBe("c".repeat(32));
  expect(c.busy).toBe(false);
  c.dispose();
});
it("finished rooms stop polling and expired rooms become explicitly unavailable", async () => {
  vi.useFakeTimers();
  let finish = true;
  const fetch = vi.fn(async (p: string) =>
    response(
      p === "/api/session"
        ? { ok: true }
        : finish
          ? { ...room(9), status: "finished" }
          : { error: "ROOM_EXPIRED" },
      p === "/api/session" || finish ? 200 : 410,
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  const count = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch.mock.calls.length).toBe(count);
  c.stop();
  finish = false;
  await c.resume("a".repeat(32));
  expect(c.unavailable).toBe(true);
  c.dispose();
});
