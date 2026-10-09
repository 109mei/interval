// @vitest-environment jsdom
import { it } from "vitest";
import assert from "node:assert/strict";
import { createGame, applyAction, previewAction } from "../src/game/engine";
import { boardTargets } from "../src/render/board-targets";
import {
  coreAttackers,
  expiryExplanation,
  outcomeNotice,
} from "../src/ui/feedback";
import { INFO } from "../src/ui/piece-info";
import { createBoard2D } from "../src/render/board2d";
import type { Piece, Kind, Side, GameState, Action } from "../src/game/types";
import { readFileSync } from "node:fs";
it("Ren verifies capture, expiry, support, inspection and terminal precedence", () => {
  const p = (
    id: string,
    kind: Kind,
    square: number,
    side: Side,
    remaining: number,
  ) => ({
    id,
    kind,
    square,
    side,
    remaining,
    summonedPly: -1,
  });
  const base = (pieces: Piece[], extra: Partial<GameState> = {}) => ({
    ...createGame(),
    ply: 20,
    grain: { white: 20, black: 20 },
    pieces,
    ...extra,
  });
  const next = (s: GameState, a: Action) => {
    const r = applyAction(s, a);
    assert.equal(r.ok, true);
    return r.state;
  };
  document.body.innerHTML = '<div id="board"></div>';
  const host = document.getElementById("board")!;
  const board = createBoard2D(host, () => {});
  const reports = [];
  {
    const s = base([
      p("leaper", "leaper", 23, "white", 1),
      p("pad", "bastion", 24, "white", 1),
      p("victim", "carver", 25, "black", 3),
    ]);
    const a: Action = { type: "move", pieceId: "leaper", to: 25 };
    const before = JSON.stringify(s);
    const pv = previewAction(s, a)!;
    assert.equal(pv.reward, 9);
    assert.equal(pv.grainAfter, 29);
    assert.deepEqual(pv.expires, ["leaper", "pad"]);
    assert.equal(JSON.stringify(s), before);
    const after = next(s, a);
    assert.equal(after.pieces.length, 0);
    assert.equal(after.grain.white, 29);
    assert.equal(after.grain.black, 24);
    board.render(s, { pieceId: "leaper", candidate: a }, pv);
    assert.equal(host.querySelectorAll(".expiring").length, 2);
    reports.push(
      "Capture: last-life Leaper c4 jumps expiring friendly d4 pad to enemy Carver e4(3); preview +9 grain and both own expiries; commit yields29 grain and no pieces.",
    );
  }
  {
    const s = base(
      [
        p("winner", "carver", 36, "white", 1),
        p("wall", "bastion", 10, "white", 1),
      ],
      { ply: 199, consecutivePasses: 5 },
    );
    const a: Action = { type: "move", pieceId: "winner", to: 45 };
    const pv = previewAction(s, a)!;
    const after = next(s, a);
    assert.deepEqual(after.outcome, { kind: "win", winner: "white" });
    assert.equal(after.ply, 200);
    assert.equal(pv.expires.length, 0);
    assert.equal(after.pieces.find((x) => x.id === "winner")!.remaining, 1);
    assert.equal(after.pieces.find((x) => x.id === "wall")!.remaining, 1);
    assert.ok(outcomeNotice(after.outcome).includes("勝利"));
    assert.ok(!outcomeNotice(after.outcome).includes("引き分け"));
    reports.push(
      "Core precedence: life1 Carver b6→d7 on ply199 (also five prior passes) previews/commits white win before expiry and draw; unrelated life1 wall also remains.",
    );
  }
  {
    const s = base([
      p("enemy", "carver", 24, "black", 3),
      p("x", "bastion", 25, "white", 3),
      p("y", "bastion", 31, "white", 3),
    ]);
    const selection = { pieceId: "enemy", candidate: null };
    let target = boardTargets(s, selection);
    assert.equal(target.inspectOnly, true);
    assert.equal(target.targets.has(32), false);
    const opened = { ...s, pieces: s.pieces.filter((x) => x.id !== "x") };
    target = boardTargets(opened, selection);
    assert.equal(target.targets.has(32), true);
    board.render(opened, selection, null);
    assert.equal(
      host
        .querySelector('[data-square="32"]')!
        .classList.contains("inspect-target"),
      true,
    );
    assert.equal(host.querySelectorAll(".target").length, 0);
    assert.ok(
      host
        .querySelector('[data-square="32"]')!
        .getAttribute("aria-label")!
        .includes("参考"),
    );
    assert.equal(
      applyAction(opened, { type: "move", pieceId: "enemy", to: 32 }).ok,
      false,
    );
    reports.push(
      "Carver inspection: d4→e5 absent with e4+d5 blockers; removing e4 exposes only display-only destination. Enemy move remains rejected.",
    );
  }
  {
    const s = base([
      p("enemy", "leaper", 17, "black", 1),
      p("pad", "bastion", 10, "white", 1),
    ]);
    assert.equal(coreAttackers(s, "white").length, 1);
    assert.equal(
      boardTargets(s, { pieceId: "enemy", candidate: null }).targets.has(3),
      true,
    );
    const after = next(s, { type: "pass" });
    assert.equal(
      after.pieces.some((x) => x.id === "pad"),
      false,
    );
    assert.equal(coreAttackers(after, "white").length, 0);
    assert.equal(
      boardTargets(after, { pieceId: "enemy", candidate: null }).targets.has(3),
      false,
    );
    assert.ok(expiryExplanation(s, s.pieces[0]).startsWith("次の黒"));
    assert.ok(expiryExplanation(s, s.pieces[1]).startsWith("この白"));
    reports.push(
      "Expiry defense: enemy Leaper d3 currently threatens core through own d2 wall(1); white pass removes pad and both inspection/core threat disappear on black turn.",
    );
  }
  {
    let s = createGame();
    s = next(s, { type: "summon", kind: "link", duration: 3, to: 8 });
    s = next(s, { type: "pass" });
    s = next(s, { type: "summon", kind: "leaper", duration: 2, to: 9 });
    s = next(s, { type: "pass" });
    const link = s.pieces.find((x) => x.kind === "link")!,
      leaper = s.pieces.find((x) => x.kind === "leaper")!;
    const swap: Action = { type: "swap", pieceId: link.id, allyId: leaper.id };
    const pv = previewAction(s, swap)!;
    assert.deepEqual(pv.expires, []);
    s = next(s, swap);
    assert.equal(s.pieces.find((x) => x.id === leaper.id)!.remaining, 1);
    assert.equal(s.pieces.find((x) => x.id === link.id)!.remaining, 1);
    s = next(s, { type: "pass" });
    assert.equal(
      boardTargets(s, { pieceId: leaper.id, candidate: null }).targets.has(10),
      true,
    );
    assert.ok(previewAction(s, { type: "move", pieceId: leaper.id, to: 10 }));
    assert.ok(INFO.link.description.includes("自軍全駒の期間が1減る"));
    reports.push(
      "Support timing: opening Link b2(3), Leaper c2(2), exchange, black passes gives life1 Leaper b2→d2 over life1 Link c2; paying2 extra grain preserves the planned jump.",
    );
  }
  board.dispose();
  for (const report of reports) console.log("PASS " + report);
  const style = document.createElement("style");
  style.textContent = readFileSync("src/ui/styles.css", "utf8");
  document.head.append(style);
  const keys = document.createElement("div");
  keys.className = "three-keys";
  const keyButton = document.createElement("button");
  keyButton.className = "inspect-target";
  keys.append(keyButton);
  document.body.append(keys);
  assert.equal(window.getComputedStyle(keyButton).opacity, "1");
  assert.equal(window.getComputedStyle(keyButton).pointerEvents, "none");
  console.log(
    "PASS CSS-only: nonfocused 3D inspect-target computed opacity1 and pointer-events:none. The source visibility correction is verified; no WebGL/GPU rendering was exercised.",
  );
});
