// @vitest-environment jsdom
// Exactly 40 additional deterministic network/recovery journeys. Fetch never leaves this process.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { createOnline, type RoomView } from "../src/app/online";
import { createGame } from "../src/game/engine";

const cases: { id: string; persona: string; expected: string }[] = JSON.parse(
  readFileSync(
    new NodeURL("../docs/review200/network-cases.json", import.meta.url),
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
  version: 7,
  status: "waiting",
  expiresAt: 1900000000000,
  joined: true,
  ready: { white: false, black: false },
  state: createGame(),
  invite,
  ...extra,
});
const playing = (extra: Partial<RoomView> = {}) =>
  room({ status: "playing", ready: { white: true, black: true }, ...extra });
const occupied = () =>
  playing({
    state: {
      ...createGame(),
      pieces: [
        {
          id: "white-leaper",
          side: "white",
          kind: "leaper",
          square: 10,
          remaining: 4,
          summonedPly: 0,
        },
        {
          id: "black-link",
          side: "black",
          kind: "link",
          square: 38,
          remaining: 3,
          summonedPly: 1,
        },
      ],
    },
  });
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const scenario = (n: number, run: () => unknown | Promise<unknown>) => {
  const row = cases[n - 1];
  it(`${row.id} ${row.persona}: ${row.expected}`, run);
};
let clients: ReturnType<typeof createOnline>[];
let visibility: ReturnType<typeof vi.spyOn>;
let listeners: [string, EventListenerOrEventListenerObject][];
const client = (notify: () => void = () => {}) => {
  const c = createOnline(notify);
  clients.push(c);
  return c;
};
const fixture = (initial = room()) => {
  const feed = { current: initial };
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) =>
    response(path === "/api/session" ? { ok: true } : feed.current),
  );
  vi.stubGlobal("fetch", fetcher);
  return { feed, fetcher };
};
const stateCalls = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(([p]) => String(p).endsWith("/state"));
const writes = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(([p]) => /\/(ready|leave|action)$/.test(String(p)));
const snapshot = (c: ReturnType<typeof createOnline>) => ({
  room: c.room,
  busy: c.busy,
  pending: c.pending,
  connected: c.connected,
  error: c.error,
  unavailable: c.unavailable,
});
beforeEach(() => {
  clients = [];
  listeners = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
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
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("Unconfigured real network attempt blocked");
    }),
  );
});
afterEach(() => {
  clients.forEach((c) => c.dispose());
  visibility.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  listeners.forEach(([type, listener]) =>
    document.removeEventListener(type, listener),
  );
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = "";
  document.body.className = "";
});

scenario(1, async () => {
  const { feed } = fixture(occupied());
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  feed.current = {
    ...feed.current,
    state: {
      ...feed.current.state,
      pieces: feed.current.state.pieces.map((p) => ({
        ...p,
        square: p.square === 10 ? 38 : 10,
      })),
    },
  };
  await c.retry();
  await c.retry();
  expect(c.room?.state.pieces.map((p) => p.square)).toEqual([38, 10]);
  expect(notify).toHaveBeenCalledTimes(before + 1);
});
scenario(2, async () => {
  const { feed } = fixture(occupied());
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  feed.current = {
    ...feed.current,
    state: {
      ...feed.current.state,
      pieces: feed.current.state.pieces.map((p, i) =>
        i ? p : { ...p, remaining: 2, summonedPly: 2 },
      ),
    },
  };
  await c.retry();
  await c.retry();
  expect(c.room?.state.pieces[0]).toMatchObject({
    remaining: 2,
    summonedPly: 2,
  });
  expect(notify).toHaveBeenCalledTimes(before + 1);
});
scenario(3, async () => {
  const { feed, fetcher } = fixture(playing());
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  feed.current = {
    ...feed.current,
    status: "finished",
    state: {
      ...feed.current.state,
      consecutivePasses: 2,
      outcome: { kind: "draw", reason: "passes" },
    },
  };
  await c.retry();
  const calls = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(c.room?.state.outcome).toEqual({ kind: "draw", reason: "passes" });
  expect(notify).toHaveBeenCalledTimes(before + 1);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
scenario(4, async () => {
  const { feed } = fixture(occupied());
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  feed.current = {
    ...feed.current,
    state: { ...feed.current.state, pieces: [] },
  };
  await c.retry();
  await c.retry();
  expect(c.room?.state.pieces).toEqual([]);
  expect(notify).toHaveBeenCalledTimes(before + 1);
});
scenario(5, async () => {
  const { feed, fetcher } = fixture(occupied());
  const firstNotify = vi.fn(),
    secondNotify = vi.fn();
  const first = client(firstNotify),
    second = client(secondNotify);
  await first.resume(id);
  await second.resume(id);
  const firstCount = firstNotify.mock.calls.length,
    secondCount = secondNotify.mock.calls.length;
  feed.current = {
    ...feed.current,
    state: { ...feed.current.state, grain: { white: 21, black: 14 } },
  };
  await first.retry();
  await second.retry();
  expect(firstNotify).toHaveBeenCalledTimes(firstCount + 1);
  expect(secondNotify).toHaveBeenCalledTimes(secondCount + 1);
  first.dispose();
  const reads = stateCalls(fetcher).length;
  await vi.advanceTimersByTimeAsync(2500);
  expect(stateCalls(fetcher)).toHaveLength(reads + 1);
  expect(secondNotify).toHaveBeenCalledTimes(secondCount + 1);
  expect(second.room?.state.grain).toEqual({ white: 21, black: 14 });
});
scenario(6, async () => {
  const { feed } = fixture(occupied());
  const seen: number[] = [];
  const c = client(() => {
    if (c.room) seen.push(c.room.state.grain.black);
  });
  await c.resume(id);
  seen.length = 0;
  const previous = c.room!;
  feed.current.state.grain.black = 19;
  expect(previous.state.grain.black).not.toBe(19);
  await c.retry();
  expect(previous.state.grain.black).not.toBe(19);
  expect(c.room?.state.grain.black).toBe(19);
  expect(seen).toEqual([19]);
});
scenario(7, async () => {
  const { feed } = fixture(playing());
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  for (const turn of ["black", "white", "black", "white"] as const) {
    feed.current = { ...feed.current, state: { ...feed.current.state, turn } };
    await c.retry();
    await c.retry();
  }
  expect(notify).toHaveBeenCalledTimes(before + 4);
  expect(c.room?.state.turn).toBe("white");
});
scenario(8, async () => {
  const { feed, fetcher } = fixture(occupied());
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  visibility.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  feed.current = {
    ...feed.current,
    state: {
      ...feed.current.state,
      turn: "black",
      ply: 1,
      grain: { white: 9, black: 8 },
    },
  };
  await vi.advanceTimersByTimeAsync(180000);
  expect(stateCalls(fetcher)).toHaveLength(1);
  visibility.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(notify).toHaveBeenCalledTimes(before + 1);
  await vi.advanceTimersByTimeAsync(1199);
  expect(stateCalls(fetcher)).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(stateCalls(fetcher)).toHaveLength(3);
  expect(notify).toHaveBeenCalledTimes(before + 1);
});
scenario(9, async () => {
  const { feed } = fixture(occupied());
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  feed.current = {
    ...feed.current,
    version: 6,
    state: { ...feed.current.state, pieces: [] },
  };
  await c.retry();
  expect(c.room?.state.pieces).toHaveLength(2);
  expect(notify).toHaveBeenCalledTimes(before);
  feed.current.version = 7;
  await c.retry();
  expect(c.room?.state.pieces).toHaveLength(0);
  expect(notify).toHaveBeenCalledTimes(before + 1);
});
scenario(10, async () => {
  const { feed } = fixture(occupied());
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  const original = feed.current;
  feed.current = Object.fromEntries(
    Object.entries(original).reverse(),
  ) as RoomView;
  feed.current.state = Object.fromEntries(
    Object.entries(original.state).reverse(),
  ) as RoomView["state"];
  feed.current.ready = {
    black: original.ready.black,
    white: original.ready.white,
  };
  feed.current.state.grain = {
    black: original.state.grain.black,
    white: original.state.grain.white,
  };
  feed.current.state.pieces = original.state.pieces.map(
    (piece) =>
      Object.fromEntries(Object.entries(piece).reverse()) as typeof piece,
  );
  await c.retry();
  expect(c.room).toEqual(original);
  expect(notify).toHaveBeenCalledTimes(before);
  feed.current = {
    ...feed.current,
    state: {
      ...feed.current.state,
      pieces: [...feed.current.state.pieces].reverse(),
    },
  };
  await c.retry();
  await c.retry();
  expect(c.room?.state.pieces.map((piece) => piece.id)).toEqual([
    "black-link",
    "white-leaper",
  ]);
  expect(notify).toHaveBeenCalledTimes(before + 1);
});
scenario(11, async () => {
  const { feed, fetcher } = fixture();
  const notify = vi.fn();
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  for (let minute = 0; minute < 15; minute++) {
    if (minute % 3 === 0)
      feed.current = { ...feed.current, joined: !feed.current.joined };
    await vi.advanceTimersByTimeAsync(60000);
  }
  expect(stateCalls(fetcher)).toHaveLength(601);
  expect(notify).toHaveBeenCalledTimes(before + 5);
  c.stop();
  const stopped = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(stopped);
});
scenario(12, async () => {
  let code = "";
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? response({ ok: true })
        : code
          ? response({ error: code }, 429)
          : response(room()),
    ),
  );
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  for (const next of [
    "RATE_LIMIT",
    "RATE_LIMIT",
    "CAPACITY",
    "CAPACITY",
    "RATE_LIMIT",
    "RATE_LIMIT",
  ]) {
    code = next;
    await c.retry();
  }
  expect(c.error).toContain("少し時間");
  expect(notify).toHaveBeenCalledTimes(before + 3);
  code = "";
  await c.retry();
  expect(c.connected).toBe(true);
  expect(c.error).toBe("");
  expect(notify).toHaveBeenCalledTimes(before + 4);
});
scenario(13, async () => {
  let phase = 0;
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p === "/api/session") return response({ ok: true });
      if (phase === 1) throw Error("dropped");
      if (phase === 2) return new Response("<html>portal</html>");
      return response(room());
    }),
  );
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  phase = 1;
  await c.retry();
  const network = c.error;
  phase = 2;
  await c.retry();
  await c.retry();
  expect(c.error).not.toBe(network);
  expect(notify).toHaveBeenCalledTimes(before + 2);
  phase = 3;
  await c.retry();
  expect(c.error).toBe("");
  expect(notify).toHaveBeenCalledTimes(before + 3);
});
scenario(14, async () => {
  let current = playing();
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (p.endsWith("/action")) throw Error("receipt lost");
      return response(p === "/api/session" ? { ok: true } : current);
    }),
  );
  const c = client(notify);
  await c.resume(id);
  await c.submit({ type: "pass" });
  const receipt = sessionStorage.getItem(`interval-pending:${id}`),
    error = c.error,
    before = notify.mock.calls.length;
  current = playing({
    version: 9,
    state: { ...createGame(), ply: 2, grain: { white: 11, black: 12 } },
  });
  await vi.advanceTimersByTimeAsync(2500);
  await vi.advanceTimersByTimeAsync(2500);
  expect(c.pending).toBe(true);
  expect(c.error).toBe(error);
  expect(c.room?.version).toBe(9);
  expect(sessionStorage.getItem(`interval-pending:${id}`)).toBe(receipt);
  expect(notify).toHaveBeenCalledTimes(before + 1);
});
scenario(15, async () => {
  let attempt = 0;
  const bodies: string[] = [];
  const seen: {
    version: number | undefined;
    busy: boolean;
    pending: boolean;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/action")) {
        bodies.push(String(init.body));
        if (++attempt === 1) throw Error("lost");
        return response(playing({ version: 8 }));
      }
      return response(
        p === "/api/session"
          ? { ok: true }
          : playing({ version: attempt ? 10 : 7 }),
      );
    }),
  );
  const c = client(() =>
    seen.push({ version: c.room?.version, busy: c.busy, pending: c.pending }),
  );
  await c.resume(id);
  await c.submit({ type: "pass" });
  seen.length = 0;
  expect(await c.retry()).toBe(true);
  expect(bodies[1]).toBe(bodies[0]);
  expect(c.room?.version).toBe(10);
  expect(c.pending).toBe(false);
  expect(seen).toEqual([
    { version: 10, busy: true, pending: true },
    { version: 10, busy: true, pending: false },
    { version: 10, busy: false, pending: false },
  ]);
});
scenario(16, async () => {
  const bodies: string[] = [];
  let current = playing();
  const f = vi.fn(async (p: string, init: RequestInit) => {
    if (p.endsWith("/leave")) {
      bodies.push(String(init.body));
      if (bodies.length === 1) return response({ ...current, ready: null });
      current = playing({ status: "closed", version: 8 });
    }
    return response(p === "/api/session" ? { ok: true } : current);
  });
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  expect(await c.leave()).toBe(false);
  expect(c.pending).toBe(true);
  expect(await c.retry()).toBe(true);
  expect(bodies[1]).toBe(bodies[0]);
  expect(c.room?.status).toBe("closed");
  expect(c.pending).toBe(false);
  const count = f.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(f).toHaveBeenCalledTimes(count);
});
scenario(17, async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/ready")) {
        bodies.push(String(init.body));
        if (bodies.length === 1)
          throw new DOMException("timeout", "AbortError");
        if (bodies.length === 2)
          return new Response("upstream unavailable", { status: 502 });
        if (bodies.length === 3)
          return response({ error: "SERVICE_UNAVAILABLE" }, 503);
        return response(
          room({ ready: { white: true, black: false }, version: 8 }),
        );
      }
      return response(p === "/api/session" ? { ok: true } : room());
    }),
  );
  const c = client();
  await c.resume(id);
  await c.ready();
  for (let i = 0; i < 2; i++) {
    expect(c.pending).toBe(true);
    await c.retry();
  }
  expect(c.pending).toBe(true);
  await c.retry();
  expect(bodies).toHaveLength(4);
  expect(new Set(bodies).size).toBe(1);
  expect(c.pending).toBe(false);
  expect(c.room?.ready.white).toBe(true);
});
scenario(18, async () => {
  const bodies: string[] = [];
  for (const name of ["getItem", "setItem", "removeItem"] as const)
    vi.spyOn(Storage.prototype, name).mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/action")) {
        bodies.push(String(init.body));
        if (bodies.length === 1) throw Error("lost");
      }
      return response(p === "/api/session" ? { ok: true } : playing());
    }),
  );
  const c = client();
  await c.resume(id);
  await c.submit({ type: "pass" });
  expect(c.pending).toBe(true);
  await c.retry();
  expect(bodies[1]).toBe(bodies[0]);
  expect(c.pending).toBe(false);
  expect(c.error).toBe("");
});
scenario(19, async () => {
  let failed = true;
  const f = vi.fn(async (p: string) => {
    if (p.endsWith("/action") && failed) throw Error("lost");
    return response(p === "/api/session" ? { ok: true } : playing());
  });
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  visibility.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  await c.submit({ type: "pass" });
  expect(c.pending).toBe(true);
  expect(c.connected).toBe(false);
  expect(stateCalls(f)).toHaveLength(1);
  failed = false;
  await c.retry();
  expect(c.pending).toBe(false);
  expect(c.connected).toBe(true);
  expect(stateCalls(f)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(stateCalls(f)).toHaveLength(1);
  visibility.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(stateCalls(f)).toHaveLength(2);
});
scenario(20, async () => {
  const bodies: { commandId: string; version: number }[] = [];
  let current = room();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/ready")) {
        bodies.push(JSON.parse(String(init.body)));
        if (bodies.length === 1) {
          current = room({ version: 8, ready: { white: false, black: true } });
          return response({ error: "RATE_LIMIT" }, 429);
        }
        current = room({ version: 9, ready: { white: true, black: true } });
      }
      return response(p === "/api/session" ? { ok: true } : current);
    }),
  );
  const c = client();
  await c.resume(id);
  await c.ready();
  expect(c.error).toContain("少し時間");
  expect(c.pending).toBe(false);
  expect(sessionStorage.getItem(`interval-pending:${id}`)).toBeNull();
  await c.retry();
  expect(bodies).toHaveLength(1);
  expect(c.error).toBe("");
  await c.ready();
  expect(bodies.map((b) => b.version)).toEqual([7, 8]);
  expect(bodies[0].commandId).not.toBe(bodies[1].commandId);
  expect(c.room?.ready.white).toBe(true);
  expect(c.pending).toBe(false);
});
scenario(21, async () => {
  let offline = false;
  const notify = vi.fn();
  const f = vi.fn(async (p: string) => {
    if (offline) throw Error("offline");
    return response(p === "/api/session" ? { ok: true } : room());
  });
  vi.stubGlobal("fetch", f);
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  offline = true;
  for (const delay of [1500, 4000, 8000, 16000, 20000, 20000])
    await vi.advanceTimersByTimeAsync(delay);
  expect(stateCalls(f)).toHaveLength(7);
  expect(notify).toHaveBeenCalledTimes(before + 1);
  offline = false;
  await vi.advanceTimersByTimeAsync(20000);
  expect(c.connected).toBe(true);
  expect(notify).toHaveBeenCalledTimes(before + 2);
  await vi.advanceTimersByTimeAsync(1500);
  expect(stateCalls(f)).toHaveLength(9);
  expect(notify).toHaveBeenCalledTimes(before + 2);
});
scenario(22, async () => {
  let abort = false,
    current = occupied();
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) => {
      if (abort) throw new DOMException("deadline", "AbortError");
      return response(p === "/api/session" ? { ok: true } : current);
    }),
  );
  const c = client(notify);
  await c.resume(id);
  const before = notify.mock.calls.length;
  abort = true;
  await c.retry();
  expect(c.connected).toBe(false);
  visibility.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(120000);
  abort = false;
  current = {
    ...current,
    state: { ...current.state, pieces: current.state.pieces.slice(1) },
  };
  visibility.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(c.connected).toBe(true);
  expect(c.room?.state.pieces).toHaveLength(1);
  expect(c.error).toBe("");
  expect(notify).toHaveBeenCalledTimes(before + 2);
});
scenario(23, async () => {
  const d = deferred<Response>();
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p.endsWith("/action")
        ? d.promise
        : response(p === "/api/session" ? { ok: true } : playing()),
    ),
  );
  const c = client(notify);
  await c.resume(id);
  const action = c.submit({ type: "pass" });
  const receipt = sessionStorage.getItem(`interval-pending:${id}`);
  c.stop();
  const before = notify.mock.calls.length;
  d.resolve(response(playing({ version: 8 })));
  expect(await action).toBe(false);
  expect(c.room).toBeNull();
  expect(c.pending).toBe(false);
  expect(c.busy).toBe(false);
  expect(notify).toHaveBeenCalledTimes(before);
  expect(sessionStorage.getItem(`interval-pending:${id}`)).toBe(receipt);
});
scenario(24, async () => {
  const d = deferred<Response>();
  const notify = vi.fn();
  const f = vi.fn(async (p: string) =>
    p.endsWith("/leave")
      ? d.promise
      : response(p === "/api/session" ? { ok: true } : playing()),
  );
  vi.stubGlobal("fetch", f);
  const c = client(notify);
  await c.resume(id);
  const leave = c.leave();
  c.stop();
  const before = notify.mock.calls.length,
    calls = f.mock.calls.length;
  d.reject(new DOMException("late abort", "AbortError"));
  expect(await leave).toBe(false);
  expect(c.error).toBe("");
  expect(c.room).toBeNull();
  expect(c.unavailable).toBe(false);
  expect(notify).toHaveBeenCalledTimes(before);
  expect(f).toHaveBeenCalledTimes(calls);
});
scenario(25, async () => {
  const oldResponse = deferred<Response>(),
    preparation = deferred<Response>();
  let slow = false,
    changingRoom = false;
  const f = vi.fn(async (p: string) => {
    if (p === "/api/session")
      return changingRoom ? preparation.promise : response({ ok: true });
    if (p.includes(nextId)) return response(room({ id: nextId, version: 12 }));
    return slow ? oldResponse.promise : response(room());
  });
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  slow = true;
  const old = c.retry();
  changingRoom = true;
  const replacement = c.resume(nextId);
  const duringPreparation = stateCalls(f).length;
  await vi.advanceTimersByTimeAsync(1500);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(stateCalls(f)).toHaveLength(duringPreparation);
  expect(c.busy).toBe(true);
  expect(c.connected).toBe(false);
  preparation.resolve(response({ ok: true }));
  await replacement;
  oldResponse.resolve(response(room({ version: 99 })));
  await old;
  const before = stateCalls(f).length;
  await c.retry();
  expect(c.room?.id).toBe(nextId);
  expect(c.room?.version).toBe(12);
  expect(stateCalls(f)).toHaveLength(before + 1);
});
scenario(26, async () => {
  const oldResponse = deferred<Response>(),
    preparation = deferred<Response>();
  let requests = 0,
    restarting = false,
    failPreparation = false;
  const f = vi.fn(async (p: string) => {
    if (p === "/api/session") {
      if (failPreparation) throw Error("replacement session offline");
      return restarting ? preparation.promise : response({ ok: true });
    }
    return ++requests === 2
      ? oldResponse.promise
      : response(room({ version: requests + 6 }));
  });
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  const old = c.retry();
  restarting = true;
  const replacement = c.resume(id);
  oldResponse.reject(Error("obsolete connection"));
  await old;
  const duringPreparation = stateCalls(f).length;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(3000);
  expect(stateCalls(f)).toHaveLength(duringPreparation);
  expect(c.error).toBe("");
  expect(c.busy).toBe(true);
  preparation.resolve(response({ ok: true }));
  await replacement;
  restarting = false;
  const before = stateCalls(f).length;
  await vi.advanceTimersByTimeAsync(1500);
  expect(stateCalls(f)).toHaveLength(before + 1);
  expect(c.connected).toBe(true);
  expect(c.error).toBe("");
  failPreparation = true;
  await c.resume(id);
  expect(c.connected).toBe(false);
  expect(c.busy).toBe(false);
  expect(c.room?.id).toBe(id);
  failPreparation = false;
  const retryCalls = f.mock.calls.length;
  await c.retry();
  expect(c.connected).toBe(true);
  expect(c.error).toBe("");
  expect(f.mock.calls.length).toBeGreaterThan(retryCalls);
});
scenario(27, async () => {
  const oldD = deferred<Response>(),
    newD = deferred<Response>();
  let oldSlow = false,
    newSlow = false;
  const f = vi.fn(async (p: string) =>
    p === "/api/session"
      ? response({ ok: true })
      : p.includes(nextId)
        ? newSlow
          ? newD.promise
          : response(room({ id: nextId }))
        : oldSlow
          ? oldD.promise
          : response(room()),
  );
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  oldSlow = true;
  const old = c.retry();
  c.stop();
  await c.resume(nextId);
  newSlow = true;
  const current = c.retry();
  const before = stateCalls(f).length;
  oldD.resolve(response(room({ version: 99 })));
  await old;
  await c.retry();
  expect(stateCalls(f)).toHaveLength(before);
  newD.resolve(response(room({ id: nextId, version: 8 })));
  await current;
  expect(c.room?.id).toBe(nextId);
  expect(c.room?.version).toBe(8);
  expect(c.connected).toBe(true);
});
scenario(28, async () => {
  const firstD = deferred<Response>(),
    lastD = deferred<Response>();
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? response({ ok: true })
        : p.includes(nextId)
          ? lastD.promise
          : firstD.promise,
    ),
  );
  const c = client(notify);
  const first = c.join(id, invite);
  const rejectFirst = expect(first).rejects.toMatchObject({
    code: "CANCELLED",
  });
  await flush();
  const last = c.join(nextId, invite);
  await flush();
  lastD.resolve(response(room({ id: nextId, seat: "black" })));
  await last;
  const before = notify.mock.calls.length;
  firstD.resolve(response(room({ seat: "black", version: 99 })));
  await rejectFirst;
  expect(c.room?.id).toBe(nextId);
  expect(c.busy).toBe(false);
  expect(notify).toHaveBeenCalledTimes(before);
});
scenario(29, async () => {
  const d = deferred<Response>();
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p === "/api/session"
        ? response({ ok: true })
        : p === "/api/rooms"
          ? d.promise
          : response(room({ id: nextId, seat: "black" })),
    ),
  );
  const c = client(notify);
  const creating = c.create();
  const cancelled = expect(creating).rejects.toMatchObject({
    code: "CANCELLED",
  });
  await flush();
  const key = sessionStorage.getItem("interval-create");
  expect(key).toBeTruthy();
  await c.join(nextId, invite);
  const before = notify.mock.calls.length;
  d.resolve(response(room()));
  await cancelled;
  expect(c.room?.id).toBe(nextId);
  expect(sessionStorage.getItem("interval-create")).toBe(key);
  expect(notify).toHaveBeenCalledTimes(before);
});
scenario(30, async () => {
  const bodies: string[] = [];
  const notify = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p === "/api/session") return response({ ok: true });
      bodies.push(String(init.body));
      if (bodies.length === 1)
        return response({ error: "SERVICE_UNAVAILABLE" }, 503);
      if (bodies.length === 2) return response({ ...room(), expiresAt: null });
      return response(room());
    }),
  );
  const c = client(notify);
  await expect(c.create()).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  const firstCount = notify.mock.calls.length;
  await expect(c.create()).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  expect(notify.mock.calls.length).toBeGreaterThan(firstCount);
  await c.create();
  expect(bodies).toHaveLength(3);
  expect(new Set(bodies).size).toBe(1);
  expect(sessionStorage.getItem("interval-create")).toBeNull();
  expect(c.error).toBe("");
});
scenario(31, async () => {
  const { fetcher } = fixture(playing());
  let cancel = false;
  const c = client(() => {
    if (cancel && c.busy && c.pending) {
      cancel = false;
      c.stop();
    }
  });
  await c.resume(id);
  cancel = true;
  expect(await c.submit({ type: "pass" })).toBe(false);
  expect(c.room).toBeNull();
  expect(c.busy).toBe(false);
  expect.soft(writes(fetcher)).toHaveLength(0);
  expect.soft(sessionStorage.getItem(`interval-pending:${id}`)).toBeNull();
  await c.resume(id);
  await c.retry();
  expect.soft(writes(fetcher)).toHaveLength(0);
  c.stop();
  for (const operation of ["create", "join", "resume"] as const) {
    let cancelPreparation = true;
    const next = client(() => {
      if (cancelPreparation && next.busy) {
        cancelPreparation = false;
        next.stop();
      }
    });
    const before = fetcher.mock.calls.length;
    if (operation === "create")
      await expect(next.create()).rejects.toMatchObject({ code: "CANCELLED" });
    else if (operation === "join")
      await expect(next.join(id, invite)).rejects.toMatchObject({
        code: "CANCELLED",
      });
    else await next.resume(id);
    expect(next.room).toBeNull();
    expect(next.busy).toBe(false);
    expect(next.error).toBe("");
    expect.soft(fetcher).toHaveBeenCalledTimes(before);
  }
  const uncertain = JSON.stringify({
    op: "action",
    body: {
      commandId: "already-uncertain",
      version: 7,
      action: { type: "pass" },
    },
  });
  sessionStorage.setItem(`interval-pending:${id}`, uncertain);
  let cancelRetry = false;
  const retryClient = client(() => {
    if (cancelRetry && retryClient.busy && retryClient.pending) {
      cancelRetry = false;
      retryClient.stop();
    }
  });
  await retryClient.resume(id);
  expect(retryClient.pending).toBe(true);
  cancelRetry = true;
  const sent = writes(fetcher).length;
  await retryClient.retry();
  expect(retryClient.room).toBeNull();
  expect(writes(fetcher)).toHaveLength(sent);
  expect(sessionStorage.getItem(`interval-pending:${id}`)).toBe(uncertain);
});
scenario(32, async () => {
  const { feed } = fixture();
  let explode = false;
  const notify = vi.fn(() => {
    if (explode) {
      explode = false;
      throw Error("render recovery required");
    }
  });
  const c = client(notify);
  await c.resume(id);
  feed.current = room({ ready: { white: false, black: true } });
  explode = true;
  await c.retry();
  expect(c.connected).toBe(false);
  expect(c.error).toBe("render recovery required");
  const before = notify.mock.calls.length;
  await c.retry();
  expect(c.room?.ready.black).toBe(true);
  expect(c.connected).toBe(true);
  expect(c.error).toBe("");
  expect(notify).toHaveBeenCalledTimes(before + 1);
  await c.retry();
  expect(notify).toHaveBeenCalledTimes(before + 1);
});
scenario(33, async () => {
  const { feed } = fixture();
  let reset = false;
  const notify = vi.fn(() => {
    if (reset && c.room?.version === 8) {
      reset = false;
      c.stop();
      throw Error("old renderer detached");
    }
  });
  const c = client(notify);
  await c.resume(id);
  feed.current = room({ version: 8 });
  reset = true;
  await c.retry();
  const before = notify.mock.calls.length;
  c.stop();
  expect(c.room).toBeNull();
  expect(c.error).toBe("");
  expect(c.busy).toBe(false);
  expect(notify).toHaveBeenCalledTimes(before);
});
scenario(34, async () => {
  const d = deferred<Response>();
  let slow = false;
  const f = vi.fn(async (p: string) =>
    slow ? d.promise : response(p === "/api/session" ? { ok: true } : room()),
  );
  vi.stubGlobal("fetch", f);
  const c = client();
  await c.resume(id);
  slow = true;
  const work = c.retry();
  for (let i = 0; i < 20; i++) {
    document.dispatchEvent(new Event("visibilitychange"));
    await c.retry();
  }
  await vi.advanceTimersByTimeAsync(60000);
  expect(stateCalls(f)).toHaveLength(2);
  slow = false;
  d.resolve(response(room()));
  await work;
  await vi.advanceTimersByTimeAsync(1499);
  expect(stateCalls(f)).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(stateCalls(f)).toHaveLength(3);
});
scenario(35, async () => {
  const { fetcher } = fixture();
  const notify = vi.fn();
  const c = client(notify);
  visibility.mockReturnValue(true);
  await c.resume(id);
  const before = notify.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(stateCalls(fetcher)).toHaveLength(1);
  visibility.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(stateCalls(fetcher)).toHaveLength(2);
  expect(notify).toHaveBeenCalledTimes(before);
});
scenario(36, async () => {
  const d = deferred<Response>();
  let slow = false;
  const notify = vi.fn();
  const f = vi.fn(async (p: string) =>
    p === "/api/session"
      ? response({ ok: true })
      : p.endsWith("/leave")
        ? response(playing({ version: 8, status: "closed" }))
        : slow
          ? d.promise
          : response(playing()),
  );
  vi.stubGlobal("fetch", f);
  const c = client(notify);
  await c.resume(id);
  slow = true;
  const poll = c.retry();
  expect(await c.leave()).toBe(true);
  const before = notify.mock.calls.length;
  d.resolve(response(playing()));
  await poll;
  expect(c.room?.status).toBe("closed");
  expect(c.room?.version).toBe(8);
  expect(notify).toHaveBeenCalledTimes(before);
  const calls = f.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(f).toHaveBeenCalledTimes(calls);
});
scenario(37, async () => {
  const d = deferred<Response>();
  let newer = false;
  const seen: ReturnType<typeof snapshot>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string) =>
      p.endsWith("/action")
        ? d.promise
        : response(
            p === "/api/session"
              ? { ok: true }
              : playing({ version: newer ? 10 : 7 }),
          ),
    ),
  );
  const c = client(() => seen.push(snapshot(c)));
  await c.resume(id);
  const action = c.submit({ type: "pass" });
  newer = true;
  await vi.advanceTimersByTimeAsync(2500);
  expect(c.room?.version).toBe(10);
  expect(c.pending).toBe(true);
  seen.length = 0;
  d.resolve(response(playing({ version: 8 })));
  expect(await action).toBe(true);
  expect(c.room?.version).toBe(10);
  expect(seen.map((s) => [s.busy, s.pending, s.room?.version])).toEqual([
    [true, false, 10],
    [false, false, 10],
  ]);
});
scenario(38, async () => {
  const { fetcher } = fixture();
  const c = client();
  for (let i = 0; i < 20; i++) {
    await c.resume(id);
    c.stop();
    c.stop();
    await vi.advanceTimersByTimeAsync(3000);
  }
  expect(stateCalls(fetcher)).toHaveLength(20);
  await c.resume(id);
  await vi.advanceTimersByTimeAsync(1500);
  expect(stateCalls(fetcher)).toHaveLength(22);
  c.dispose();
  const calls = fetcher.mock.calls.length;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
scenario(39, async () => {
  let successful = false,
    failNewRoomState = false,
    failSession = false,
    stateReads = 0;
  const commands: [string, string][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: string, init: RequestInit) => {
      if (p.endsWith("/state")) stateReads++;
      if (failSession && p === "/api/session")
        throw Error("replacement preparation unavailable");
      if (failNewRoomState && p.includes(nextId) && p.endsWith("/state"))
        throw Error("new room temporarily offline");
      if (p.endsWith("/action")) {
        commands.push([p, String(init.body)]);
        if (!successful) throw Error("lost");
      }
      return response(
        p === "/api/session"
          ? { ok: true }
          : playing({ id: p.includes(nextId) ? nextId : id }),
      );
    }),
  );
  const c = client();
  await c.resume(id);
  await c.submit({ type: "pass" });
  const saved = sessionStorage.getItem(`interval-pending:${id}`);
  c.stop();
  await c.resume(nextId);
  expect(c.pending).toBe(false);
  await c.retry();
  expect(commands).toHaveLength(1);
  c.stop();
  await c.resume(id);
  expect(c.pending).toBe(true);
  expect(sessionStorage.getItem(`interval-pending:${id}`)).toBe(saved);
  successful = true;
  await c.retry();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(c.pending).toBe(false);
  const otherReceipt = {
    commandId: "room-b-recovery",
    version: 7,
    action: { type: "pass" },
  };
  sessionStorage.setItem(
    `interval-pending:${nextId}`,
    JSON.stringify({ op: "action", body: otherReceipt }),
  );
  failNewRoomState = true;
  await c.resume(nextId);
  expect(c.pending).toBe(true);
  expect(c.connected).toBe(false);
  failNewRoomState = false;
  const previousCommands = commands.length;
  await c.retry();
  expect.soft(commands).toHaveLength(previousCommands);
  expect(c.room?.id).toBe(nextId);
  expect(c.pending).toBe(true);
  await c.retry();
  expect(commands).toHaveLength(previousCommands + 1);
  expect(commands.at(-1)).toEqual([
    `/api/rooms/${nextId}/action`,
    JSON.stringify(otherReceipt),
  ]);
  expect(c.pending).toBe(false);
  for (const operation of ["create", "join"] as const) {
    failSession = true;
    const before = commands.length;
    if (operation === "create")
      await expect(c.create()).rejects.toMatchObject({ code: "NETWORK" });
    else
      await expect(c.join(id, invite)).rejects.toMatchObject({
        code: "NETWORK",
      });
    expect.soft(c.connected).toBe(false);
    expect(c.room?.id).toBe(nextId);
    await c.submit({ type: "pass" });
    expect.soft(commands).toHaveLength(before);
    failSession = false;
    await c.retry();
    expect(c.connected).toBe(true);
    expect(c.room?.id).toBe(nextId);
    expect(c.error).toBe("");
    expect(c.busy).toBe(false);
    expect(c.pending).toBe(false);
    const resumedReads = stateReads;
    await vi.advanceTimersByTimeAsync(2500);
    expect(stateReads).toBe(resumedReads + 1);
  }
});
scenario(40, async () => {
  const { feed, fetcher } = fixture(occupied());
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", `/?2d&room=${id}`);
  await import("../src/main");
  await flush();
  const home = document.getElementById("home")!,
    resume = document.getElementById("resume-game") as HTMLButtonElement;
  (document.getElementById("home-button") as HTMLButtonElement).click();
  await flush();
  expect(home.hidden).toBe(false);
  const focused = document.activeElement;
  await vi.advanceTimersByTimeAsync(7500);
  expect(document.activeElement).toBe(focused);
  feed.current = {
    ...feed.current,
    state: {
      ...feed.current.state,
      pieces: feed.current.state.pieces.filter((p) => p.id !== "white-leaper"),
    },
  };
  await vi.advanceTimersByTimeAsync(2500);
  expect(home.hidden).toBe(false);
  resume.click();
  await flush();
  expect(document.getElementById("arena")!.hidden).toBe(false);
  expect(document.querySelector('[data-piece-id="white-leaper"]')).toBeNull();
  expect(document.querySelector('[data-piece-id="black-link"]')).not.toBeNull();
  expect(writes(fetcher)).toHaveLength(0);
});
