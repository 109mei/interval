import type { GameState, Side, Action } from "../game/types";
import { KINDS, validSquare } from "../game/rules";
export type RoomView = {
  id: string;
  seat: Side;
  version: number;
  status: "waiting" | "playing" | "finished" | "closed";
  expiresAt: number;
  joined: boolean;
  ready: Record<Side, boolean>;
  state: GameState;
  invite?: string;
};
const messages: Record<string, string> = {
  SESSION_REQUIRED:
    "接続を準備できませんでした。ページを再読み込みしてください。",
  ROOM_EXPIRED:
    "この部屋は期限切れか、見つかりません。新しい招待を受け取ってください。",
  ROOM_FULL: "この部屋は満員です。参加できるのは招待した1人だけです。",
  NO_SEAT:
    "このブラウザには参加情報がありません。招待リンクから参加してください。",
  BAD_INVITE: "招待リンクを確認してください。",
  WRONG_TURN: "相手の手番です。",
  STALE_VERSION: "盤面が更新されました。最新の盤面で選び直してください。",
  ROOM_CLOSED: "この部屋は終了しました。",
  RATE_LIMIT: "少し時間をおいて、もう一度お試しください。",
  ROOM_LIMIT:
    "このブラウザで作れる部屋は24時間に5つまでです。終了・退出した部屋も含まれます。フレンドに部屋を作って招待してもらうか、作成済みの部屋の期限が切れてからお試しください。",
  CAPACITY: "ただいま部屋が混み合っています。時間をおいてください。",
  SERVICE_UNAVAILABLE: "対戦サーバーに接続できません。再接続をお試しください。",
  ILLEGAL_ACTION: "この操作はできません。選び直してください。",
  NOT_STARTED: "2人の準備完了を待っています。",
};
export class NetworkError extends Error {
  constructor(public code: string) {
    super(messages[code] ?? "通信を確認して、もう一度お試しください。");
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body
        ? { "Content-Type": "application/json", "X-Interval-Client": "1" }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new NetworkError("NETWORK");
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new NetworkError("SERVICE_UNAVAILABLE");
  }
  if (!res.ok)
    throw new NetworkError(
      typeof data?.error === "string" ? data.error : "SERVICE_UNAVAILABLE",
    );
  return data as T;
}
// A successful HTTP status is not proof that the reply is a usable room.
// Validate before accepting a board or consuming an uncertain command receipt.
function roomResponse(value: unknown, expectedId?: string): RoomView {
  const r = value as RoomView | null;
  const s = r?.state;
  const side = (value: unknown) => value === "white" || value === "black";
  const whole = (value: unknown) =>
    Number.isSafeInteger(value) && Number(value) >= 0;
  const outcome = s?.outcome;
  if (
    !r ||
    typeof r !== "object" ||
    Array.isArray(r) ||
    typeof r.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(r.id) ||
    (expectedId !== undefined && r.id !== expectedId) ||
    !side(r.seat) ||
    !whole(r.version) ||
    !["waiting", "playing", "finished", "closed"].includes(r.status) ||
    !Number.isFinite(r.expiresAt) ||
    r.expiresAt <= 0 ||
    typeof r.joined !== "boolean" ||
    typeof r.ready?.white !== "boolean" ||
    typeof r.ready?.black !== "boolean" ||
    (r.invite !== undefined &&
      (typeof r.invite !== "string" || !/^[a-f0-9]{64}$/.test(r.invite))) ||
    !s ||
    typeof s !== "object" ||
    !side(s.turn) ||
    !whole(s.ply) ||
    s.ply > 200 ||
    !whole(s.consecutivePasses) ||
    !whole(s.grain?.white) ||
    !whole(s.grain?.black) ||
    s.cores?.white !== 3 ||
    s.cores?.black !== 45 ||
    !(
      outcome === null ||
      (outcome?.kind === "win" && side(outcome.winner)) ||
      (outcome?.kind === "draw" && ["passes", "limit"].includes(outcome.reason))
    ) ||
    !Array.isArray(s.pieces) ||
    !s.pieces.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        p.id.length > 0 &&
        side(p.side) &&
        KINDS.includes(p.kind) &&
        validSquare(p.square) &&
        Number.isInteger(p.remaining) &&
        p.remaining >= 1 &&
        p.remaining <= 5 &&
        Number.isInteger(p.summonedPly),
    ) ||
    new Set(s.pieces.map((p) => p.id)).size !== s.pieces.length ||
    new Set(s.pieces.map((p) => p.square)).size !== s.pieces.length
  )
    throw new NetworkError("SERVICE_UNAVAILABLE");
  // A terminal winner legitimately occupies the captured core. Do not apply
  // active-position legality here or rewrite older persisted room positions.
  return r;
}
export const commandId = () => crypto.randomUUID();
export function createOnline(onChange: () => void) {
  let room: RoomView | null = null,
    busy = false,
    error = "",
    connected = true,
    timer: ReturnType<typeof setTimeout> | undefined,
    failures = 0,
    active = false,
    inFlight = false,
    generation = 0;
  let pending: { op: string; body: unknown } | null = null;
  let requestedId: string | null = null;
  let unavailable = false;
  let creationId: string | null = null;
  let creationLoaded = false;
  let lastNotification: string | undefined;
  function notify() {
    // Polling still accepts and validates every snapshot. Only skip the UI
    // callback when all exposed values are identical, including recovery flags.
    // HTTP JSON object-key order does not change the exposed room values.
    const snapshot = JSON.stringify(
      [room, busy, error, connected, !!pending, unavailable],
      (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, value[key]]),
            )
          : value,
    );
    if (snapshot === lastNotification) return;
    const previous = lastNotification;
    lastNotification = snapshot;
    try {
      onChange();
    } catch (e) {
      // A failed callback must remain retryable; do not erase a newer nested
      // notification if the callback synchronously changed the client state.
      if (lastNotification === snapshot) lastNotification = previous;
      throw e;
    }
  }
  function beginSession() {
    // Retire the previous generation's poll lock and schedule before handover.
    // Its late finally block must not own the replacement session's lock.
    active = false;
    connected = false;
    inFlight = false;
    if (timer) clearTimeout(timer);
    timer = undefined;
    return ++generation;
  }
  function creationKey() {
    if (!creationLoaded) {
      creationLoaded = true;
      try {
        creationId = sessionStorage.getItem("interval-create");
      } catch {
        /* Keep same-page retries usable when browser storage is restricted. */
      }
    }
    creationId ||= commandId();
    try {
      sessionStorage.setItem("interval-create", creationId);
    } catch {}
    return creationId;
  }
  function clearCreationKey() {
    creationId = null;
    try {
      sessionStorage.removeItem("interval-create");
    } catch {}
  }
  const pendingKey = (id: string) => `interval-pending:${id}`;
  function savePending(id: string) {
    try {
      if (pending)
        sessionStorage.setItem(pendingKey(id), JSON.stringify(pending));
      else sessionStorage.removeItem(pendingKey(id));
    } catch {
      /* Restricted storage must not prevent a move. */
    }
  }
  function restorePending(id: string) {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(pendingKey(id)) ?? "null",
      );
      pending =
        saved &&
        ["action", "ready", "leave"].includes(saved.op) &&
        typeof saved.body?.commandId === "string" &&
        Number.isInteger(saved.body?.version)
          ? saved
          : null;
    } catch {
      pending = null;
    }
  }
  function accept(next: RoomView) {
    if (!room || next.id !== room.id || next.version >= room.version)
      room = next;
    connected = true;
    unavailable = false;
    failures = 0;
    notify();
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    if (
      !active ||
      document.hidden ||
      !room ||
      room.status === "closed" ||
      room.status === "finished"
    )
      return;
    timer = setTimeout(
      () => void refresh(),
      Math.min(
        20000,
        failures
          ? 2000 * 2 ** failures
          : room.status === "waiting"
            ? 1500
            : room.state.turn === room.seat
              ? 2500
              : 1200,
      ) +
        Math.random() * 250,
    );
  }
  async function refresh(preserveError = false) {
    if (inFlight || !room || !active) return;
    schedule();
    if (document.hidden) return;
    inFlight = true;
    const id = room.id,
      g = generation;
    try {
      const next = roomResponse(
        await api<unknown>(`/api/rooms/${id}/state`),
        id,
      );
      if (g !== generation) return;
      if (!pending && !preserveError) error = "";
      accept(next);
    } catch (e) {
      if (g !== generation) return;
      connected = false;
      failures++;
      error = (e as Error).message;
      if (
        e instanceof NetworkError &&
        ["ROOM_EXPIRED", "NO_SEAT"].includes(e.code)
      ) {
        active = false;
        unavailable = true;
      }
      notify();
    } finally {
      if (g === generation) {
        inFlight = false;
        schedule();
      }
    }
  }
  async function run(op: string, b: unknown, retry = false) {
    if (!room || !active || busy || (pending && !retry)) return false;
    const g = generation,
      id = room.id;
    busy = true;
    pending = { op, body: b };
    error = "";
    try {
      notify();
      if (g !== generation) return false;
      // Persist only when dispatch is imminent. A notification may cancel a
      // new command; an older uncertain retry receipt is already retained.
      savePending(id);
      const next = roomResponse(
        await api<unknown>(`/api/rooms/${id}/${op}`, b),
        id,
      );
      if (g !== generation) return false;
      pending = null;
      savePending(id);
      accept(next);
      return true;
    } catch (e) {
      if (g !== generation) return false;
      error =
        op === "ready" &&
        e instanceof NetworkError &&
        e.code === "STALE_VERSION"
          ? "相手の準備状況が更新されました。まだ準備完了でない場合は、もう一度「準備完了」を押してください。"
          : (e as Error).message;
      if (
        e instanceof NetworkError &&
        e.code !== "NETWORK" &&
        e.code !== "SERVICE_UNAVAILABLE"
      ) {
        pending = null;
        savePending(id);
      }
      connected = false;
      await refresh(true);
      return false;
    } finally {
      if (g === generation) {
        busy = false;
        schedule();
        notify();
      }
    }
  }
  const visibility = () => {
    if (document.hidden) {
      if (timer) clearTimeout(timer);
    } else void refresh();
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    get room() {
      return room;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    get connected() {
      return connected;
    },
    get unavailable() {
      return unavailable;
    },
    get pending() {
      return !!pending;
    },
    async create() {
      const g = beginSession();
      busy = true;
      error = "";
      try {
        notify();
        if (g !== generation) throw new NetworkError("CANCELLED");
        await api("/api/session");
        if (g !== generation) throw new NetworkError("CANCELLED");
        const key = creationKey();
        const next = roomResponse(
          await api<unknown>("/api/rooms", { commandId: key }),
        );
        if (g !== generation) throw new NetworkError("CANCELLED");
        clearCreationKey();
        requestedId = next.id;
        restorePending(next.id);
        active = true;
        accept(next);
        schedule();
        return next;
      } catch (e) {
        if (g === generation) {
          error = (e as Error).message;
          // An expired receipt conclusively cannot create or recover a room.
          // Keep the key for uncertain responses so retries never duplicate it.
          if (e instanceof NetworkError && e.code === "ROOM_EXPIRED")
            clearCreationKey();
        }
        throw e;
      } finally {
        if (g === generation) {
          busy = false;
          notify();
        }
      }
    },
    async join(id: string, invite: string) {
      const g = beginSession();
      busy = true;
      error = "";
      try {
        notify();
        if (g !== generation) throw new NetworkError("CANCELLED");
        await api("/api/session");
        if (g !== generation) throw new NetworkError("CANCELLED");
        const next = roomResponse(
          await api<unknown>(`/api/rooms/${id}/join`, { invite }),
          id,
        );
        if (g !== generation) throw new NetworkError("CANCELLED");
        requestedId = next.id;
        restorePending(next.id);
        active = true;
        accept(next);
        schedule();
        return next;
      } catch (e) {
        if (g === generation) error = (e as Error).message;
        throw e;
      } finally {
        if (g === generation) {
          busy = false;
          notify();
        }
      }
    },
    async resume(id: string) {
      const g = beginSession();
      requestedId = id;
      busy = true;
      connected = false;
      error = "";
      restorePending(id);
      try {
        notify();
        if (g !== generation) return;
        await api("/api/session");
        if (g !== generation) return;
        const next = roomResponse(
          await api<unknown>(`/api/rooms/${id}/state`),
          id,
        );
        if (g !== generation) return;
        active = true;
        accept(next);
        schedule();
      } catch (e) {
        if (g !== generation) return;
        if (
          e instanceof NetworkError &&
          ["ROOM_EXPIRED", "NO_SEAT"].includes(e.code)
        )
          unavailable = true;
        error = (e as Error).message;
        notify();
      } finally {
        if (g === generation) {
          busy = false;
          notify();
        }
      }
    },
    ready() {
      return room
        ? run("ready", { commandId: commandId(), version: room.version })
        : Promise.resolve();
    },
    submit(a: Action) {
      return room
        ? run("action", {
            commandId: commandId(),
            version: room.version,
            action: a,
          })
        : Promise.resolve();
    },
    leave() {
      return room
        ? run("leave", { commandId: commandId(), version: room.version })
        : Promise.resolve();
    },
    retry() {
      return requestedId && (!room || !active || room.id !== requestedId)
        ? this.resume(requestedId)
        : pending
          ? run(pending.op, pending.body, true)
          : refresh();
    },
    stop() {
      busy = false;
      inFlight = false;
      active = false;
      generation++;
      if (timer) clearTimeout(timer);
      pending = null;
      room = null;
      requestedId = null;
      unavailable = false;
      error = "";
      notify();
    },
    dispose() {
      active = false;
      generation++;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
