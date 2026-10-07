import { createGame, applyAction } from "../game/engine";
import { KINDS, validSquare } from "../game/rules";
import type { Action, GameState, Side, Kind } from "../game/types";
import { database, type Env, type Database } from "./db";
export const TTL = 24 * 60 * 60 * 1000;
const COOKIE = "__Host-interval-seat";
const tokenPattern = /^[a-f0-9]{64}$/;
const roomPattern = /^[a-f0-9]{32}$/;
const commandPattern = /^[a-zA-Z0-9_-]{16,80}$/;
type Room = {
  id: string;
  invite_hash: string;
  host_hash: string;
  guest_hash: string | null;
  create_key: string;
  state: string;
  version: number;
  white_ready: number;
  black_ready: number;
  status: "waiting" | "playing" | "finished" | "closed";
  expires_at: number;
  updated_at: number;
  last_nonce: string | null;
};
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
const fail = (status: number, code: string): never => {
  throw new ApiError(status, code);
};
export async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
function session(req: Request) {
  const tokens = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith(`${COOKIE}=`))
    .map((x) => x.slice(COOKIE.length + 1));
  return tokens.length === 1 && tokenPattern.test(tokens[0]) ? tokens[0] : null;
}
function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}
function object(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
function exact(x: Record<string, unknown>, keys: string[]) {
  return Object.keys(x).sort().join(",") === [...keys].sort().join(",");
}
function action(x: unknown): Action {
  if (!object(x)) return fail(400, "BAD_ACTION");
  if (x.type === "pass" && exact(x, ["type"])) return { type: "pass" };
  if (
    x.type === "summon" &&
    exact(x, ["type", "kind", "duration", "to"]) &&
    KINDS.includes(x.kind as never) &&
    Number.isInteger(x.duration) &&
    Number(x.duration) >= 1 &&
    Number(x.duration) <= 5 &&
    validSquare(x.to)
  )
    return {
      type: "summon",
      kind: x.kind as Kind,
      duration: Number(x.duration),
      to: x.to,
    };
  if (
    x.type === "move" &&
    exact(x, ["type", "pieceId", "to"]) &&
    typeof x.pieceId === "string" &&
    x.pieceId.length <= 64 &&
    validSquare(x.to)
  )
    return { type: "move", pieceId: x.pieceId, to: x.to };
  if (
    x.type === "swap" &&
    exact(x, ["type", "pieceId", "allyId"]) &&
    typeof x.pieceId === "string" &&
    typeof x.allyId === "string" &&
    x.pieceId.length <= 64 &&
    x.allyId.length <= 64
  )
    return { type: "swap", pieceId: x.pieceId, allyId: x.allyId };
  return fail(400, "BAD_ACTION");
}
async function body(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    return fail(415, "JSON_REQUIRED");
  if (Number(req.headers.get("content-length")) > 2048)
    return fail(413, "TOO_LARGE");
  const reader = req.body?.getReader();
  if (!reader) return fail(400, "BAD_JSON");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 2048) {
      await reader.cancel();
      return fail(413, "TOO_LARGE");
    }
    chunks.push(r.value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(all));
  } catch {
    return fail(400, "BAD_JSON");
  }
  if (!object(parsed)) return fail(400, "BAD_JSON");
  return parsed;
}
function command(b: Record<string, unknown>) {
  if (typeof b.commandId !== "string" || !commandPattern.test(b.commandId))
    return fail(400, "BAD_COMMAND");
  return b.commandId;
}
function seatFor(r: Room, h: string): Side | null {
  return r.host_hash === h ? "white" : r.guest_hash === h ? "black" : null;
}
async function room(db: Database, id: string, now: number) {
  const r = await db
    .prepare("SELECT * FROM rooms WHERE id = ?")
    .bind(id)
    .first<Room>();
  if (!r || r.expires_at <= now) return fail(410, "ROOM_EXPIRED");
  return r;
}
async function view(r: Room, seat: Side, secret: string) {
  return {
    id: r.id,
    seat,
    version: r.version,
    status: r.status,
    expiresAt: r.expires_at,
    joined: !!r.guest_hash,
    ready: { white: !!r.white_ready, black: !!r.black_ready },
    state: JSON.parse(r.state) as GameState,
    ...(seat === "white" && r.status === "waiting"
      ? { invite: await hash(`${secret}:${r.id}:invite`) }
      : {}),
  };
}
const localRates = new Map<string, { until: number; count: number }>();
function readRate(key: string, now: number) {
  let r = localRates.get(key);
  if (!r || r.until < now) r = { until: now + 60000, count: 0 };
  if (localRates.size > 10000) localRates.clear();
  localRates.set(key, r);
  if (++r.count > 180) return fail(429, "RATE_LIMIT");
}
async function mutationRate(
  db: Database,
  key: string,
  now: number,
  limit: number,
) {
  const bucket = Math.floor(now / 60000),
    k = `${key}:${bucket}`;
  const result = await db
    .prepare(
      "INSERT INTO rates (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",
    )
    .bind(k, now + 120000)
    .first<{ count: number }>();
  if ((result?.count ?? Infinity) > limit) return fail(429, "RATE_LIMIT");
}
export async function cleanup(db: Database, now: number) {
  await db.batch([
    db
      .prepare(
        "DELETE FROM rooms WHERE id IN (SELECT id FROM rooms WHERE expires_at <= ? LIMIT 100)",
      )
      .bind(now),
    db
      .prepare(
        "DELETE FROM rates WHERE key IN (SELECT key FROM rates WHERE expires_at <= ? LIMIT 500)",
      )
      .bind(now),
  ]);
}
export async function handleApi(
  req: Request,
  env: Env,
  now = Date.now(),
): Promise<Response> {
  try {
    const u = new URL(req.url);
    if (req.headers.get("sec-fetch-site") === "cross-site")
      return fail(403, "SAME_ORIGIN_REQUIRED");
    if (
      req.method === "POST" &&
      (req.headers.get("origin") !== u.origin ||
        req.headers.get("X-Interval-Client") !== "1")
    )
      return fail(403, "SAME_ORIGIN_REQUIRED");
    const existing = session(req);
    if (u.pathname === "/api/session" && req.method === "GET")
      return json({ ok: true }, 200, {
        "Set-Cookie": `${COOKIE}=${existing ?? randomToken()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
      });
    const secret = existing ?? fail(401, "SESSION_REQUIRED"),
      identity = await hash(secret),
      db = database(env);
    readRate(identity, now);
    if (u.pathname === "/api/rooms" && req.method === "POST") {
      const b = await body(req);
      if (!exact(b, ["commandId"])) return fail(400, "BAD_JSON");
      const cmd = command(b),
        createKey = await hash(`${identity}:${cmd}`),
        id = createKey.slice(0, 32);
      const found = await db
        .prepare("SELECT * FROM rooms WHERE create_key = ?")
        .bind(createKey)
        .first<Room>();
      if (found) {
        if (found.expires_at <= now) return fail(410, "ROOM_EXPIRED");
        return json(await view(found, "white", secret));
      }
      const ip = req.headers.get("cf-connecting-ip") ?? identity;
      await mutationRate(
        db,
        `create:${await hash(ip + Math.floor(now / TTL))}`,
        now,
        6,
      );
      await cleanup(db, now);
      const count = await db
        .prepare(
          "SELECT count(*) AS count FROM rooms WHERE host_hash = ? AND expires_at > ?",
        )
        .bind(identity, now)
        .first<{ count: number }>();
      if ((count?.count ?? 99) >= 5) return fail(429, "ROOM_LIMIT");
      const total = await db
        .prepare("SELECT count(*) AS count FROM rooms WHERE expires_at > ?")
        .bind(now)
        .first<{ count: number }>();
      if ((total?.count ?? 999) >= 500) return fail(503, "CAPACITY");
      const invite = await hash(`${secret}:${id}:invite`);
      await db
        .prepare(
          "INSERT OR IGNORE INTO rooms (id,invite_hash,host_hash,create_key,state,version,white_ready,black_ready,status,expires_at,updated_at) SELECT ?,?,?,?,?,0,0,0,?,?,? WHERE (SELECT count(*) FROM rooms WHERE expires_at > ?) < 500 AND (SELECT count(*) FROM rooms WHERE host_hash = ? AND expires_at > ?) < 5",
        )
        .bind(
          id,
          await hash(invite),
          identity,
          createKey,
          JSON.stringify(createGame()),
          "waiting",
          now + TTL,
          now,
          now,
          identity,
          now,
        )
        .run();
      const inserted = await db
        .prepare("SELECT id FROM rooms WHERE id = ?")
        .bind(id)
        .first();
      if (!inserted) return fail(429, "ROOM_LIMIT");
      return json(await view(await room(db, id, now), "white", secret), 201);
    }
    const m = u.pathname.match(
      /^\/api\/rooms\/([a-f0-9]{32})\/(state|join|ready|action|leave)$/,
    );
    if (!m) return fail(404, "NOT_FOUND");
    const [, id, op] = m;
    let r = await room(db, id, now),
      seat = seatFor(r, identity);
    if (op === "state" && req.method === "GET") {
      if (!seat) return fail(403, "NO_SEAT");
      return json(await view(r, seat, secret));
    }
    if (req.method !== "POST") return fail(405, "METHOD");
    const b = await body(req);
    if (op === "join") {
      if (
        !exact(b, ["invite"]) ||
        typeof b.invite !== "string" ||
        !tokenPattern.test(b.invite)
      )
        return fail(400, "BAD_INVITE");
      await mutationRate(
        db,
        `join:${await hash((req.headers.get("cf-connecting-ip") ?? identity) + Math.floor(now / TTL))}`,
        now,
        15,
      );
      if ((await hash(b.invite)) !== r.invite_hash)
        return fail(403, "BAD_INVITE");
      if (seat) return json(await view(r, seat, secret));
      if (r.guest_hash) return fail(409, "ROOM_FULL");
      if (r.status !== "waiting") return fail(409, "ROOM_CLOSED");
      await db
        .prepare(
          "UPDATE rooms SET guest_hash = ?, version = version + 1, updated_at = ? WHERE id = ? AND guest_hash IS NULL AND status = 'waiting' AND expires_at > ?",
        )
        .bind(identity, now, id, now)
        .run();
      r = await room(db, id, now);
      seat = seatFor(r, identity);
      if (!seat) return fail(409, "ROOM_FULL");
      return json(await view(r, seat, secret));
    }
    if (!seat) return fail(403, "NO_SEAT");
    const cmd = command(b);
    if (!Number.isSafeInteger(b.version) || Number(b.version) < 0)
      return fail(400, "BAD_VERSION");
    if (
      !exact(
        b,
        op === "action"
          ? ["commandId", "version", "action"]
          : ["commandId", "version"],
      )
    )
      return fail(400, "BAD_JSON");
    const a = op === "action" ? action(b.action) : null,
      payloadHash = await hash(
        JSON.stringify({ op, version: b.version, action: a }),
      );
    const previous = await db
      .prepare(
        "SELECT payload_hash FROM commands WHERE room_id = ? AND seat = ? AND command_id = ?",
      )
      .bind(id, seat, cmd)
      .first<{ payload_hash: string }>();
    if (previous) {
      if (previous.payload_hash !== payloadHash)
        return fail(409, "COMMAND_CONFLICT");
      return json(await view(r, seat, secret));
    }
    await mutationRate(db, `command:${identity}`, now, 45);
    if (r.version !== b.version) return fail(409, "STALE_VERSION");
    if (r.status === "closed") return fail(409, "ROOM_CLOSED");
    let state = JSON.parse(r.state) as GameState;
    let status: Room["status"] = r.status,
      wr = r.white_ready,
      br = r.black_ready;
    if (op === "ready") {
      if (status !== "waiting") return fail(409, "ALREADY_STARTED");
      if (seat === "white" ? wr : br) return json(await view(r, seat, secret));
      if (seat === "white") wr = 1;
      else br = 1;
      if (wr && br && r.guest_hash) status = "playing";
    } else if (op === "leave") {
      if (status === "finished") return json(await view(r, seat, secret));
      status = "closed";
    } else {
      if (status !== "playing") return fail(409, "NOT_STARTED");
      if (state.turn !== seat) return fail(403, "WRONG_TURN");
      const result = applyAction(state, a!);
      if (!result.ok) return fail(400, "ILLEGAL_ACTION");
      state = result.state;
      if (state.outcome) status = "finished";
    }
    const nonce = randomToken();
    let changed = 0;
    try {
      const result = await db.batch([
        db
          .prepare(
            "UPDATE rooms SET state = ?, status = ?, white_ready = ?, black_ready = ?, version = version + 1, updated_at = ?, last_nonce = ? WHERE id = ? AND version = ? AND expires_at > ?",
          )
          .bind(
            JSON.stringify(state),
            status,
            wr,
            br,
            now,
            nonce,
            id,
            b.version,
            now,
          ),
        db
          .prepare(
            "INSERT INTO commands (room_id,seat,command_id,payload_hash,version) SELECT id,?,?,?,version FROM rooms WHERE id = ? AND last_nonce = ? AND version = ?",
          )
          .bind(seat, cmd, payloadHash, id, nonce, Number(b.version) + 1),
      ]);
      changed = result[0].meta.changes;
    } catch {
      const replay = await db
        .prepare(
          "SELECT payload_hash FROM commands WHERE room_id = ? AND seat = ? AND command_id = ?",
        )
        .bind(id, seat, cmd)
        .first<{ payload_hash: string }>();
      if (!replay) throw new Error("SAVE_FAILED");
      if (replay.payload_hash !== payloadHash)
        return fail(409, "COMMAND_CONFLICT");
      changed = 1;
    }
    if (!changed) {
      const replay = await db
        .prepare(
          "SELECT payload_hash FROM commands WHERE room_id = ? AND seat = ? AND command_id = ?",
        )
        .bind(id, seat, cmd)
        .first<{ payload_hash: string }>();
      if (!replay || replay.payload_hash !== payloadHash)
        return fail(409, "STALE_VERSION");
    }
    return json(await view(await room(db, id, now), seat, secret));
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.code }, e.status);
    return json({ error: "SERVICE_UNAVAILABLE" }, 503);
  }
}
