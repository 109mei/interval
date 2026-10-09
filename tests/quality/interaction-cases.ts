import type { Kind, Side } from "../../src/game/types";
import type { QualityCase } from "./case-ledger";

/** Synthetic tasks, not human research. DOM/network/generated evidence stays separate. */
export const kindPrices: Record<Kind, number> = {
  bastion: 1,
  carver: 3,
  leaper: 2,
  link: 1,
};
export const kindNames: Record<Kind, string> = {
  bastion: "バスティオン",
  carver: "カーヴァー",
  leaper: "リーパー",
  link: "リンク",
};
const kinds = Object.keys(kindPrices) as Kind[];
const sides: Side[] = ["white", "black"];
export type InteractionInput = {
  family: string;
  evidence: "real-main DOM" | "generated controller" | "mocked network client";
  persona: "Nao" | "Ren" | "Mika" | "Sora";
  kind?: Kind;
  duration?: number;
  side?: Side;
  flow?: string;
  invalid?: string;
  quality?: boolean;
  motion?: boolean;
  context?: string;
  from?: number;
  keys?: string[];
  to?: number;
  op?: "action" | "ready" | "leave";
  code?: string;
  loss?: string;
  recovery?: string;
  joined?: boolean;
  ownReady?: boolean;
  otherReady?: boolean;
  workerResult?: string;
};
export type InteractionCase = QualityCase & { inputs: InteractionInput };
export const interactionCases: InteractionCase[] = [];
function add(
  id: string,
  category: string,
  inputs: InteractionInput,
  assertions: string[],
) {
  interactionCases.push({ id, category, inputs, assertions });
}
for (const side of sides)
  for (const kind of kinds)
    for (let duration = 1; duration <= 5; duration++) {
      for (const flow of [
        "commit",
        "rules-interruption",
        "back-retarget",
        "change-kind",
        "cancel-reenter",
      ]) {
        add(
          `QI-SUM-${side}-${kind}-${duration}-${flow}`,
          "DOM purchase decisions",
          {
            family: "summon",
            evidence: "real-main DOM",
            persona: flow === "commit" ? "Nao" : "Mika",
            side,
            kind,
            duration,
            flow,
          },
          [
            "A candidate on the third home rank names exact type, square, cost and lifetime in turns without spending",
            flow === "commit"
              ? "A repeated hidden confirmation cannot submit the purchase twice"
              : flow === "rules-interruption"
                ? "Opening and closing rules preserves the exact uncommitted proposal"
                : flow === "back-retarget"
                  ? "Choosing again removes the old ghost and preserves duration while changing destination"
                  : flow === "change-kind"
                    ? "Changing kind preserves duration and reprices the final purchase"
                    : "Cancel removes confirmation and ghost without spending; reentry can choose another square",
            "Exactly the final purchase is charged once, newborn keeps selected lifetime, and turn advances once",
          ],
        );
      }
      for (const invalid of ["own-core", "occupied-wall", "outside-home"]) {
        add(
          `QI-INV-${side}-${kind}-${duration}-${invalid}`,
          "DOM invalid target recovery",
          {
            family: "invalid",
            evidence: "real-main DOM",
            persona: "Mika",
            side,
            kind,
            duration,
            invalid,
          },
          [
            invalid === "occupied-wall"
              ? "An occupied target contains a wall created by a real purchase before rejection is tested"
              : invalid === "outside-home"
                ? "The neutral central rank remains illegal beside the three legal home ranks"
                : "The player's core square remains unavailable for summoning",
            "Invalid retap removes old confirmation and ghost without spending",
            "Chosen kind and duration survive the rejected target",
            "One new legal destination recovers a purchasable candidate with the exact cost",
          ],
        );
      }
      add(
        `QI-INS-${side}-${kind}-${duration}`,
        "DOM opposing-piece inspection",
        {
          family: "inspection",
          evidence: "real-main DOM",
          persona: "Ren",
          side,
          kind,
          duration,
        },
        [
          "Opposing-piece inspection names owner, role and unaged lifetime",
          "Opponent geometry is reference-only and cannot expose executable targets or confirmation",
          duration === 1
            ? "On returning to the owner's turn the piece still has one life and explicitly expires this turn"
            : "Returning to the owner's turn preserves lifetime and removes the reference-only warning",
        ],
      );
      for (const flow of ["duplicate", "stale-revision", "restart-session"]) {
        add(
          `QI-CTL-${side}-${kind}-${duration}-${flow}`,
          "Generated controller transaction boundaries",
          {
            family: "controller",
            evidence: "generated controller",
            persona: "Mika",
            side,
            kind,
            duration,
            flow,
          },
          [
            flow === "duplicate"
              ? "Two simultaneous uses of one token produce exactly one successful purchase"
              : flow === "stale-revision"
                ? "A spent revision rejects a later pass and preserves the exact committed state object"
                : "A previous session token cannot mutate the reset board",
            flow === "restart-session"
              ? "Fresh session tokens remain usable and the new purchase is charged from reset funds"
              : "Only one piece is created, its lifetime is unchanged, cost is exact, and only one turn advances",
            "The controller is no longer busy after an accepted transaction settles",
          ],
        );
      }
    }
for (const quality of [false, true])
  for (const motion of [false, true])
    for (const context of ["idle", "kind", "candidate", "piece-info", "pass"]) {
      add(
        `QI-DIS-${Number(quality)}${Number(motion)}-${context}`,
        "DOM preferences preserve decisions",
        {
          family: "display",
          evidence: "real-main DOM",
          persona: "Mika",
          quality,
          motion,
          context,
        },
        [
          "Changing independent display controls preserves current action and board resources",
          "Stored flags and pressed states match actual display classes",
          "Rules dialog can close without changing the selection or pending purchase",
        ],
      );
    }
const routes: [string, number, string[], number][] = [
  ["lower-left-no-wrap", 0, ["ArrowLeft", "ArrowDown"], 0],
  ["lower-right-no-wrap", 6, ["ArrowRight", "ArrowDown"], 6],
  ["upper-left-no-wrap", 42, ["ArrowLeft", "ArrowUp"], 42],
  ["upper-right-no-wrap", 48, ["ArrowRight", "ArrowUp"], 48],
  ["bottom-row-to-core", 0, ["ArrowRight", "ArrowRight", "ArrowRight"], 3],
  ["top-row-to-core", 48, ["ArrowLeft", "ArrowLeft", "ArrowLeft"], 45],
  ["white-core-to-empty-second-rank", 3, ["ArrowUp"], 10],
  ["black-core-to-empty-second-rank", 45, ["ArrowDown"], 38],
  ["center-up", 24, ["ArrowUp"], 31],
  ["center-down", 24, ["ArrowDown"], 17],
  ["center-left", 24, ["ArrowLeft"], 23],
  ["center-right", 24, ["ArrowRight"], 25],
  ["row-boundary-right", 13, ["ArrowRight"], 13],
  ["row-boundary-left", 14, ["ArrowLeft"], 14],
  ["cross-home-front", 7, ["ArrowUp", "ArrowUp"], 21],
  ["cross-enemy-front", 41, ["ArrowDown", "ArrowDown"], 27],
  [
    "return-to-origin",
    22,
    ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"],
    22,
  ],
  ["repeated-top-clamp", 41, ["ArrowUp", "ArrowUp", "ArrowUp"], 48],
  ["repeated-bottom-clamp", 7, ["ArrowDown", "ArrowDown", "ArrowDown"], 0],
  ["unsupported-key-keeps-focus", 24, ["Home", "End", "PageUp", "a"], 24],
];
for (const [name, from, keys, to] of routes)
  add(
    `QI-KEY-${name}`,
    "DOM spatial keyboard navigation",
    {
      family: "keyboard",
      evidence: "real-main DOM",
      persona: "Nao",
      from,
      keys,
      to,
    },
    [
      "Arrow direction matches visually inverted board ranks and never wraps a row",
      "Exactly one square stays in the tab order",
      "Navigation alone never selects, buys or advances the game",
    ],
  );
const errors = {
  action: [
    "STALE_VERSION",
    "WRONG_TURN",
    "ILLEGAL_ACTION",
    "ROOM_CLOSED",
    "NOT_STARTED",
    "RATE_LIMIT",
    "SESSION_REQUIRED",
    "ROOM_EXPIRED",
    "NO_SEAT",
  ],
  ready: [
    "STALE_VERSION",
    "ALREADY_STARTED",
    "ROOM_CLOSED",
    "RATE_LIMIT",
    "SESSION_REQUIRED",
    "ROOM_EXPIRED",
    "NO_SEAT",
    "COMMAND_CONFLICT",
  ],
  leave: [
    "STALE_VERSION",
    "ROOM_CLOSED",
    "RATE_LIMIT",
    "SESSION_REQUIRED",
    "ROOM_EXPIRED",
    "NO_SEAT",
    "COMMAND_CONFLICT",
  ],
} as const;
for (const op of ["action", "ready", "leave"] as const)
  for (const side of sides) {
    for (const code of errors[op])
      add(
        `QI-NET-${op}-${side}-${code}`,
        "Mocked network definitive rejection",
        {
          family: "rejection",
          evidence: "mocked network client",
          persona: "Sora",
          op,
          side,
          code,
        },
        [
          "A definitive rejection clears its receipt without claiming a committed operation",
          ["ROOM_EXPIRED", "NO_SEAT", "SESSION_REQUIRED"].includes(code)
            ? "Failed recovery preserves the last trusted room version and exposes disconnected or unavailable status"
            : "Latest room version, status and turn survive authoritative recovery without another mutation",
          code === "STALE_VERSION" && op === "ready"
            ? "Readiness conflicts name preparation rather than the game board"
            : code === "STALE_VERSION" && op === "action"
              ? "Move conflicts ask the player to reconsider the updated board"
              : "The rejection remains visible and its receipt is removed from storage",
        ],
      );
    for (const loss of ["connection", "malformed-json", "service-unavailable"])
      for (const recovery of ["same-page", "reload"])
        add(
          `QI-REC-${op}-${side}-${loss}-${recovery}`,
          "Mocked network uncertain receipt recovery",
          {
            family: "receipt",
            evidence: "mocked network client",
            persona: "Sora",
            op,
            side,
            loss,
            recovery,
          },
          [
            "An uncertain result retains the exact command id, original version and payload",
            "Conflicting action, Ready and leave requests cannot replace an unresolved receipt",
            "Recovery replays the same receipt once and clears it only after a definitive success",
          ],
        );
  }
for (const side of sides)
  for (const joined of [false, true])
    for (const ownReady of [false, true])
      for (const otherReady of [false, true]) {
        if (side === "black" && !joined) continue;
        if (!joined && otherReady) continue;
        if (ownReady && otherReady) continue;
        add(
          `QI-LOB-${side}-${Number(joined)}${Number(ownReady)}${Number(otherReady)}`,
          "DOM mocked-room readiness and role",
          {
            family: "lobby",
            evidence: "real-main DOM",
            persona: "Sora",
            side,
            joined,
            ownReady,
            otherReady,
          },
          [
            "Host and guest identity and readiness are explicitly named",
            "Already-ready players cannot send readiness twice",
            "Guest never receives host-only invite copying and waiting games cannot be played",
          ],
        );
      }
for (const workerResult of [
  "null",
  "undefined",
  "unknown-type",
  "illegal-move",
  "invalid-summon",
  "empty-object",
  "error",
  "timeout",
  "double-valid",
  "stale-after-reset",
])
  add(
    `QI-CPU-${workerResult}`,
    "Generated CPU response safety",
    {
      family: "cpu",
      evidence: "generated controller",
      persona: "Nao",
      workerResult,
    },
    [
      workerResult === "stale-after-reset"
        ? "A late previous-match worker reply cannot mutate the reset board or make it busy"
        : workerResult === "double-valid"
          ? "Two valid worker callbacks produce exactly one reply and return control to White"
          : "Missing, malformed, illegal, failed or timed-out worker output settles one legal CPU reply",
      workerResult === "stale-after-reset"
        ? "The cancelled search timeout cannot later advance the new match"
        : "The worker is terminated and its timeout cannot produce a second move after settlement",
    ],
  );
add(
  "QI-A11Y-selected-kind",
  "DOM selected control semantics",
  { family: "a11y", evidence: "real-main DOM", persona: "Nao" },
  [
    "Selected kind is programmatically exposed rather than represented only by CSS",
    "Reselection updates old and new pressed states consistently",
  ],
);
