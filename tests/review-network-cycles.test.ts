// @vitest-environment jsdom
// Ten distinct review journeys, not a parameterized count target. Network is mocked.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGame, applyAction } from "../src/game/engine";
import {
  createOnline,
  api,
  NetworkError,
  type RoomView,
} from "../src/app/online";
const id = "a".repeat(32);
const invite = "b".repeat(64);
const el = (id: string) => document.getElementById(id)!;
const click = (id: string) => (el(id) as HTMLButtonElement).click();
const flush = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
const res = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const room = (extra: Partial<RoomView> = {}): RoomView => ({
  id,
  seat: "white",
  version: 0,
  status: "waiting",
  joined: false,
  ready: { white: false, black: false },
  state: createGame(),
  expiresAt: Date.now() + 86400000,
  invite,
  ...extra,
});
const advance = (state: ReturnType<typeof createGame>) => {
  const next = applyAction(state, { type: "pass" });
  if (!next.ok) throw new Error(next.error);
  return next.state;
};
let listeners: [string, EventListenerOrEventListenerObject][];
beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type, listener, options) => {
      listeners.push([type, listener]);
      add(type, listener, options);
    },
  );
  document.body.className = "";
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.mocked(
    Object.getOwnPropertyDescriptor(document, "hidden")?.get as any,
  )?.mockReturnValue?.(true);
  document.dispatchEvent(new Event("visibilitychange"));
  for (const [type, listener] of listeners)
    document.removeEventListener(type, listener);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = "";
  document.body.className = "";
});
async function boot(path = "/?2d") {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", path);
  await import("../src/main");
  await flush();
}
it("C21 Sora retries a capped host attempt then explicitly starts CPU without hidden gameplay", async () => {
  const fetcher = vi.fn(async (path: string) =>
    path === "/api/session"
      ? res({ ok: true })
      : res({ error: "ROOM_LIMIT" }, 429),
  );
  vi.stubGlobal("fetch", fetcher);
  await boot();
  click("choose-friend");
  click("start-game");
  click("create-room");
  await flush();
  expect(el("friend-error").textContent).toContain("24時間に5つ");
  expect(el("home").hidden).toBe(false);
  expect(el("arena").hidden).toBe(true);
  expect((el("create-room") as HTMLButtonElement).disabled).toBe(false);
  click("create-room");
  await flush();
  const writes = fetcher.mock.calls.filter(
    ([path]) => path === "/api/rooms",
  ).length;
  expect(writes).toBe(2);
  click("close-friend");
  click("choose-cpu");
  click("start-game");
  expect(el("mode-label").textContent).toContain("CPU対戦");
  expect(el("ply").textContent).toBe("0 / 200 手");
  expect(document.querySelectorAll(".piece:not(.core)")).toHaveLength(0);
  expect(
    fetcher.mock.calls.filter(([path]) => path === "/api/rooms"),
  ).toHaveLength(writes);
});
it("C22 a delayed invitation join cannot reclaim a local match chosen after cancellation", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/api/session"
        ? res({ ok: true })
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    ),
  );
  await boot(`/?2d#room=${id}&invite=${invite}`);
  click("join-room");
  await flush();
  click("close-friend");
  click("choose-local");
  click("start-game");
  click("pass");
  click("confirm");
  await flush();
  finish(res(room({ seat: "black", joined: true })));
  await flush();
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(el("ply").textContent).toBe("1 / 200 手");
  expect(el("lobby").hidden).toBe(true);
  expect(history.state).toBeNull();
});
it("C23 a lost action reply survives a home interruption and retries the same receipt once", async () => {
  let current = room({
    status: "playing",
    joined: true,
    ready: { white: true, black: true },
  });
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith("/action")) {
        bodies.push(String(init.body));
        if (bodies.length === 1) {
          current = { ...current, version: 1, state: advance(current.state) };
          throw new Error("lost reply");
        }
      }
      return res(path === "/api/session" ? { ok: true } : current);
    }),
  );
  await boot(`/?2d&room=${id}`);
  click("pass");
  click("confirm");
  await flush();
  expect(el("retry").hidden).toBe(false);
  expect(el("ply").textContent).toBe("1 / 200 手");
  click("home-button");
  expect(el("home").hidden).toBe(false);
  click("resume-game");
  expect((el("pass") as HTMLButtonElement).disabled).toBe(true);
  click("retry");
  await flush();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(el("retry").hidden).toBe(true);
  expect(el("ply").textContent).toBe("1 / 200 手");
});
it("C24 friend updates while home resume at the authoritative board without fabricated skipped motion", async () => {
  let current = room({
    status: "playing",
    joined: true,
    ready: { white: true, black: true },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      res(path === "/api/session" ? { ok: true } : current),
    ),
  );
  await boot(`/?2d&room=${id}`);
  click("home-button");
  current = { ...current, version: 2, state: advance(advance(current.state)) };
  await vi.advanceTimersByTimeAsync(3000);
  expect(el("home").hidden).toBe(false);
  expect(el("arena").hidden).toBe(true);
  click("resume-game");
  expect(el("ply").textContent).toBe("2 / 200 手");
  expect(el("turn").textContent).toBe("白の手番");
  expect(document.querySelector("[data-moving-piece]")).toBeNull();
});
it("C25 a room expiring while home releases new local play without sending a leave", async () => {
  let expired = false;
  const fetcher = vi.fn(async (path: string) =>
    path === "/api/session"
      ? res({ ok: true })
      : expired
        ? res({ error: "ROOM_EXPIRED" }, 410)
        : res(room({ status: "playing", joined: true })),
  );
  vi.stubGlobal("fetch", fetcher);
  await boot(`/?2d&room=${id}`);
  click("home-button");
  expired = true;
  await vi.advanceTimersByTimeAsync(3000);
  click("choose-local");
  expect((el("start-game") as HTMLButtonElement).disabled).toBe(false);
  click("start-game");
  click("pass");
  click("confirm");
  await flush();
  expect(el("mode-label").textContent).toBe("この端末で2人");
  expect(el("ply").textContent).toBe("1 / 200 手");
  expect(fetcher.mock.calls.some(([path]) => path.endsWith("/leave"))).toBe(
    false,
  );
});
it("C26 an uncertain leave settles via exact receipt and allows an explicit new match", async () => {
  let current = room({ status: "playing", joined: true });
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith("/leave")) {
        bodies.push(String(init.body));
        current = { ...current, status: "closed", version: 1 };
        if (bodies.length === 1) throw new Error("reply lost");
      }
      return res(path === "/api/session" ? { ok: true } : current);
    }),
  );
  await boot(`/?2d&room=${id}`);
  click("menu");
  click("leave");
  await flush();
  expect(el("retry").hidden).toBe(false);
  expect((el("leave") as HTMLButtonElement).disabled).toBe(true);
  click("close-menu");
  click("retry");
  await flush();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(el("result-actions").hidden).toBe(false);
  click("again");
  click("close-friend");
  click("choose-local");
  click("start-game");
  expect(el("ply").textContent).toBe("0 / 200 手");
  expect(location.search).toBe("");
});
it("C27 cancelling resume during session preparation does not start a stale room request", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(async (path: string) =>
    path === "/api/session"
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : res(room()),
  );
  vi.stubGlobal("fetch", fetcher);
  const client = createOnline(() => {});
  const resuming = client.resume(id);
  client.stop();
  finish(res({ ok: true }));
  await resuming;
  expect(client.room).toBeNull();
  expect(client.busy).toBe(false);
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/api/session"]);
  client.dispose();
});
it("C28 a null JSON service error becomes actionable connection guidance rather than a raw exception", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => res(null, 503)),
  );
  await expect(api("/api/session")).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  await expect(api("/api/session")).rejects.toBeInstanceOf(NetworkError);
  await expect(api("/api/session")).rejects.toThrow("再接続");
});
it("C29 repeated poll failures back off, backgrounding stops requests, and dispose removes wakeups", async () => {
  let offline = false;
  const fetcher = vi.fn(async (path: string) => {
    if (offline) throw new Error("offline");
    return res(path === "/api/session" ? { ok: true } : room());
  });
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(Math, "random").mockReturnValue(0);
  const client = createOnline(() => {});
  await client.resume(id);
  offline = true;
  await vi.advanceTimersByTimeAsync(1500);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(3999);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(4);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(4);
  client.dispose();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it("C30 rapid Ready taps and a home interruption produce one request and resume the started match", async () => {
  let finish!: (value: Response) => void;
  const waiting = room({
    seat: "black",
    joined: true,
    ready: { white: true, black: false },
  });
  const fetcher = vi.fn(async (path: string) =>
    path.endsWith("/ready")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : res(path === "/api/session" ? { ok: true } : waiting),
  );
  vi.stubGlobal("fetch", fetcher);
  await boot(`/?2d&room=${id}`);
  click("ready");
  click("ready");
  click("home-button");
  finish(
    res({
      ...waiting,
      version: 1,
      status: "playing",
      ready: { white: true, black: true },
    }),
  );
  await flush();
  expect(el("home").hidden).toBe(false);
  click("resume-game");
  expect(
    fetcher.mock.calls.filter(([path]) => path.endsWith("/ready")),
  ).toHaveLength(1);
  expect(el("lobby").hidden).toBe(true);
  expect(el("network-banner").textContent).toBe("フレンドの手番です");
});
