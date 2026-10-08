import { it, expect } from "vitest";
import { createGame, applyAction } from "../src/game/engine";
import {
  motionPlan,
  recoverTransition,
  trackPose,
  visibleCoreSides,
} from "../src/render/motion";
import type { Action, GameState, Piece } from "../src/game/types";
const piece = (
  id: string,
  kind: Piece["kind"],
  square: number,
  remaining: number,
  side: Piece["side"] = "white",
): Piece => ({ id, kind, square, remaining, side, summonedPly: -1 });
const commit = (s: GameState, a: Action) => {
  const r = applyAction(s, a);
  if (!r.ok) throw Error(r.error);
  return r;
};
it("capture finishes before last-life expiry and every phase settles within600ms", () => {
  const s = createGame();
  s.pieces = [piece("m", "carver", 9, 1), piece("v", "carver", 18, 3, "black")];
  const r = commit(s, { type: "move", pieceId: "m", to: 18 });
  const p = motionPlan(r.state, { before: s, events: r.events });
  const mover = p.tracks.find((t) => t.piece.id === "m")!,
    victim = p.tracks.find((t) => t.piece.id === "v")!;
  expect(mover.start).toBeGreaterThanOrEqual(victim.end);
  expect(trackPose(mover, mover.arrive).x).toBe(4);
  expect(trackPose(mover, mover.arrive).y).toBe(2);
  expect(p.duration).toBeLessThanOrEqual(600);
  expect(r.state.grain.white).toBe(25);
});
it.each([
  [1, 3],
  [3, 1],
  [1, 1],
])("swaps (life %i/%i) expire at the exchanged squares", (a, b) => {
  const s = createGame();
  s.pieces = [piece("link", "link", 23, a), piece("wall", "bastion", 24, b)];
  const r = commit(s, { type: "swap", pieceId: "link", allyId: "wall" });
  const p = motionPlan(r.state, { before: s, events: r.events });
  for (const t of p.tracks)
    expect(t.path.at(-1)).toBe(t.piece.id === "link" ? 24 : 23);
  expect(
    p.cues.filter((c) => c.kind === "expire").map((c) => c.square),
  ).toEqual([...(a === 1 ? [24] : []), ...(b === 1 ? [23] : [])]);
});
it("Carver uses a legal pre-expiry bend rather than crossing the departing wall", () => {
  const s = createGame();
  s.pieces = [piece("m", "carver", 23, 2), piece("wall", "bastion", 24, 1)];
  const r = commit(s, { type: "move", pieceId: "m", to: 31 });
  expect(
    motionPlan(r.state, { before: s, events: r.events }).tracks.find(
      (t) => t.piece.id === "m",
    )!.path,
  ).toEqual([23, 30, 31]);
});
it("Leaper lifts over its stationary pad and only captures at the landing square", () => {
  const s = createGame();
  s.pieces = [
    piece("m", "leaper", 23, 1),
    piece("pad", "bastion", 24, 1),
    piece("v", "carver", 25, 3, "black"),
  ];
  const r = commit(s, { type: "move", pieceId: "m", to: 25 }),
    p = motionPlan(r.state, { before: s, events: r.events });
  const mover = p.tracks.find((t) => t.piece.id === "m")!,
    pad = p.tracks.find((t) => t.piece.id === "pad")!;
  expect(trackPose(mover, 140).lift).toBeGreaterThan(0.6);
  expect(pad.path).toEqual([24]);
  expect(
    p.cues.filter((c) => c.kind === "capture").map((c) => [c.square, c.label]),
  ).toEqual([[25, "+9糧"]]);
});
it("core victory retains last-life units at ply200 and removes only the losing core", () => {
  const s = createGame();
  s.ply = 199;
  s.consecutivePasses = 5;
  s.pieces = [piece("m", "carver", 36, 1), piece("wall", "bastion", 10, 1)];
  const r = commit(s, { type: "move", pieceId: "m", to: 45 }),
    p = motionPlan(r.state, { before: s, events: r.events });
  expect(visibleCoreSides(r.state)).toEqual(["white"]);
  expect(p.cues.map((c) => c.kind)).toEqual(["win"]);
  expect(r.state.pieces).toHaveLength(2);
  expect(r.events.some((e) => e.type === "expire")).toBe(false);
});
it("online ambiguity and missed turns never invent an expiring mover's destination", () => {
  const s = createGame();
  s.pieces = [piece("m", "carver", 23, 1)];
  const r = commit(s, { type: "move", pieceId: "m", to: 31 });
  expect(recoverTransition(s, r.state)).toBeNull();
  expect(recoverTransition(s, { ...r.state, ply: 2 })).toBeNull();
  expect(recoverTransition(s, s)).toBeNull();
});
it("online unique swap with one expiry retains both motion identities", () => {
  const s = createGame();
  s.pieces = [piece("m", "link", 23, 1), piece("wall", "bastion", 24, 3)];
  const r = commit(s, { type: "swap", pieceId: "m", allyId: "wall" });
  expect(
    recoverTransition(s, r.state)?.events.find((e) => e.type === "swap")
      ?.pieceIds,
  ).toEqual(["m", "wall"]);
});
it("sampled complete matches produce finite bounded visual plans without mutating either state", async () => {
  const { legalActions } = await import("../src/game/rules");
  let seed = 71,
    transitions = 0;
  const random = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  for (let game = 0; game < 6; game++) {
    let s = createGame();
    for (let turn = 0; turn < 200 && !s.outcome; turn++) {
      const all = legalActions(s),
        tactical = all.filter((a) => a.type === "move" || a.type === "swap");
      const choices = tactical.length && turn % 3 ? tactical : all;
      const r = commit(s, choices[random(choices.length)]);
      const before = JSON.stringify(s),
        after = JSON.stringify(r.state);
      const p = motionPlan(r.state, { before: s, events: r.events });
      expect(p.duration).toBeLessThanOrEqual(600);
      for (const t of p.tracks) {
        for (const ms of [0, 140, 280, 380, 540, 600]) {
          const pose = trackPose(t, ms);
          expect(Object.values(pose).every(Number.isFinite)).toBe(true);
          expect(pose.opacity).toBeGreaterThanOrEqual(0);
          expect(pose.opacity).toBeLessThanOrEqual(1);
          expect(pose.x).toBeGreaterThanOrEqual(0);
          expect(pose.x).toBeLessThanOrEqual(6);
          expect(pose.y).toBeGreaterThanOrEqual(0);
          expect(pose.y).toBeLessThanOrEqual(6);
        }
        const final = r.state.pieces.find((q) => q.id === t.piece.id);
        if (final) expect(t.path.at(-1)).toBe(final.square);
        else expect(trackPose(t, 600).opacity).toBe(0);
      }
      expect(JSON.stringify(s)).toBe(before);
      expect(JSON.stringify(r.state)).toBe(after);
      transitions++;
      s = r.state;
    }
  }
  expect(transitions).toBeGreaterThan(500);
});
