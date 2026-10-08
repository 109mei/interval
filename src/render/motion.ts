import type { Action, GameEvent, GameState, Piece } from "../game/types";
import { applyAction } from "../game/engine";
import { movePaths, pieceActions } from "../game/rules";
export type BoardTransition = {
  before: GameState;
  events: readonly GameEvent[];
};
export type MotionTrack = {
  piece: Piece;
  path: number[];
  enter: boolean;
  leave: "capture" | "expire" | null;
  arrive: number;
  start: number;
  end: number;
  remaining: number;
};
export type MotionCue = {
  kind: "summon" | "capture" | "expire" | "swap" | "win";
  square: number;
  label: string;
  start: number;
};
export type MotionPlan = {
  tracks: MotionTrack[];
  cues: MotionCue[];
  duration: number;
};
export const TRAVEL_MS = 280;
const signature = (s: GameState) =>
  JSON.stringify({
    ...s,
    pieces: [...s.pieces].sort((a, b) => a.id.localeCompare(b.id)),
  });
// A snapshot can erase the path of an expiring mover. Animate only a uniquely
// recoverable action, and never invent intermediate turns after reconnecting.
export function recoverTransition(
  before: GameState,
  after: GameState,
): BoardTransition | null {
  if (before.outcome || after.ply !== before.ply + 1) return null;
  const added = after.pieces.find(
    (p) => !before.pieces.some((q) => q.id === p.id),
  );
  const actions: Action[] = added
    ? [
        {
          type: "summon",
          kind: added.kind,
          duration: added.remaining,
          to: added.square,
        },
      ]
    : [
        { type: "pass" },
        ...before.pieces.flatMap((p) => pieceActions(before, p)),
      ];
  const matching: (readonly GameEvent[])[] = [];
  const target = signature(after);
  for (const action of actions) {
    const result = applyAction(before, action);
    if (result.ok && signature(result.state) === target)
      matching.push(result.events);
  }
  return matching.length === 1 ? { before, events: matching[0] } : null;
}
export function motionPlan(
  after: GameState,
  transition: BoardTransition,
): MotionPlan {
  const { before, events } = transition;
  const tracks = new Map<string, MotionTrack>();
  const cues: MotionCue[] = [];
  const track = (id: string) => {
    let item = tracks.get(id);
    if (!item) {
      const piece =
        before.pieces.find((p) => p.id === id) ??
        after.pieces.find((p) => p.id === id);
      if (!piece) return;
      item = {
        piece,
        path: [piece.square],
        enter: false,
        leave: null,
        arrive: 0,
        start: 0,
        end: 280,
        remaining: after.pieces.find((p) => p.id === id)?.remaining ?? 0,
      };
      tracks.set(id, item);
    }
    return item;
  };
  for (const event of events) {
    if (event.type === "summon") {
      const item = track(event.pieceIds[0]);
      if (item) item.enter = true;
      cues.push({
        kind: "summon",
        square: event.squares[0],
        label: "召喚",
        start: 0,
      });
    }
    if (event.type === "move" || event.type === "swap") {
      event.pieceIds.forEach((id, i) => {
        const item = track(id);
        if (!item) return;
        const from = event.squares[i],
          to = event.squares[1 - i];
        item.path =
          event.type === "move" && item.piece.kind === "carver"
            ? [from, ...(movePaths(before, item.piece).get(to)?.[0] ?? [to])]
            : [from, to];
        item.arrive = TRAVEL_MS;
      });
      if (event.type === "swap")
        for (const square of event.squares)
          cues.push({ kind: "swap", square, label: "交換", start: TRAVEL_MS });
    }
  }
  const arrival = [...tracks.values()].some((t) => t.arrive) ? TRAVEL_MS : 0;
  for (const event of events) {
    if (event.type === "capture" || event.type === "expire")
      event.pieceIds.forEach((id, i) => {
        const item = track(id);
        if (!item) return;
        item.leave = event.type as "capture" | "expire";
        item.start =
          arrival +
          (event.type === "expire" && events.some((e) => e.type === "capture")
            ? 100
            : 0);
        item.end = item.start + (event.type === "capture" ? 100 : 160);
        // Expiry squares are the committed destinations, including one-life swaps.
        if (!item.arrive) item.path = [event.squares[i]];
        cues.push({
          kind: item.leave,
          square: event.squares[i],
          label: item.leave === "capture" ? `+${event.amount}糧` : "期限切れ",
          start: item.start,
        });
      });
  }
  if (after.outcome?.kind === "win")
    cues.push({
      kind: "win",
      square: after.cores[after.outcome.winner === "white" ? "black" : "white"],
      label: "コア捕獲",
      start: arrival,
    });
  return { tracks: [...tracks.values()], cues, duration: 580 };
}
export function trackPose(track: MotionTrack, elapsed: number) {
  const t = track.arrive ? Math.min(1, Math.max(0, elapsed / track.arrive)) : 1;
  const n = Math.min(track.path.length - 1, t * (track.path.length - 1));
  const i = Math.min(track.path.length - 1, Math.floor(n)),
    j = Math.min(i + 1, track.path.length - 1),
    f = n - i;
  const a = track.path[i],
    b = track.path[j];
  const x = (a % 7) + ((b % 7) - (a % 7)) * f;
  const y = Math.floor(a / 7) + (Math.floor(b / 7) - Math.floor(a / 7)) * f;
  const leave = track.leave
    ? Math.min(
        1,
        Math.max(0, (elapsed - track.start) / (track.end - track.start)),
      )
    : 0;
  const enter = track.enter ? Math.min(1, elapsed / 260) : 1;
  return {
    x,
    y,
    lift:
      track.piece.kind === "leaper" && track.arrive
        ? Math.sin(t * Math.PI) * 0.7
        : 0,
    scale: (0.72 + enter * 0.28) * (1 - leave * 0.3),
    opacity: enter * (1 - leave),
  };
}
export function visibleCoreSides(state: GameState) {
  return (["white", "black"] as const).filter(
    (side) => !(state.outcome?.kind === "win" && state.outcome.winner !== side),
  );
}
