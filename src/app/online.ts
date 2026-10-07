import type { GameState, Side, Action } from "../game/types";
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
  ROOM_LIMIT: "部屋は24時間に5つまでです。既存の部屋で遊んでください。",
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
  if (!res.ok) throw new NetworkError(data.error ?? "SERVICE_UNAVAILABLE");
  return data as T;
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
  function accept(next: RoomView) {
    if (!room || next.id !== room.id || next.version >= room.version)
      room = next;
    connected = true;
    unavailable = false;
    failures = 0;
    onChange();
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
      const next = await api<RoomView>(`/api/rooms/${id}/state`);
      if (g !== generation) return;
      accept(next);
      if (!pending && !preserveError) error = "";
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
      onChange();
    } finally {
      if (g === generation) {
        inFlight = false;
        schedule();
      }
    }
  }
  async function run(op: string, b: unknown) {
    if (!room || busy) return false;
    const g = generation,
      id = room.id;
    busy = true;
    pending = { op, body: b };
    error = "";
    onChange();
    try {
      const next = await api<RoomView>(`/api/rooms/${id}/${op}`, b);
      if (g !== generation) return false;
      pending = null;
      accept(next);
      return true;
    } catch (e) {
      if (g !== generation) return false;
      error = (e as Error).message;
      if (
        e instanceof NetworkError &&
        e.code !== "NETWORK" &&
        e.code !== "SERVICE_UNAVAILABLE"
      )
        pending = null;
      await refresh(true);
      return false;
    } finally {
      if (g === generation) {
        busy = false;
        onChange();
        schedule();
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
      busy = true;
      error = "";
      onChange();
      try {
        await api("/api/session");
        const key = sessionStorage.getItem("interval-create") ?? commandId();
        sessionStorage.setItem("interval-create", key);
        const next = await api<RoomView>("/api/rooms", { commandId: key });
        sessionStorage.removeItem("interval-create");
        active = true;
        accept(next);
        schedule();
        return next;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        busy = false;
        onChange();
      }
    },
    async join(id: string, invite: string) {
      busy = true;
      error = "";
      onChange();
      try {
        await api("/api/session");
        const next = await api<RoomView>(`/api/rooms/${id}/join`, { invite });
        active = true;
        accept(next);
        schedule();
        return next;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        busy = false;
        onChange();
      }
    },
    async resume(id: string) {
      const g = ++generation;
      requestedId = id;
      busy = true;
      error = "";
      onChange();
      try {
        await api("/api/session");
        const next = await api<RoomView>(`/api/rooms/${id}/state`);
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
        onChange();
      } finally {
        if (g === generation) {
          busy = false;
          onChange();
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
      return pending
        ? run(pending.op, pending.body)
        : !room && requestedId
          ? this.resume(requestedId)
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
      onChange();
    },
    dispose() {
      active = false;
      generation++;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
