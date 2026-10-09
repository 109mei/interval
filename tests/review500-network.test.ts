// @vitest-environment jsdom
// Exactly 60 independent local network/recovery scenarios. Every fetch is mocked.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  api,
  createOnline,
  NetworkError,
  type RoomView,
} from "../src/app/online";
import { applyAction, createGame } from "../src/game/engine";
import type { Action, GameState } from "../src/game/types";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
const cases: { id: string; persona: string; expected: string }[] = JSON.parse(
  readFileSync(
    new NodeURL("../docs/review500/network-cases.json", import.meta.url),
    "utf8",
  ),
);

const id = "a".repeat(32),
  nextId = "c".repeat(32),
  invite = "b".repeat(64);
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const room = (extra: Partial<RoomView> = {}): RoomView => ({
  id,
  seat: "white",
  version: 0,
  status: "waiting",
  expiresAt: Date.now() + 86400000,
  joined: false,
  ready: { white: false, black: false },
  state: createGame(),
  invite,
  ...extra,
});
const playing = (extra: Partial<RoomView> = {}) =>
  room({
    status: "playing",
    joined: true,
    ready: { white: true, black: true },
    ...extra,
  });
const moved = (state: GameState, action: Action = { type: "pass" }) => {
  const result = applyAction(state, action);
  if (!result.ok) throw Error(result.error);
  return result.state;
};
const deferred = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const el = (name: string) => document.getElementById(name)!;
const button = (name: string) => el(name) as HTMLButtonElement;
const click = (name: string) => button(name).click();
const scenario = (n: number, fn: () => unknown | Promise<unknown>) => {
  const row = cases[n - 1];
  it(`${row.id} ${row.persona}: ${row.expected}`, fn);
};
let clients: ReturnType<typeof createOnline>[];
let listeners: [string, EventListenerOrEventListenerObject][];
let visibility: ReturnType<typeof vi.spyOn>;
const client = (onChange: () => void = () => {}) => {
  const c = createOnline(onChange);
  clients.push(c);
  return c;
};
const mockRoom = (current: RoomView = room()) => {
  const fn = vi.fn(async (path: string) =>
    response(path === "/api/session" ? { ok: true } : current),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
};
async function boot(path = "/?2d") {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", path);
  await import("../src/main");
  await flush();
}
const statusSemantics = (node: HTMLElement) =>
  ["status", "alert"].includes(node.getAttribute("role") ?? "") ||
  ["polite", "assertive"].includes(node.getAttribute("aria-live") ?? "");
beforeEach(() => {
  vi.useFakeTimers();
  clients = [];
  listeners = [];
  document.body.className = "";
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("Unconfigured network attempt blocked");
    }),
  );
  vi.spyOn(Math, "random").mockReturnValue(0);
  visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type, listener, options) => {
      listeners.push([type, listener]);
      add(type, listener, options);
    },
  );
});
afterEach(() => {
  for (const c of clients) c.dispose();
  visibility.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  for (const [type, listener] of listeners)
    document.removeEventListener(type, listener);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.body.className = "";
  sessionStorage.clear();
  localStorage.clear();
});
scenario(1, async () => {
  const f = mockRoom();
  await api("/api/session");
  expect(f).toHaveBeenCalledWith(
    "/api/session",
    expect.objectContaining({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      body: undefined,
    }),
  );
});
scenario(2, async () => {
  const f = mockRoom();
  const body = { commandId: "receipt-2", version: 3, action: { type: "pass" } };
  await api("/api/rooms/mock/action", body);
  expect(f).toHaveBeenCalledWith(
    "/api/rooms/mock/action",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "X-Interval-Client": "1" },
    }),
  );
});
scenario(3, async () => {
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: string, init: RequestInit) => {
      signal = init.signal;
      throw new DOMException("timed out", "AbortError");
    }),
  );
  await expect(api("/api/session")).rejects.toMatchObject({
    code: "NETWORK",
    message: expect.stringContaining("もう一度"),
  });
  expect(signal).toBeDefined();
  expect(typeof signal?.addEventListener).toBe("function");
});
scenario(4, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>Sign in to Wi-Fi</html>")),
  );
  await expect(api("/api/session")).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
});
scenario(5, async () => {
  const invalid = { ...room(), ready: { white: "false", black: false } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(path === "/api/session" ? { ok: true } : invalid),
    ),
  );
  const c = client();
  await c.resume(id);
  expect(c.room).toBeNull();
  expect(c.connected).toBe(false);
  expect(c.error).toContain("再接続");
  expect(c.busy).toBe(false);
});
scenario(6, async () => {
  const invalid = { ...room(), seat: "spectator" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(path === "/api/session" ? { ok: true } : invalid),
    ),
  );
  const c = client();
  await c.resume(id);
  expect(c.room).toBeNull();
  expect(c.connected).toBe(false);
  expect(c.error).toContain("再接続");
  expect(c.busy).toBe(false);
});
scenario(7, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ error: "FUTURE_ERROR" }, 409)),
  );
  await expect(api("/api/session")).rejects.toMatchObject({
    code: "FUTURE_ERROR",
    message: "通信を確認して、もう一度お試しください。",
  });
});
scenario(8, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ error: "ROOM_EXPIRED" }, 410)),
  );
  await expect(api("/api/session")).rejects.toMatchObject({
    code: "ROOM_EXPIRED",
    message: expect.stringContaining("新しい招待"),
  });
});
scenario(9, async () => {
  const invalid = { ...room(), state: { ...createGame(), turn: "neither" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(path === "/api/session" ? { ok: true } : invalid),
    ),
  );
  const c = client();
  await c.resume(id);
  expect(c.room).toBeNull();
  expect(c.connected).toBe(false);
  expect(c.error).toContain("再接続");
  expect(c.busy).toBe(false);
});
scenario(10, async () => {
  const invalid = {
    ...room(),
    state: {
      ...createGame(),
      pieces: [
        {
          id: "broken",
          side: "white",
          kind: "carver",
          square: 999,
          remaining: 3,
          summonedPly: 0,
        },
      ],
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(path === "/api/session" ? { ok: true } : invalid),
    ),
  );
  const c = client();
  await c.resume(id);
  expect(c.room).toBeNull();
  expect(c.connected).toBe(false);
  expect(c.error).toContain("再接続");
  expect(c.busy).toBe(false);
});
scenario(11, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(path === "/api/session" ? { ok: true } : null),
    ),
  );
  const c = client();
  await c.resume(id);
  expect(c.room).toBeNull();
  expect(c.connected).toBe(false);
  expect(c.error).toContain("再接続");
  expect(c.busy).toBe(false);
});
scenario(12, async () => {
  let malformed = false;
  const original = playing({ version: 3 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(
        path === "/api/session"
          ? { ok: true }
          : malformed
            ? { ...original, state: undefined }
            : original,
      ),
    ),
  );
  const c = client();
  await c.resume(id);
  malformed = true;
  await c.retry();
  expect(c.room).toEqual(original);
  expect(c.connected).toBe(false);
  expect(c.error).toContain("再接続");
});
scenario(13, async () => {
  let wrong = false;
  const original = room({ version: 4 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      response(
        path === "/api/session"
          ? { ok: true }
          : wrong
            ? room({ id: nextId, version: 5 })
            : original,
      ),
    ),
  );
  const c = client();
  await c.resume(id);
  wrong = true;
  await c.retry();
  expect(c.room).toEqual(original);
  expect(c.connected).toBe(false);
  expect(c.error).toContain("再接続");
});
scenario(14, async () => {
  const original = playing({ version: 3 });
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith("/action")) {
        bodies.push(String(init.body));
        return response(playing({ version: -1 }));
      }
      return response(path === "/api/session" ? { ok: true } : original);
    }),
  );
  const c = client();
  await c.resume(id);
  await c.submit({ type: "pass" });
  expect(c.room).toEqual(original);
  expect(c.pending).toBe(true);
  expect(c.error).toContain("再接続");
  await c.retry();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(c.pending).toBe(true);
});
const ignoredReceipt = async (saved: string) => {
  sessionStorage.setItem(`interval-pending:${id}`, saved);
  const f = mockRoom();
  const c = client();
  await c.resume(id);
  expect(c.pending).toBe(false);
  await c.retry();
  expect(f.mock.calls.map(([p]) => p)).toEqual([
    "/api/session",
    `/api/rooms/${id}/state`,
    `/api/rooms/${id}/state`,
  ]);
};
scenario(15, () => ignoredReceipt("{broken"));
scenario(16, () =>
  ignoredReceipt(
    JSON.stringify({ op: "delete", body: { commandId: "x", version: 0 } }),
  ),
);
scenario(17, () =>
  ignoredReceipt(
    JSON.stringify({ op: "ready", body: { commandId: "x", version: 0.5 } }),
  ),
);
scenario(18, () =>
  ignoredReceipt(JSON.stringify({ op: "leave", body: { version: 0 } })),
);
scenario(19, async () => {
  let phase = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p === "/api/session") return response({ ok: true });
      if (phase === 1) throw Error("offline");
      return response(room({ version: phase === 0 ? 6 : 5 }));
    }),
  );
  const c = client();
  await c.resume(id);
  phase = 1;
  await c.retry();
  expect(c.connected).toBe(false);
  phase = 2;
  await c.retry();
  expect(c.room?.version).toBe(6);
  expect(c.connected).toBe(true);
  expect(c.error).toBe("");
});
const checkCadence = async (value: RoomView, ms: number) => {
  const f = mockRoom(value);
  const c = client();
  await c.resume(id);
  await vi.advanceTimersByTimeAsync(ms - 1);
  expect(f).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(f).toHaveBeenCalledTimes(3);
};
scenario(20, () => checkCadence(playing(), 2500));
scenario(21, () => checkCadence(room({ joined: true }), 1500));
scenario(22, () => checkCadence(playing({ seat: "black" }), 1200));
scenario(23, async () => {
  let offline = false;
  const f = vi.fn(async (p: string) => {
    if (offline) throw Error("offline");
    return response(p === "/api/session" ? { ok: true } : room());
  });
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  offline = true;
  await vi.advanceTimersByTimeAsync(1500);
  expect(f).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(3999);
  expect(f).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(f).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(7999);
  expect(f).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(f).toHaveBeenCalledTimes(5);
});
scenario(24, async () => {
  let offline = false;
  const f = vi.fn(async (p: string) => {
    if (offline) throw Error("offline");
    return response(p === "/api/session" ? { ok: true } : room());
  });
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  offline = true;
  await vi.advanceTimersByTimeAsync(1500);
  offline = false;
  await vi.advanceTimersByTimeAsync(4000);
  expect(c.connected).toBe(true);
  expect(f).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1499);
  expect(f).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(f).toHaveBeenCalledTimes(5);
});
scenario(25, async () => {
  const d = deferred<Response>();
  let slow = false;
  const f = vi.fn(async (p: string) =>
    slow ? d.promise : response(p === "/api/session" ? { ok: true } : room()),
  );
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  slow = true;
  const a = c.retry();
  await c.retry();
  expect(f).toHaveBeenCalledTimes(3);
  d.resolve(response(room({ version: 1 })));
  await a;
  expect(c.room?.version).toBe(1);
});
scenario(26, async () => {
  const f = mockRoom();
  const c = client();
  await c.resume(id);
  visibility.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(f).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(f).toHaveBeenCalledTimes(3);
});
scenario(27, async () => {
  const d = deferred<Response>();
  let slow = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? response({ ok: true })
        : p.includes(nextId)
          ? response(room({ id: nextId, version: 8 }))
          : slow
            ? d.promise
            : response(room()),
    ),
  );
  const c = client();
  await c.resume(id);
  slow = true;
  const old = c.retry();
  c.stop();
  await c.resume(nextId);
  d.reject(Error("old lost poll"));
  await old;
  expect(c.room?.id).toBe(nextId);
  expect(c.room?.version).toBe(8);
  expect(c.connected).toBe(true);
  expect(c.error).toBe("");
});
scenario(28, async () => {
  const d = deferred<Response>();
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session" ? response({ ok: true }) : d.promise,
    ),
  );
  const c = client(notify);
  const work = c.resume(id);
  await flush();
  c.dispose();
  const count = notify.mock.calls.length;
  d.resolve(response(room()));
  await work;
  expect(c.room).toBeNull();
  expect(notify).toHaveBeenCalledTimes(count);
});
scenario(29, async () => {
  const d = deferred<Response>();
  const f = vi.fn(async () => d.promise);
  vi.stubGlobal("fetch", f);
  const c = client();
  const work = c.create();
  const rejection = expect(work).rejects.toMatchObject({ code: "CANCELLED" });
  c.stop();
  d.resolve(response({ ok: true }));
  await rejection;
  expect(f).toHaveBeenCalledTimes(1);
  expect(c.room).toBeNull();
  expect(c.busy).toBe(false);
});
scenario(30, async () => {
  const d = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session" ? response({ ok: true }) : d.promise,
    ),
  );
  const c = client();
  const work = c.join(id, invite);
  const rejection = expect(work).rejects.toMatchObject({ code: "CANCELLED" });
  await flush();
  c.stop();
  d.resolve(response(room({ seat: "black", joined: true })));
  await rejection;
  expect(c.room).toBeNull();
  expect(c.error).toBe("");
});
scenario(31, async () => {
  const d = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? response({ ok: true })
        : p.includes(nextId)
          ? response(room({ id: nextId }))
          : d.promise,
    ),
  );
  const c = client();
  const old = c.resume(id);
  await flush();
  await c.resume(nextId);
  d.reject(Error("old resume failed"));
  await old;
  expect(c.room?.id).toBe(nextId);
  expect(c.connected).toBe(true);
  expect(c.error).toBe("");
  expect(c.busy).toBe(false);
});
scenario(32, async () => {
  let current = playing();
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/action")) {
        bodies.push(String(init.body));
        if (bodies.length === 1) {
          current = playing({ version: 1, state: moved(current.state) });
          throw Error("lost");
        }
      }
      return response(p === "/api/session" ? { ok: true } : current);
    }),
  );
  const c = client();
  await c.resume(id);
  await c.submit({ type: "pass" });
  expect(c.pending).toBe(true);
  expect(c.room?.version).toBe(1);
  await c.retry();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[1]).version).toBe(0);
  expect(c.pending).toBe(false);
});
scenario(33, async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/ready")) {
        bodies.push(String(init.body));
        if (bodies.length === 1)
          return response({ error: "SERVICE_UNAVAILABLE" }, 503);
        return response(
          room({ version: 1, ready: { white: true, black: false } }),
        );
      }
      return response(p === "/api/session" ? { ok: true } : room());
    }),
  );
  const c = client();
  await c.resume(id);
  await c.ready();
  expect(c.pending).toBe(true);
  await c.retry();
  expect(bodies[1]).toBe(bodies[0]);
  expect(c.pending).toBe(false);
  expect(c.room?.ready.white).toBe(true);
});
scenario(34, async () => {
  let lost = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p.endsWith("/leave")) lost = true;
      return lost
        ? response({ error: "NO_SEAT" }, 403)
        : response(p === "/api/session" ? { ok: true } : playing());
    }),
  );
  const c = client();
  await c.resume(id);
  expect(await c.leave()).toBe(false);
  expect(c.pending).toBe(false);
  expect(c.unavailable).toBe(true);
  expect(c.error).toContain("招待リンク");
  expect(sessionStorage.getItem(`interval-pending:${id}`)).toBeNull();
});
scenario(35, async () => {
  const d = deferred<Response>();
  const f = vi.fn(async (p: string) =>
    p.endsWith("/ready")
      ? d.promise
      : response(p === "/api/session" ? { ok: true } : room()),
  );
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  const first = c.ready();
  await c.ready();
  expect(f.mock.calls.filter(([p]) => p.endsWith("/ready"))).toHaveLength(1);
  d.resolve(
    response(room({ ready: { white: true, black: false }, version: 1 })),
  );
  await first;
  expect(c.busy).toBe(false);
});
scenario(36, async () => {
  let fail = true;
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/action")) {
        bodies.push(String(init.body));
        if (fail) throw Error("lost");
      }
      return response(p === "/api/session" ? { ok: true } : playing());
    }),
  );
  const first = client();
  await first.resume(id);
  await first.submit({ type: "pass" });
  first.dispose();
  const second = client();
  await second.resume(id);
  expect(second.pending).toBe(true);
  fail = false;
  await second.retry();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(second.pending).toBe(false);
});
scenario(37, async () => {
  const writes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (/\/(action|ready|leave)$/.test(p)) {
        writes.push(p);
        throw Error("lost");
      }
      return response(p === "/api/session" ? { ok: true } : playing());
    }),
  );
  const c = client();
  await c.resume(id);
  await c.submit({ type: "pass" });
  const saved = sessionStorage.getItem(`interval-pending:${id}`);
  await c.ready();
  await c.leave();
  await c.submit({ type: "pass" });
  expect(writes).toEqual([`/api/rooms/${id}/action`]);
  expect(sessionStorage.getItem(`interval-pending:${id}`)).toBe(saved);
});
scenario(38, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p.endsWith("/action")
        ? response({ error: "ILLEGAL_ACTION" }, 400)
        : response(
            p === "/api/session" ? { ok: true } : playing({ version: 4 }),
          ),
    ),
  );
  const c = client();
  await c.resume(id);
  await c.submit({ type: "pass" });
  expect(c.pending).toBe(false);
  expect(c.room?.state.ply).toBe(0);
  expect(c.room?.version).toBe(4);
  expect(c.error).toContain("選び直し");
  expect(c.busy).toBe(false);
});
scenario(39, async () => {
  const before: GameState = {
    ...createGame(),
    ply: 8,
    pieces: [
      {
        id: "winning-carver",
        side: "white",
        kind: "carver",
        square: 37,
        remaining: 1,
        summonedPly: 0,
      },
    ],
  };
  const terminal = moved(before, {
    type: "move",
    pieceId: "winning-carver",
    to: 45,
  });
  expect(terminal.outcome).toEqual({ kind: "win", winner: "white" });
  expect(terminal.pieces[0].square).toBe(terminal.cores.black);
  const f = mockRoom(
    playing({ status: "finished", version: 9, state: terminal }),
  );
  const c = client();
  await c.resume(id);
  expect(c.room?.state).toEqual(terminal);
  expect(c.connected).toBe(true);
  expect(c.error).toBe("");
  await vi.advanceTimersByTimeAsync(60000);
  expect(f).toHaveBeenCalledTimes(2);
});
scenario(40, async () => {
  const f = mockRoom(room({ status: "closed" }));
  const c = client();
  await c.resume(id);
  await vi.advanceTimersByTimeAsync(60000);
  expect(f).toHaveBeenCalledTimes(2);
  expect(c.room?.status).toBe("closed");
});
scenario(41, async () => {
  const f = mockRoom();
  await boot("/?2d&room=not-a-room");
  expect(el("home").hidden).toBe(false);
  expect(el("arena").hidden).toBe(true);
  expect(f).not.toHaveBeenCalled();
});
scenario(42, async () => {
  const f = mockRoom();
  await boot(`/?2d#room=${id}&invite=short`);
  expect(el("home").hidden).toBe(false);
  expect(el("friend-dialog").hasAttribute("open")).toBe(false);
  expect(f).not.toHaveBeenCalled();
});
scenario(43, async () => {
  const f = mockRoom();
  await boot(`/?2d#room=${id}&invite=${invite}`);
  expect(location.hash).toBe("");
  expect(location.search).toBe(`?room=${id}`);
  expect(location.href).not.toContain(invite);
  expect(history.state).toEqual({ room: id, invite });
  expect(el("friend-dialog").hasAttribute("open")).toBe(true);
  expect(f).not.toHaveBeenCalled();
});
scenario(44, async () => {
  const d = deferred<Response>();
  const f = vi.fn(async (p: string, _init: RequestInit) =>
    p === "/api/session" ? response({ ok: true }) : d.promise,
  );
  vi.stubGlobal("fetch", f);
  await boot(`/?2d#room=${id}&invite=${invite}`);
  click("join-room");
  click("join-room");
  await flush();
  const joins = f.mock.calls.filter(([p]) => p.endsWith("/join"));
  expect(joins).toHaveLength(1);
  expect(JSON.parse(String(joins[0][1].body))).toEqual({ invite });
  d.resolve(response(room({ seat: "black", joined: true })));
  await flush();
  expect(el("lobby").hidden).toBe(false);
  expect(history.state).toBeNull();
});
scenario(45, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? response({ ok: true })
        : response({ error: "BAD_INVITE" }, 403),
    ),
  );
  await boot(`/?2d#room=${id}&invite=${invite}`);
  click("join-room");
  await flush();
  expect(el("friend-error").hidden).toBe(false);
  expect(el("friend-error").textContent).toContain("招待リンク");
  expect(statusSemantics(el("friend-error"))).toBe(true);
  expect(button("join-room").disabled).toBe(false);
});
scenario(46, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? response({ ok: true })
        : response({ error: "ROOM_LIMIT" }, 429),
    ),
  );
  await boot();
  click("choose-friend");
  click("start-game");
  click("create-room");
  await flush();
  expect(el("friend-error").textContent).toContain("24時間に5つ");
  expect(el("friend-error").hidden).toBe(false);
  expect(statusSemantics(el("friend-error"))).toBe(true);
  expect(button("create-room").disabled).toBe(false);
});
scenario(47, async () => {
  const d = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session" ? response({ ok: true }) : d.promise,
    ),
  );
  await boot(`/?2d&room=${id}`);
  expect(el("turn").textContent).toBe("対局を復元中");
  expect(el("turn").getAttribute("aria-live")).toBe("polite");
  expect(button("pass").disabled).toBe(true);
  expect(button("summon").disabled).toBe(true);
  d.resolve(response(playing()));
  await flush();
  expect(button("pass").disabled).toBe(false);
});
scenario(48, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p === "/api/session") return response({ ok: true });
      throw Error("offline");
    }),
  );
  await boot(`/?2d&room=${id}`);
  expect(el("error").hidden).toBe(false);
  expect(el("error").getAttribute("role")).toBe("status");
  expect(el("error").textContent).toContain("通信");
  expect(el("retry").hidden).toBe(false);
  expect(button("retry").disabled).toBe(false);
  expect(el("turn").textContent).toBe("接続を確認");
});
scenario(49, async () => {
  let slow = false;
  const d = deferred<Response>();
  const f = vi.fn(async (p: string) => {
    if (p === "/api/session") return response({ ok: true });
    if (!slow) throw Error("offline");
    return d.promise;
  });
  vi.stubGlobal("fetch", f);
  await boot(`/?2d&room=${id}`);
  slow = true;
  click("retry");
  await flush();
  expect(button("retry").disabled).toBe(true);
  click("retry");
  await flush();
  expect(f.mock.calls.filter(([p]) => p.endsWith("/state"))).toHaveLength(2);
  d.resolve(response(playing()));
  await flush();
  expect(el("retry").hidden).toBe(true);
});
scenario(50, async () => {
  let offline = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (offline) throw Error("offline");
      return response(p === "/api/session" ? { ok: true } : playing());
    }),
  );
  await boot(`/?2d&room=${id}`);
  offline = true;
  await vi.advanceTimersByTimeAsync(2500);
  expect(button("pass").disabled).toBe(true);
  expect(button("summon").disabled).toBe(true);
  expect(el("network-banner").textContent).toContain("接続を確認");
  expect(el("network-banner").getAttribute("aria-live")).toBe("polite");
});
scenario(51, async () => {
  let offline = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (offline) throw Error("offline");
      return response(p === "/api/session" ? { ok: true } : playing());
    }),
  );
  await boot(`/?2d&room=${id}`);
  offline = true;
  await vi.advanceTimersByTimeAsync(2500);
  offline = false;
  click("retry");
  await flush();
  expect(button("pass").disabled).toBe(false);
  expect(button("summon").disabled).toBe(false);
  expect(el("network-banner").textContent).toBe("あなたの手番です");
  expect(el("error").hidden).toBe(true);
});
scenario(52, async () => {
  let offline = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (offline) throw Error("offline");
      return response(p === "/api/session" ? { ok: true } : playing());
    }),
  );
  await boot(`/?2d&room=${id}`);
  click("home-button");
  offline = true;
  await vi.advanceTimersByTimeAsync(2500);
  expect(el("home").hidden).toBe(false);
  expect(el("arena").hidden).toBe(true);
  expect(document.activeElement).toBe(el("resume-game"));
  expect(button("resume-game").disabled).toBe(false);
});
scenario(53, async () => {
  mockRoom(playing());
  await boot(`/?2d&room=${id}`);
  vi.mocked(window.confirm).mockReturnValue(false);
  click("home-button");
  expect(el("home").hidden).toBe(true);
  expect(el("arena").hidden).toBe(false);
  expect(location.search).toContain(id);
  expect(el("ply").textContent).toBe("0 / 200 手");
});
scenario(54, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? response({ ok: true })
        : response({ error: "NO_SEAT" }, 403),
    ),
  );
  await boot(`/?2d&room=${id}`);
  click("home-button");
  click("choose-local");
  click("start-game");
  expect(location.search).toBe("");
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(button("pass").disabled).toBe(false);
  expect(el("retry").hidden).toBe(true);
});
scenario(55, async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p === "/api/session") return response({ ok: true });
      throw Error("offline");
    }),
  );
  await boot(`/?2d&room=${id}`);
  click("menu");
  click("local");
  expect(location.search).toBe("");
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(button("summon").disabled).toBe(false);
  expect(el("drawer").hasAttribute("open")).toBe(false);
});
scenario(56, async () => {
  mockRoom(
    room({ seat: "black", joined: true, ready: { white: false, black: true } }),
  );
  await boot(`/?2d&room=${id}`);
  expect(button("ready").disabled).toBe(true);
  expect(button("ready").textContent).toContain("準備完了 ✓");
  expect(button("ready").getAttribute("aria-describedby")).toBe("ready-note");
  expect(el("ready-note").textContent).toContain("取り消せません");
  expect(el("guest-seat").textContent).toContain("あなた");
});
scenario(57, async () => {
  let offline = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (offline) throw Error("offline");
      return response(p === "/api/session" ? { ok: true } : room());
    }),
  );
  await boot(`/?2d&room=${id}`);
  offline = true;
  await vi.advanceTimersByTimeAsync(1500);
  expect(el("lobby").hidden).toBe(false);
  expect(button("ready").disabled).toBe(true);
  expect(el("error").getAttribute("role")).toBe("status");
  expect(el("error").hidden).toBe(false);
  expect(el("retry").hidden).toBe(false);
  expect(button("retry").disabled).toBe(false);
});
scenario(58, async () => {
  localStorage.setItem(
    "interval-display-preferences",
    JSON.stringify({ quality: false, motion: true }),
  );
  let current = playing({ seat: "black" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      response(p === "/api/session" ? { ok: true } : current),
    ),
  );
  await boot(`/?2d&room=${id}`);
  current = {
    ...current,
    version: 1,
    state: moved(current.state, {
      type: "summon",
      kind: "carver",
      duration: 3,
      to: 9,
    }),
  };
  await vi.advanceTimersByTimeAsync(1200);
  expect(document.body.classList.contains("no-motion")).toBe(true);
  expect(el("ply").textContent).toBe("1 / 200 手");
  expect(document.querySelector('[data-square="9"] .life')?.textContent).toBe(
    "3",
  );
  expect(
    document.querySelectorAll(".moving-piece,.motion-hidden"),
  ).toHaveLength(0);
  expect(el("log").getAttribute("aria-live")).toBe("polite");
});
scenario(59, async () => {
  let current = playing();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      response(p === "/api/session" ? { ok: true } : current),
    ),
  );
  await boot(`/?2d&room=${id}`);
  click("home-button");
  current = {
    ...current,
    version: 2,
    state: moved(
      moved(current.state, {
        type: "summon",
        kind: "bastion",
        duration: 3,
        to: 9,
      }),
      { type: "summon", kind: "bastion", duration: 3, to: 39 },
    ),
  };
  await vi.advanceTimersByTimeAsync(2500);
  click("resume-game");
  expect(el("ply").textContent).toBe("2 / 200 手");
  expect(document.querySelector('[data-square="9"] .piece')).not.toBeNull();
  expect(document.querySelector('[data-square="39"] .piece')).not.toBeNull();
  expect(
    document.querySelectorAll(".moving-piece,.motion-hidden"),
  ).toHaveLength(0);
});
scenario(60, async () => {
  let expired = false;
  const f = vi.fn(async (p: string) =>
    p === "/api/session"
      ? response({ ok: true })
      : expired
        ? response({ error: "ROOM_EXPIRED" }, 410)
        : response(playing()),
  );
  vi.stubGlobal("fetch", f);
  await boot(`/?2d&room=${id}`);
  click("home-button");
  expired = true;
  await vi.advanceTimersByTimeAsync(2500);
  click("choose-local");
  expect(button("start-game").disabled).toBe(false);
  click("start-game");
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(location.search).toBe("");
  expect(f.mock.calls.some(([p]) => p.endsWith("/leave"))).toBe(false);
});
