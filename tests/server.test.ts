import { beforeEach, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleApi, TTL } from "../src/server/api";
import type { Database, Statement } from "../src/server/db";
import type { GameState } from "../src/game/types";
class SqliteD1 implements Database {
  tail = Promise.resolve();
  sql = new DatabaseSync(":memory:");
  constructor() {
    this.sql.exec("PRAGMA foreign_keys=ON");
    for (const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql")))
      this.sql.exec(readFileSync(`drizzle/${f}`, "utf8"));
  }
  prepare(sql: string): Statement {
    let args: unknown[] = [];
    const q: Statement = {
      bind(...v) {
        args = v;
        return q;
      },
      first: async <T>() =>
        (this.sql.prepare(sql).get(...(args as any[])) ?? null) as T | null,
      run: async () => ({
        meta: {
          changes: Number(
            this.sql.prepare(sql).run(...(args as any[])).changes,
          ),
        },
      }),
      all: async <T>() => ({
        results: this.sql.prepare(sql).all(...(args as any[])) as T[],
      }),
    };
    return q;
  }
  async batch(stmts: Statement[]) {
    let unlock!: () => void;
    const previous = this.tail;
    this.tail = new Promise((r) => (unlock = r));
    await previous;
    this.sql.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      this.sql.exec("COMMIT");
      return out;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    } finally {
      unlock();
    }
  }
}
let db: SqliteD1,
  now: number,
  counter = 0;
const cmd = () => `test_command_${++counter}_abcdefgh`;
const cookie = (char: string) => `__Host-interval-seat=${char.repeat(64)}`;
async function call(
  path: string,
  who = "a",
  payload?: unknown,
  extra: Record<string, string> = {},
  time = now,
) {
  const r = await handleApi(
    new Request(`https://interval.test${path}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        cookie: cookie(who),
        ...(payload === undefined
          ? {}
          : {
              origin: "https://interval.test",
              "Content-Type": "application/json",
              "X-Interval-Client": "1",
            }),
        ...extra,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
    { DB: db },
    time,
  );
  return {
    status: r.status,
    data: (await r.json()) as any,
    headers: r.headers,
  };
}
async function create() {
  return (await call("/api/rooms", "a", { commandId: cmd() })).data;
}
async function get(id: string, who = "a") {
  return (await call(`/api/rooms/${id}/state`, who)).data;
}
async function join(r: any, who = "b") {
  return call(`/api/rooms/${r.id}/join`, who, { invite: r.invite });
}
async function ready(r: any, who = "a") {
  return call(`/api/rooms/${r.id}/ready`, who, {
    version: r.version,
    commandId: cmd(),
  });
}
async function playing() {
  const r = await create();
  await join(r);
  await ready(await get(r.id));
  await ready(await get(r.id, "b"), "b");
  return get(r.id);
}
beforeEach(() => {
  db = new SqliteD1();
  now = 1_800_000_000_000 + counter * 120000;
});
it("new rooms start and become ready with only fixed cores and unchanged grain", async () => {
  const created = await create();
  expect(created.state).toEqual({
    pieces: [],
    cores: { white: 3, black: 45 },
    grain: { white: 16, black: 12 },
    turn: "white",
    ply: 0,
    consecutivePasses: 0,
    outcome: null,
  });
  await join(created);
  await ready(await get(created.id));
  await ready(await get(created.id, "b"), "b");
  const started = await get(created.id);
  expect(started.status).toBe("playing");
  expect(started.state).toEqual(created.state);
});
for (const side of ["white", "black"] as const)
  it.each(Array.from({ length: 49 }, (_, square) => square))(
    `server enforces ${side}'s own-half summon at square %i`,
    async (to) => {
      let r = await playing();
      if (side === "black") {
        const passed = await call(`/api/rooms/${r.id}/action`, "a", {
          version: r.version,
          commandId: cmd(),
          action: { type: "pass" },
        });
        expect(passed.status).toBe(200);
        r = passed.data;
      }
      const expected =
        to !== 3 && to !== 45 && (side === "white" ? to <= 20 : to >= 28);
      const result = await call(
        `/api/rooms/${r.id}/action`,
        side === "white" ? "a" : "b",
        {
          version: r.version,
          commandId: cmd(),
          action: { type: "summon", kind: "carver", duration: 3, to },
        },
      );
      expect(result.status).toBe(expected ? 200 : 400);
      const stored = await get(r.id);
      if (expected) {
        expect(stored.state.pieces).toHaveLength(1);
        expect(stored.state.pieces[0]).toMatchObject({
          side,
          kind: "carver",
          square: to,
          remaining: 3,
        });
        expect(stored.state.grain[side]).toBe(r.state.grain[side] - 9);
        expect(stored.state.grain[side === "white" ? "black" : "white"]).toBe(
          r.state.grain[side === "white" ? "black" : "white"] + 4,
        );
        expect(stored.version).toBe(r.version + 1);
      } else {
        expect(stored.state).toEqual(r.state);
        expect(stored.version).toBe(r.version);
      }
    },
  );
it("loading a persisted ongoing room preserves its existing pieces and state", async () => {
  const r = await playing();
  const persisted: GameState = {
    ...r.state,
    ply: 8,
    grain: { white: 23, black: 19 },
    pieces: [
      {
        id: "old-white",
        side: "white",
        kind: "bastion",
        square: 10,
        remaining: 3,
        summonedPly: -1,
      },
      {
        id: "old-black",
        side: "black",
        kind: "bastion",
        square: 38,
        remaining: 3,
        summonedPly: -1,
      },
      {
        id: "attacker",
        side: "white",
        kind: "carver",
        square: 29,
        remaining: 2,
        summonedPly: 6,
      },
    ],
  };
  db.sql
    .prepare("UPDATE rooms SET state = ? WHERE id = ?")
    .run(JSON.stringify(persisted), r.id);
  expect((await get(r.id)).state).toEqual(persisted);
  expect((await get(r.id, "b")).state).toEqual(persisted);
  expect(
    JSON.parse(
      db.sql.prepare("SELECT state FROM rooms WHERE id = ?").get(r.id)!
        .state as string,
    ),
  ).toEqual(persisted);
  const result = await call(`/api/rooms/${r.id}/action`, "a", {
    version: r.version,
    commandId: cmd(),
    action: { type: "pass" },
  });
  expect(result.status).toBe(200);
  expect(result.data.state.pieces).toEqual(
    persisted.pieces.map((piece) => ({
      ...piece,
      remaining: piece.remaining - (piece.side === "white" ? 1 : 0),
    })),
  );
});
it("session is secure HttpOnly and never exposes its token in JSON", async () => {
  const r = await handleApi(
    new Request("https://interval.test/api/session"),
    { DB: db },
    now,
  );
  expect(r.headers.get("set-cookie")).toMatch(
    /__Host-interval-seat=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict/,
  );
  expect(await r.json()).toEqual({ ok: true });
});
it("host invite survives reload, guest needs separate cookie, no hashes exposed", async () => {
  const r = await create();
  expect(r.state.grain.white).toBe(16);
  expect(await get(r.id)).toEqual(r);
  expect(JSON.stringify(r)).not.toMatch(/host_hash|guest_hash|invite_hash/);
  expect((await call(`/api/rooms/${r.id}/state`, "b")).status).toBe(403);
  expect((await join(r)).data.seat).toBe("black");
  expect((await join(r, "a")).data.seat).toBe("white");
});
it("create and join response loss recover using cookie and idempotency key", async () => {
  const id = cmd(),
    a = await call("/api/rooms", "a", { commandId: id }),
    b = await call("/api/rooms", "a", { commandId: id });
  expect(a.data.id).toBe(b.data.id);
  const x = await join(a.data),
    y = await join(a.data);
  expect(x.data.seat).toBe(y.data.seat);
  expect(x.data.version).toBe(y.data.version);
});
it("two isolated guests racing have exactly one seat", async () => {
  const r = await create();
  const results = await Promise.all([join(r, "b"), join(r, "c")]);
  expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
  const dbRoom = db.sql.prepare("SELECT guest_hash FROM rooms").get();
  expect(dbRoom?.guest_hash).toBeTruthy();
});
it("both ready required and stale readiness does not start twice", async () => {
  const r = await create();
  await join(r);
  const v = await get(r.id);
  const rs = await Promise.all([ready(v), ready(v, "b")]);
  expect(rs.map((x) => x.status).sort()).toEqual([200, 409]);
  let current = await get(r.id);
  expect(current.status).toBe("waiting");
  await ready(current, current.ready.white ? "b" : "a");
  current = await get(r.id);
  expect(current.status).toBe("playing");
  expect(current.version).toBe(3);
});
it("wrong seat and wrong turn cannot submit authoritative state", async () => {
  const r = await playing(),
    b = { version: r.version, commandId: cmd(), action: { type: "pass" } };
  expect((await call(`/api/rooms/${r.id}/action`, "b", b)).status).toBe(403);
  expect((await call(`/api/rooms/${r.id}/action`, "c", b)).status).toBe(403);
  expect(
    (await call(`/api/rooms/${r.id}/action`, "a", { ...b, state: {} })).status,
  ).toBe(400);
  expect((await get(r.id)).state.ply).toBe(0);
});
it("different simultaneous command ids accept exactly one CAS and one receipt", async () => {
  const r = await playing(),
    path = `/api/rooms/${r.id}/action`;
  const rs = await Promise.all([
    call(path, "a", {
      version: r.version,
      commandId: cmd(),
      action: { type: "pass" },
    }),
    call(path, "a", {
      version: r.version,
      commandId: cmd(),
      action: { type: "pass" },
    }),
  ]);
  expect(rs.map((x) => x.status).sort()).toEqual([200, 409]);
  expect((await get(r.id)).state.ply).toBe(1);
  expect(
    db.sql
      .prepare("SELECT count(*) as n FROM commands WHERE version = ?")
      .get(r.version + 1)?.n,
  ).toBe(1);
});
it("duplicate command mutates once and altered replay is rejected", async () => {
  const r = await playing(),
    p = `/api/rooms/${r.id}/action`,
    b = { version: r.version, commandId: cmd(), action: { type: "pass" } };
  const a = await call(p, "a", b);
  expect(a.status).toBe(200);
  expect((await call(p, "a", b)).status).toBe(200);
  expect(
    (
      await call(p, "a", {
        ...b,
        action: { type: "summon", kind: "link", duration: 1, to: 0 },
      })
    ).status,
  ).toBe(409);
  expect((await get(r.id)).state.ply).toBe(1);
});
it("old replay returns current state without rolling backward", async () => {
  const r = await playing(),
    p = `/api/rooms/${r.id}/action`,
    b = { version: r.version, commandId: cmd(), action: { type: "pass" } };
  await call(p, "a", b);
  const r2 = await get(r.id);
  await call(p, "b", {
    version: r2.version,
    commandId: cmd(),
    action: { type: "pass" },
  });
  expect((await call(p, "a", b)).data.state.ply).toBe(2);
});
it("illegal shapes and moves never age pieces or spend grain", async () => {
  const r = await playing();
  for (const a of [
    { type: "summon", kind: "carver", duration: 6, to: 0 },
    { type: "move", pieceId: "missing-piece", to: 4 },
    { type: "pass", anything: true },
  ]) {
    expect(
      (
        await call(`/api/rooms/${r.id}/action`, "a", {
          version: r.version,
          commandId: cmd(),
          action: a,
        })
      ).status,
    ).toBe(400);
  }
  expect((await get(r.id)).state).toEqual(r.state);
});
it("expiry is enforced even when rows have not been cleaned", async () => {
  const r = await playing();
  expect(
    (await call(`/api/rooms/${r.id}/state`, "a", undefined, {}, now + TTL + 1))
      .status,
  ).toBe(410);
  expect(db.sql.prepare("SELECT count(*) n FROM rooms").get()?.n).toBe(1);
});
it("leave closes permanently but finished result survives leave", async () => {
  const r = await playing();
  expect(
    (
      await call(`/api/rooms/${r.id}/leave`, "a", {
        version: r.version,
        commandId: cmd(),
      })
    ).data.status,
  ).toBe("closed");
  expect((await join(r, "c")).status).toBe(400);
  expect(
    (
      await call(`/api/rooms/${r.id}/ready`, "b", {
        version: r.version + 1,
        commandId: cmd(),
      })
    ).status,
  ).toBe(409);
});
it("six passes finish match and cannot mutate further; leave preserves result", async () => {
  const r = await playing();
  for (let i = 0; i < 6; i++) {
    const x = await get(r.id);
    expect(
      (
        await call(`/api/rooms/${r.id}/action`, i % 2 ? "b" : "a", {
          version: x.version,
          commandId: cmd(),
          action: { type: "pass" },
        })
      ).status,
    ).toBe(200);
  }
  const end = await get(r.id);
  expect(end.status).toBe("finished");
  expect(end.state.outcome.kind).toBe("draw");
  const leave = await call(`/api/rooms/${r.id}/leave`, "a", {
    version: end.version,
    commandId: cmd(),
  });
  expect(leave.data.status).toBe("finished");
  expect(leave.data.state).toEqual(end.state);
});
it("CSRF, wrong content type, oversized and malformed JSON fail closed", async () => {
  expect(
    (
      await call(
        "/api/rooms",
        "a",
        { commandId: cmd() },
        { origin: "https://evil.test" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        "/api/rooms",
        "a",
        { commandId: cmd() },
        { "Content-Type": "text/plain" },
      )
    ).status,
  ).toBe(415);
  expect(
    (await call("/api/rooms", "a", { commandId: "x".repeat(3000) })).status,
  ).toBe(413);
  const r = await handleApi(
    new Request("https://interval.test/api/rooms", {
      method: "POST",
      headers: {
        cookie: cookie("a"),
        origin: "https://interval.test",
        "Content-Type": "application/json",
        "X-Interval-Client": "1",
      },
      body: "{",
    }),
    { DB: db },
    now,
  );
  expect(r.status).toBe(400);
  expect(r.headers.get("cache-control")).toBe("no-store");
});
it("body without content length still enforces byte bound", async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode("x".repeat(2200)));
      c.close();
    },
  });
  const req = new Request("https://interval.test/api/rooms", {
    method: "POST",
    headers: {
      cookie: cookie("a"),
      origin: "https://interval.test",
      "Content-Type": "application/json",
      "X-Interval-Client": "1",
    },
    body: stream,
    duplex: "half",
  } as RequestInit);
  expect((await handleApi(req, { DB: db }, now)).status).toBe(413);
});
it("missing database returns safe unavailable error", async () => {
  const r = await handleApi(
    new Request("https://interval.test/api/rooms/x/state", {
      headers: { cookie: cookie("a") },
    }),
    {} as any,
    now,
  );
  expect(r.status).toBe(503);
  expect(await r.text()).not.toMatch(/SQL|stack|token/);
});
