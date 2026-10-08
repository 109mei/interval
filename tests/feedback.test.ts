import { it, expect } from "vitest";
import { createGame, applyAction } from "../src/game/engine";
import { actionLabel, coreAttackers, transitionText } from "../src/ui/feedback";
it("summon and pass descriptions identify what will actually be committed", () => {
  expect(
    actionLabel(createGame(), {
      type: "summon",
      kind: "carver",
      duration: 3,
      to: 9,
    }),
  ).toBe("c2にカーヴァーを召喚");
  expect(actionLabel(createGame(), { type: "pass" })).toContain("パス");
});
it("attack cues use current legal paths, including core capture before expiry", () => {
  const s = createGame();
  s.pieces = [
    {
      id: "x",
      kind: "carver",
      side: "black",
      square: 12,
      remaining: 1,
      summonedPly: -1,
    },
  ];
  expect(coreAttackers(s, "white").map((p) => p.id)).toEqual(["x"]);
});
it("authoritative online board differences produce a last move without storing private chat", () => {
  const s = createGame();
  const r = applyAction(s, {
    type: "summon",
    kind: "carver",
    duration: 3,
    to: 9,
  });
  if (!r.ok) throw Error();
  expect(transitionText(s, r.state)).toContain("白 · c2にカーヴァーを召喚");
  expect(transitionText(r.state, r.state)).toBe("");
});
it("a last-life move that expires is not mislabeled as a pass", () => {
  const s = createGame();
  s.pieces = [
    {
      id: "last",
      kind: "carver",
      side: "white",
      square: 9,
      remaining: 1,
      summonedPly: -1,
    },
  ];
  const r = applyAction(s, { type: "move", pieceId: "last", to: 18 });
  if (!r.ok) throw Error();
  expect(transitionText(s, r.state)).not.toContain("パス");
  expect(transitionText(s, r.state)).toContain("退場");
});
it("a one-life Link exchange remains an exchange when only its ally survives", () => {
  const s = createGame();
  s.pieces = [
    {
      id: "link",
      kind: "link",
      side: "white",
      square: 9,
      remaining: 1,
      summonedPly: -1,
    },
    {
      id: "ally",
      kind: "carver",
      side: "white",
      square: 10,
      remaining: 3,
      summonedPly: -1,
    },
  ];
  const r = applyAction(s, { type: "swap", pieceId: "link", allyId: "ally" });
  if (!r.ok) throw Error();
  expect(transitionText(s, r.state)).toContain("位置交換");
});
