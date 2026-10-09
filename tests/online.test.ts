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
it("an unresolved command cannot be overwritten by ready or leave", async () => {
  vi.useFakeTimers();
  const writes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (/\/(action|ready|leave)$/.test(path)) {
        writes.push(path);
        throw new Error("response lost");
      }
      return response(
        path === "/api/session"
          ? { ok: true }
          : { ...room(), status: "playing" },
      );
    }),
  );
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  await c.submit({ type: "pass" });
  await c.leave();
  await c.ready();
  expect(writes).toHaveLength(1);
  expect(c.pending).toBe(true);
  c.dispose();
});
it("uncertain command survives a page reload and retries its original receipt", async () => {
  vi.useFakeTimers();
  let fail = true;
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith("/action")) {
        bodies.push(String(init.body));
        if (fail) throw new Error("response lost");
        return response({ ...room(1), status: "playing" });
      }
      return response(
        path === "/api/session"
          ? { ok: true }
          : { ...room(), status: "playing" },
      );
    }),
  );
  const first = createOnline(() => {});
  await first.resume("a".repeat(32));
  await first.submit({ type: "pass" });
  first.dispose();
  const reloaded = createOnline(() => {});
  await reloaded.resume("a".repeat(32));
  expect(reloaded.pending).toBe(true);
  fail = false;
  await reloaded.retry();
  expect(bodies[1]).toBe(bodies[0]);
  expect(reloaded.pending).toBe(false);
  reloaded.dispose();
});
it("leaving during room creation prevents a late response from reopening it", async () => {
  vi.useFakeTimers();
  let resolveCreate!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/api/session"
        ? response({ ok: true })
        : new Promise<Response>((r) => {
            resolveCreate = r;
          }),
    ),
  );
  const c = createOnline(() => {});
  const creating = c.create();
  await vi.advanceTimersByTimeAsync(1);
  c.stop();
  resolveCreate(response(room()));
  await expect(creating).rejects.toThrow();
  expect(c.room).toBeNull();
  expect(c.busy).toBe(false);
  c.dispose();
});
it("a successful refresh notifies the UI after clearing a connection error", async () => {
  vi.useFakeTimers();
  let fail = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (fail) throw new Error("offline");
      return response(path === "/api/session" ? { ok: true } : room());
    }),
  );
  const displayed: string[] = [];
  const c = createOnline(() => displayed.push(c.error));
  await c.resume("a".repeat(32));
  fail = true;
  await c.retry();
  expect(c.connected).toBe(false);
  fail = false;
  await c.retry();
  expect(displayed.at(-1)).toBe("");
  expect(c.connected).toBe(true);
  c.dispose();
});
it("a reloaded pending command can recover even when its first state fetch is offline", async () => {
  vi.useFakeTimers();
  const id = "a".repeat(32);
  sessionStorage.setItem(
    `interval-pending:${id}`,
    JSON.stringify({
      op: "action",
      body: {
        commandId: "saved-command",
        version: 0,
        action: { type: "pass" },
      },
    }),
  );
  let offline = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (offline) throw Error("offline");
      return response(
        path === "/api/session"
          ? { ok: true }
          : { ...room(path.endsWith("/action") ? 1 : 0), status: "playing" },
      );
    }),
  );
  const c = createOnline(() => {});
  await c.resume(id);
  expect(c.room).toBeNull();
  expect(c.pending).toBe(true);
  offline = false;
  await c.retry();
  expect(c.room?.id).toBe(id);
  await c.retry();
  expect(c.pending).toBe(false);
  c.dispose();
});
it.each(["create", "join"] as const)(
  "stopping %s during session preparation never sends the room mutation",
  async (operation) => {
    let finishSession!: (r: Response) => void;
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/api/session")
          return new Promise<Response>((resolve) => {
            finishSession = resolve;
          });
        writes++;
        return response(room());
      }),
    );
    const c = createOnline(() => {});
    const pending =
      operation === "create"
        ? c.create()
        : c.join("a".repeat(32), "b".repeat(64));
    const failed = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    c.stop();
    finishSession(response({ ok: true }));
    await failed;
    expect(writes).toBe(0);
    expect(c.room).toBeNull();
    expect(c.busy).toBe(false);
    c.dispose();
  },
);
it("an expired creation receipt can be replaced after its definitive rejection", async () => {
  const expiredId = "expired-create-key";
  sessionStorage.setItem("interval-create", expiredId);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/api/session") return response({ ok: true });
      return JSON.parse(String(init.body)).commandId === expiredId
        ? response({ error: "ROOM_EXPIRED" }, 410)
        : response(room());
    }),
  );
  const c = createOnline(() => {});
  await expect(c.create()).rejects.toMatchObject({ code: "ROOM_EXPIRED" });
  await expect(c.create()).resolves.toMatchObject({ id: "a".repeat(32) });
  expect(c.room?.id).toBe("a".repeat(32));
  c.dispose();
});
it.each(["getItem", "setItem", "removeItem"] as const)(
  "room creation recovers uncertain results when storage %s is blocked",
  async (method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    let originalKey: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init: RequestInit) => {
        if (path === "/api/session") return response({ ok: true });
        const key = JSON.parse(String(init.body)).commandId;
        if (!originalKey) {
          originalKey = key;
          throw new Error("lost response");
        }
        return key === originalKey
          ? response(room())
          : response({ error: "BAD_REQUEST" }, 400);
      }),
    );
    const c = createOnline(() => {});
    await expect(c.create()).rejects.toThrow();
    await expect(c.create()).resolves.toMatchObject({ id: "a".repeat(32) });
    expect(c.room?.id).toBe("a".repeat(32));
    expect(c.error).toBe("");
    c.dispose();
  },
);
it.each(["create", "join"] as const)(
  "entering another room via %s never replays the previous room's unresolved receipt",
  async (operation) => {
    const old = "a".repeat(32),
      next = "c".repeat(32);
    sessionStorage.setItem(
      `interval-pending:${old}`,
      JSON.stringify({
        op: "leave",
        body: { commandId: "old-leave", version: 0 },
      }),
    );
    const newRoom = { ...room(), id: next };
    let wrongWrites = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/api/session") return response({ ok: true });
        if (path === `/api/rooms/${old}/state`) throw new Error("offline");
        if (path.endsWith("/leave")) {
          wrongWrites++;
          return response({ ...newRoom, status: "closed", version: 1 });
        }
        return response(newRoom);
      }),
    );
    const c = createOnline(() => {});
    await c.resume(old);
    expect(c.pending).toBe(true);
    if (operation === "create") await c.create();
    else await c.join(next, "b".repeat(64));
    await c.retry();
    expect(wrongWrites).toBe(0);
    expect(c.pending).toBe(false);
    expect(c.room?.id).toBe(next);
    expect(c.room?.status).toBe("waiting");
    expect(sessionStorage.getItem(`interval-pending:${old}`)).not.toBeNull();
    c.dispose();
  },
);
it("a second creation uses a new receipt even if removing the first stored receipt is blocked", async () => {
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const rooms = new Map<string, ReturnType<typeof room>>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/api/session") return response({ ok: true });
      const key = JSON.parse(String(init.body)).commandId;
      if (!rooms.has(key))
        rooms.set(key, {
          ...room(),
          id: (rooms.size === 0 ? "a" : "c").repeat(32),
        });
      return response(rooms.get(key));
    }),
  );
  const c = createOnline(() => {});
  const first = await c.create();
  c.stop();
  const second = await c.create();
  expect(second.id).not.toBe(first.id);
  c.dispose();
});
it.each(["response", "error"] as const)(
  "a late old-room poll %s cannot replace the current room or connection state",
  async (completion) => {
    const old = "a".repeat(32),
      next = "c".repeat(32);
    let pollCount = 0;
    let resolvePoll!: (r: Response) => void;
    let rejectPoll!: (e: Error) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/api/session") return response({ ok: true });
        if (path === `/api/rooms/${old}/state` && ++pollCount > 1)
          return new Promise<Response>((resolve, reject) => {
            resolvePoll = resolve;
            rejectPoll = reject;
          });
        return response(
          path.includes(next) ? { ...room(3), id: next } : room(),
        );
      }),
    );
    const c = createOnline(() => {});
    await c.resume(old);
    const poll = c.retry();
    c.stop();
    await c.resume(next);
    if (completion === "response")
      resolvePoll(response({ ...room(10), status: "closed" }));
    else rejectPoll(new Error("old network failure"));
    await poll;
    expect(c.room?.id).toBe(next);
    expect(c.room?.version).toBe(3);
    expect(c.room?.status).toBe("waiting");
    expect(c.connected).toBe(true);
    expect(c.error).toBe("");
    c.dispose();
  },
);
it("Sora receives readiness-specific recovery after simultaneous ready", async () => {
  let attempts = 0;
  const waiting = {
    ...room(1),
    joined: true,
    ready: { white: false, black: true },
  };
  const fetch = vi.fn(async (p: string) => {
    if (p.endsWith("/ready"))
      return ++attempts === 1
        ? response({ error: "STALE_VERSION" }, 409)
        : response({
            ...waiting,
            version: 2,
            status: "playing",
            ready: { white: true, black: true },
          });
    return response(p === "/api/session" ? { ok: true } : waiting);
  });
  vi.stubGlobal("fetch", fetch);
  const c = createOnline(() => {});
  await c.resume("a".repeat(32));
  await c.ready();
  expect(c.error).toContain("準備状況");
  expect(c.error).toContain("もう一度");
  expect(c.pending).toBe(false);
  expect(c.connected).toBe(true);
  await c.ready();
  expect(c.room?.status).toBe("playing");
  expect(attempts).toBe(2);
  c.dispose();
});
it.each(["create", "join", "resume"] as const)(
  "a failed first %s render notification releases busy for retry",
  async (op) => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (p: string) =>
        response(p === "/api/session" ? { ok: true } : room()),
      ),
    );
    const c = createOnline(() => {
      if (fail) {
        fail = false;
        throw Error("render failed");
      }
    });
    const call = () =>
      op === "create"
        ? c.create()
        : op === "join"
          ? c.join("a".repeat(32), "b".repeat(64))
          : c.resume("a".repeat(32));
    await call().catch(() => {});
    expect(c.busy).toBe(false);
    await call();
    expect(c.room?.id).toBe("a".repeat(32));
    c.dispose();
  },
);
