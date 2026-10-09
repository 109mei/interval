// @vitest-environment jsdom
/**
 * A001–A140: local automated accessibility scenarios.
 * Evidence is DOM/keyboard-handler/state behavior, not screen-reader, physical
 * keyboard, GPU, touch, rendered contrast, or native-dialog certification.
 * No production mocks: main/controller/rules and 2D renderer run as shipped;
 * network fixtures and preference/RAF/Worker boundaries remain entirely local.
 * Each named test has a corresponding auditable ledger row. Baseline observations
 * are read from the curated ledger; runtime output is written only to the system temporary directory.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createBoard2D } from "../src/render/board2d";
import { createGame, applyAction, previewAction } from "../src/game/engine";
import { INFO, PIECE_MARK } from "../src/ui/piece-info";
import type {
  Action,
  GameState,
  Kind,
  Piece,
  Selection,
  Side,
} from "../src/game/types";
import type { BoardView } from "../src/render/board-view";
import type { RoomView } from "../src/app/online";

type Case = {
  id: string;
  category: string;
  persona: string;
  sequence: string[];
  expected: string;
  baselineObservation: string;
  finding: string;
  fixOrNoChange: string;
  retest: string;
  limitations: string;
};
const ledgerPath = "docs/review500/accessibility-cases.json";
const oldCases: Case[] = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, "utf8"))
  : [];
const cases: Case[] = [];
const authoredCss = readFileSync("src/ui/styles.css", "utf8");
const limitations =
  "Local automated jsdom/DOM evidence only; no real screen reader, native Tab/Enter default behavior, phone, visual contrast, GPU, or native dialog focus validation. Network responses are local fixtures; no external requests.";
function scenario(
  category: string,
  persona: string,
  title: string,
  sequence: string[],
  expected: string,
  check: () => void | Promise<void>,
) {
  const id = `A${String(cases.length + 1).padStart(3, "0")}`;
  const previous = oldCases.find((entry) => entry.id === id);
  const row: Case = {
    id,
    category,
    persona,
    sequence,
    expected: `${title}: ${expected}`,
    baselineObservation: previous?.baselineObservation ?? "NOT RUN",
    finding: previous?.finding ?? "Not yet evaluated",
    fixOrNoChange:
      previous?.fixOrNoChange ??
      "No production change identified by this scenario.",
    retest: previous?.retest ?? "NOT RUN",
    limitations,
  };
  const extended = !!previous && previous.expected !== row.expected;
  cases.push(row);
  it(`${id}: ${title}`, async () => {
    try {
      await check();
      if (row.baselineObservation === "NOT RUN")
        row.baselineObservation =
          "PASS: all scenario assertions passed in initial local automated execution.";
      if (!row.finding || row.finding === "Not yet evaluated")
        row.finding = "No defect observed in the stated condition.";
      if (extended)
        row.baselineObservation +=
          " Extended-scenario baseline PASS: newly documented assertions passed in their first execution.";
      row.retest =
        "PASS: all scenario assertions passed in the latest focused execution.";
    } catch (error) {
      const message = (
        error instanceof Error
          ? error.message.replace(/\u001b\[[0-9;]*m/g, "")
          : String(error)
      ).slice(0, 1200);
      if (row.baselineObservation === "NOT RUN")
        row.baselineObservation = `FAIL: ${message}`;
      if (extended)
        row.baselineObservation += ` Extended-scenario baseline FAIL: ${message}`;
      row.finding = `Observed assertion failure: ${message}`;
      row.retest = `FAIL: ${message}`;
      throw error;
    }
  });
}
afterAll(() => {
  if (cases.length !== 140)
    throw new Error(
      `Expected exactly 140 scenarios, registered ${cases.length}`,
    );
  writeFileSync(
    join(tmpdir(), "interval-review500-accessibility-results.json"),
    JSON.stringify(cases, null, 2) + "\n",
  );
});

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
const click = (id: string) => el<HTMLButtonElement>(id).click();
const square = (q: number) =>
  document.querySelector<HTMLButtonElement>(`[data-square="${q}"]`)!;
const choose = (kind: Kind) =>
  document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!.click();
const key = (element: HTMLElement, value: string) => {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event;
};
const flush = async () => {
  for (let n = 0; n < 24; n++) await Promise.resolve();
};
const views: BoardView[] = [];
let listeners: [string, EventListenerOrEventListenerObject][] = [];
let clipboardDescriptor: PropertyDescriptor | undefined;
function clearListeners() {
  listeners
    .splice(0)
    .forEach(([type, listener]) =>
      document.removeEventListener(type, listener),
    );
}
beforeEach(() => {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  vi.useFakeTimers();
  document.body.innerHTML = "";
  document.body.className = "";
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/?2d");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (name, listener, options) => {
      listeners.push([name, listener]);
      add(name, listener, options);
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error(
        "Unexpected external fetch prohibited by accessibility suite",
      );
    }),
  );
});
afterEach(() => {
  // Dispose main's renderer through its supported home/view controls, then all
  // direct renderer fixtures, before removing observed DOM and event listeners.
  if (document.getElementById("home-button") && !el("arena").hidden)
    click("home-button");
  if (document.getElementById("view") && el("arena").hidden) click("view");
  views.splice(0).forEach((view) => view.dispose());
  clearListeners();
  document.head.querySelector("[data-review500-css]")?.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
  document.body.innerHTML = "";
  document.body.className = "";
  localStorage.clear();
  sessionStorage.clear();
});
async function boot(path = "/?2d") {
  clearListeners();
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", path);
  await import("../src/main");
  await flush();
}
function start(mode: "local" | "cpu" = "local") {
  click(`choose-${mode}`);
  click("start-game");
}
async function commit() {
  click("confirm");
  await flush();
}
async function pass() {
  click("pass");
  await commit();
}
function duration(n: number) {
  while (Number(el("duration").textContent) > n) click("minus");
  while (Number(el("duration").textContent) < n) click("plus");
}
async function summon(kind: Kind, to: number, life = 3) {
  click("summon");
  choose(kind);
  duration(life);
  square(to).click();
  await commit();
}
function usableFocus() {
  const active = document.activeElement as HTMLElement;
  expect(active).not.toBe(document.body);
  expect(active.isConnected).toBe(true);
  expect(active.closest("[hidden]")).toBeNull();
  expect(active.matches(":disabled")).toBe(false);
  return active;
}
// Computed author-CSS evidence only. Replace :focus-visible with an explicit
// fixture attribute so jsdom's focus-visible heuristic cannot affect this static
// contrast check. Media-query layout/real rendered focus appearance is not claimed.
function css() {
  if (document.head.querySelector("[data-review500-css]")) return;
  const style = document.createElement("style");
  style.dataset.review500Css = "";
  style.textContent = authoredCss.replaceAll(
    ":focus-visible",
    '[data-review500-focus-visible="true"]',
  );
  document.head.append(style);
}
function luminance(color: string) {
  const values = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!values || values.length !== 3)
    throw new Error(`Unsupported computed opaque colour ${color}`);
  const rgb = values.map((n) => {
    const channel = n / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function focusContrast(cell: HTMLElement) {
  css();
  cell.dataset.review500FocusVisible = "true";
  const style = getComputedStyle(cell),
    ratio = contrast(style.outlineColor, style.backgroundColor);
  expect(
    ratio,
    `Static inset focus ring ${style.outlineColor} against ${style.backgroundColor}: ${ratio.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(3);
  delete cell.dataset.review500FocusVisible;
}
function live(element: HTMLElement) {
  return !!element.closest(
    '[aria-live="polite"],[aria-live="assertive"],[role="status"],[role="alert"]',
  );
}
const emptySelection = (): Selection => ({ pieceId: null, candidate: null });
const piece = (
  id: string,
  kind: Kind,
  q: number,
  side: Side = "white",
  remaining = 3,
): Piece => ({ id, kind, square: q, side, remaining, summonedPly: -1 });
const state = (pieces: Piece[] = [], turn: Side = "white"): GameState => ({
  ...createGame(),
  pieces,
  turn,
});
function board(s = createGame(), selection: Selection = emptySelection()) {
  const host = document.createElement("div");
  document.body.append(host);
  const onSquare = vi.fn();
  const view = createBoard2D(host, onSquare);
  views.push(view);
  view.render(
    s,
    selection,
    selection.candidate ? previewAction(s, selection.candidate) : null,
  );
  return { host, view, onSquare };
}
function expectRoving(q: number) {
  expect(document.activeElement).toBe(square(q));
  expect(document.querySelectorAll('[data-square][tabindex="0"]')).toHaveLength(
    1,
  );
  expect(square(q).tabIndex).toBe(0);
}
function media(matches: boolean) {
  let listener: (() => void) | undefined;
  const pref = {
    matches,
    addEventListener: vi.fn((_name: string, callback: () => void) => {
      listener = callback;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => pref),
  );
  return {
    pref,
    change(value: boolean) {
      pref.matches = value;
      listener?.();
    },
  };
}
function motionClock() {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((n: number) => {
      frames.delete(n);
    }),
  );
  return frames;
}
function fixture(
  kind: "move" | "capture" | "swap" | "summon",
  inspect = false,
) {
  const side: Side = inspect ? "black" : "white";
  const enemy: Side = inspect ? "white" : "black";
  if (kind === "summon") {
    const s = state();
    const action: Action = {
      type: "summon",
      kind: "carver",
      duration: 3,
      to: 14,
    };
    return {
      s,
      selection: {
        pieceId: null,
        candidate: action,
        summon: { kind: "carver" as Kind, duration: 3 },
      },
      action,
      to: 14,
    };
  }
  const s = state(
    kind === "swap"
      ? [piece("actor", "link", 16, side), piece("ally", "bastion", 17, side)]
      : [
          piece("actor", "carver", 16, side),
          ...(kind === "capture" ? [piece("enemy", "bastion", 25, enemy)] : []),
        ],
  );
  const to = kind === "swap" ? 17 : kind === "capture" ? 25 : 24;
  const action: Action =
    kind === "swap"
      ? { type: "swap", pieceId: "actor", allyId: "ally" }
      : { type: "move", pieceId: "actor", to };
  const selection: Selection = {
    pieceId: "actor",
    candidate: inspect ? null : action,
    inspectOnly: inspect,
  };
  return { s, selection, action, to };
}
async function roomFixture(overrides: Partial<RoomView> = {}) {
  let current: RoomView = {
    id: "a".repeat(32),
    seat: "white",
    version: 0,
    status: "waiting",
    expiresAt: Date.now() + 86400000,
    joined: false,
    ready: { white: false, black: false },
    state: createGame(),
    invite: "b".repeat(64),
    ...overrides,
  };
  const fetcher = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(path === "/api/session" ? { ok: true } : current),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await boot(`/?2d&room=${current.id}`);
  return {
    fetcher,
    update(patch: Partial<RoomView>) {
      current = { ...current, ...patch, version: current.version + 1 };
    },
    async poll(milliseconds = 1800) {
      await vi.advanceTimersByTimeAsync(milliseconds);
      await flush();
    },
  };
}

async function unchangedLiveContent(ids: string[], next: () => Promise<void>) {
  const counts: Record<string, number> = {};
  const observers = ids.map((id) => {
    expect(
      el(id).closest("[hidden]"),
      `${id} must actually be visible for this status check`,
    ).toBeNull();
    expect(live(el(id)), `${id} must expose live/status semantics`).toBe(true);
    const observer = new MutationObserver((records) => {
      if (records.length) counts[id] = (counts[id] ?? 0) + records.length;
    });
    observer.observe(el(id), {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return observer;
  });
  await next();
  observers.forEach((observer) => observer.disconnect());
  expect(
    counts,
    `Unchanged visible live-content mutations: ${JSON.stringify(counts)}`,
  ).toEqual({});
}

// A001–A032: spatial navigation and stable single-tab-stop contracts.
for (const [from, direction, to, reason] of [
  [24, "ArrowUp", 31, "interior north"],
  [24, "ArrowDown", 17, "interior south"],
  [24, "ArrowLeft", 23, "interior west"],
  [24, "ArrowRight", 25, "interior east"],
  [45, "ArrowUp", 45, "north edge"],
  [3, "ArrowDown", 3, "south edge"],
  [21, "ArrowLeft", 21, "west edge"],
  [27, "ArrowRight", 27, "east edge"],
  [0, "ArrowUp", 7, "southwest inward"],
  [6, "ArrowLeft", 5, "southeast inward"],
  [42, "ArrowRight", 43, "northwest inward"],
  [48, "ArrowDown", 41, "northeast inward"],
] as const)
  scenario(
    "keyboard-navigation",
    "Keyboard-only spatial learner",
    `Arrow navigation ${reason}`,
    [`Focus square ${from}`, `Press ${direction}`],
    `Focus is square ${to}, one tab stop remains, arrow default is prevented, and no action commits.`,
    () => {
      const { onSquare } = board();
      square(from).focus();
      const event = key(square(from), direction);
      expectRoving(to);
      expect(event.defaultPrevented).toBe(true);
      expect(onSquare).not.toHaveBeenCalled();
    },
  );
for (const route of [
  {
    name: "complete bottom rank",
    from: 0,
    keys: Array(6).fill("ArrowRight"),
    to: 6,
  },
  {
    name: "complete top rank reversed",
    from: 48,
    keys: Array(6).fill("ArrowLeft"),
    to: 42,
  },
  {
    name: "complete west file",
    from: 0,
    keys: Array(6).fill("ArrowUp"),
    to: 42,
  },
  {
    name: "complete east file reversed",
    from: 48,
    keys: Array(6).fill("ArrowDown"),
    to: 6,
  },
  {
    name: "southwest blocked corner escape",
    from: 0,
    keys: ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"],
    to: 8,
  },
  {
    name: "northeast blocked corner escape",
    from: 48,
    keys: ["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"],
    to: 40,
  },
  {
    name: "closed square route",
    from: 24,
    keys: ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"],
    to: 24,
  },
  {
    name: "cross core route without accidental choice",
    from: 2,
    keys: ["ArrowRight", "ArrowRight", "ArrowUp", "ArrowUp", "ArrowLeft"],
    to: 17,
  },
])
  scenario(
    "keyboard-route",
    "Keyboard-only explorer",
    `Route ${route.name}`,
    [`Focus ${route.from}`, ...route.keys.map((k) => `Press ${k}`)],
    `Focus finishes at ${route.to}; all intermediate roving states have exactly one tab stop; movement never activates a square.`,
    () => {
      const { onSquare } = board();
      square(route.from).focus();
      for (const direction of route.keys) {
        key(document.activeElement as HTMLElement, direction);
        expect(
          document.querySelectorAll('[data-square][tabindex="0"]'),
        ).toHaveLength(1);
      }
      expectRoving(route.to);
      expect(onSquare).not.toHaveBeenCalled();
    },
  );
for (const value of ["Tab", "Home", "End", "x"])
  scenario(
    "keyboard-noninterference",
    "Keyboard and assistive shortcut user",
    `Board does not swallow ${value}`,
    ["Focus center square", `Dispatch ${value}`],
    "No board navigation or activation occurs and the key remains available to the browser/assistive technology.",
    () => {
      const { onSquare } = board();
      square(24).focus();
      const event = key(square(24), value);
      expectRoving(24);
      expect(event.defaultPrevented).toBe(false);
      expect(onSquare).not.toHaveBeenCalled();
    },
  );
for (const stage of [
  "idle",
  "selected",
  "preview",
  "cleared",
  "summon",
  "inspection",
  "transition",
  "cancelled-motion",
] as const)
  scenario(
    "focus-render-stability",
    "Keyboard player awaiting updates",
    `Roving focus survives ${stage} render`,
    ["Focus square 20", `Render ${stage}`, "Press ArrowUp"],
    `Existing square identity and focus survive repaint; the next arrow starts from the same square rather than a reset origin.${stage === "idle" ? " Also checks static inset-focus contrast of both square colours at least 3:1." : ""}`,
    () => {
      const { view } = board();
      const original = square(20);
      original.focus();
      const f = fixture("move");
      if (stage === "selected")
        view.render(f.s, { pieceId: "actor", candidate: null }, null);
      else if (stage === "preview")
        view.render(f.s, f.selection, previewAction(f.s, f.action));
      else if (stage === "cleared") {
        view.render(f.s, f.selection, previewAction(f.s, f.action));
        view.render(f.s, emptySelection(), null);
      } else if (stage === "summon")
        view.render(
          createGame(),
          { ...emptySelection(), summon: { kind: "leaper", duration: 4 } },
          null,
        );
      else if (stage === "inspection") {
        const x = fixture("move", true);
        view.render(x.s, x.selection, null);
      } else if (stage === "transition" || stage === "cancelled-motion") {
        const next = applyAction(f.s, f.action);
        expect(next.ok).toBe(true);
        if (next.ok)
          view.render(next.state, emptySelection(), null, {
            before: f.s,
            events: next.events,
          });
        if (stage === "cancelled-motion") view.cancelMotion?.();
      } else view.render(createGame(), emptySelection(), null);
      expect(square(20)).toBe(original);
      expectRoving(20);
      key(original, "ArrowUp");
      expectRoving(27);
      if (stage === "idle") {
        focusContrast(square(20));
        focusContrast(square(27));
      }
    },
  );

// A033–A072: redundant identity, lifetime, target and ownership information.
for (const kind of ["bastion", "carver", "leaper", "link"] as const)
  for (const side of ["white", "black"] as const)
    for (const life of [1, 5])
      scenario(
        "piece-colour-independent",
        "Colour-vision-deficient lifetime reader",
        `${side} ${kind} lifetime ${life}`,
        [`Render ${side} ${kind} at c3 with ${life} turn(s)`],
        "Accessible name contains coordinate, textual side, full piece name and numeric lifetime; visible glyph and numeric badge do not depend on colour. Static author CSS keeps the desktop lifetime badge at least 13px with 4.5:1 text contrast.",
        () => {
          board(state([piece("subject", kind, 16, side, life)]));
          const cell = square(16);
          expect(cell.getAttribute("aria-label")).toBe(
            `c3 ${side === "white" ? "白" : "黒"} ${INFO[kind].name} 残り${life}ターン`,
          );
          expect(cell.querySelector(".piece-mark")?.textContent).toBe(
            PIECE_MARK[kind],
          );
          expect(cell.querySelector(".life")?.textContent).toBe(String(life));
          expect(cell.querySelector(".life")?.classList.contains("last")).toBe(
            life === 1,
          );
          expect(cell.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
            "true",
          );
          css();
          const badgeStyle = getComputedStyle(cell.querySelector(".life")!);
          expect(parseFloat(badgeStyle.fontSize)).toBeGreaterThanOrEqual(13);
          expect(
            contrast(badgeStyle.color, badgeStyle.backgroundColor),
          ).toBeGreaterThanOrEqual(4.5);
        },
      );
for (const kind of ["bastion", "carver", "leaper", "link"] as const)
  for (const side of ["white", "black"] as const)
    scenario(
      "piece-selection-semantics",
      "Screen-reader exploration user",
      `Selected ${side} ${kind} toggles pressed state`,
      ["Render unselected piece", "Select piece", "Clear selection"],
      "Exactly the selected square exposes pressed=true; clearing removes pressed state without removing its descriptive name.",
      () => {
        const s = state([piece("subject", kind, 16, side)]);
        const { view } = board(s);
        expect(square(16).getAttribute("aria-pressed")).toBe("false");
        view.render(s, { pieceId: "subject", candidate: null }, null);
        expect(square(16).getAttribute("aria-pressed")).toBe("true");
        expect(
          document.querySelectorAll('[data-square][aria-pressed="true"]'),
        ).toHaveLength(1);
        view.render(s, emptySelection(), null);
        expect(square(16).getAttribute("aria-pressed")).toBe("false");
        expect(square(16).getAttribute("aria-label")).toContain(
          INFO[kind].name,
        );
      },
    );
for (const [q, name] of [
  [0, "a1 空き"],
  [6, "g1 空き"],
  [42, "a7 空き"],
  [48, "g7 空き"],
  [3, "d1 白のコア"],
  [45, "d7 黒のコア"],
] as const)
  scenario(
    "board-orientation",
    "Nonvisual board mapper",
    `Square identity ${name}`,
    [`Render untouched board`, `Inspect square ${q}`],
    "Square name matches the stable visible coordinate and identifies empty space or core ownership in text. Static coordinate font is at least 10px and its opacity-composited contrast on the tile is at least 4.5:1.",
    () => {
      board();
      expect(square(q).getAttribute("aria-label")).toBe(name);
      expect(square(q).querySelector(".coord")?.textContent).toBe(
        name.split(" ")[0],
      );
      css();
      const tile = getComputedStyle(square(q)),
        label = getComputedStyle(square(q).querySelector(".coord")!);
      const fg = label.color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number),
        bg = tile.backgroundColor
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number),
        alpha = Number(label.opacity || "1");
      const blended = `rgb(${fg.map((n, index) => n * alpha + bg[index] * (1 - alpha)).join(",")})`,
        ratio = contrast(blended, tile.backgroundColor),
        size = parseFloat(label.fontSize);
      expect(
        size >= 10 && ratio >= 4.5,
        `Static coordinate ${name}: ${size}px, opacity ${alpha}, composited contrast ${ratio.toFixed(2)}:1`,
      ).toBe(true);
    },
  );
for (const [kind, text, shape] of [
  ["move", "移動先に選べます", "circle"],
  ["capture", "捕獲できます", "path"],
  ["swap", "味方と交換できます", "path"],
  ["summon", "召喚できます", "path"],
] as const)
  scenario(
    "target-colour-independent",
    "Colour-blind tactical player",
    `${kind} target combines shape and name`,
    [`Prepare legal ${kind}`, "Preview the target", "Clear selection"],
    "Target has a kind-specific non-colour shape, action wording and uncommitted-destination name; stale target data disappears on clear. Static inset keyboard-focus contrast against this target fill is at least 3:1.",
    () => {
      const f = fixture(kind);
      const { view } = board(f.s, f.selection);
      const cell = square(f.to);
      expect(cell.dataset.targetKind).toBe(kind);
      expect(cell.dataset.available).toBe("true");
      expect(cell.querySelector(`.marker-${kind} ${shape}`)).not.toBeNull();
      expect(cell.getAttribute("aria-label")).toContain(text);
      expect(cell.getAttribute("aria-label")).toContain("確定前");
      expect(
        cell.querySelector(".destination-marker")?.getAttribute("aria-hidden"),
      ).toBe("true");
      focusContrast(cell);
      view.render(f.s, emptySelection(), null);
      expect(cell.dataset.targetKind).toBeUndefined();
      expect(cell.getAttribute("aria-label")).not.toContain("確定前");
      expect(cell.querySelector(".destination-marker")).toBeNull();
    },
  );
for (const kind of ["move", "capture", "swap"] as const)
  scenario(
    "inspection-semantics",
    "Novice inspecting opponent",
    `Opponent ${kind} is reference-only`,
    [`Select opponent's ${kind} piece`, "Inspect target"],
    "Text explicitly says the target is a reference and cannot be operated; actionable shape markers are absent.",
    () => {
      const f = fixture(kind, true);
      board(f.s, f.selection);
      const cell = square(f.to);
      expect(cell.dataset.targetKind).toBe(kind);
      expect(cell.dataset.available).toBe("false");
      expect(cell.getAttribute("aria-label")).toContain(
        "参考（操作できません）",
      );
      expect(cell.classList.contains("inspect-target")).toBe(true);
      expect(cell.querySelector(".destination-marker")).toBeNull();
    },
  );
scenario(
  "board-group-semantics",
  "Screen-reader landmarks user",
  "Board group has dimensions and no duplicate tab stops",
  ["Render board", "Read group and button roles"],
  "The group is named as a 7×7 battle board and contains 49 native, non-submitting square buttons with one tab stop.",
  () => {
    const { host } = board();
    const group = host.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("7×7の対戦盤");
    expect(group.querySelectorAll('button[type="button"]')).toHaveLength(49);
    expect(group.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  },
);
scenario(
  "effects-semantics",
  "Screen-reader user during animation",
  "Decorative motion layer is hidden from accessibility tree",
  ["Render a summon transition"],
  "Effect glyphs cannot duplicate authoritative piece/action announcements and are not keyboard-focusable.",
  () => {
    const f = fixture("summon");
    const { view, host } = board(f.s);
    const next = applyAction(f.s, f.action);
    expect(next.ok).toBe(true);
    if (next.ok)
      view.render(next.state, emptySelection(), null, {
        before: f.s,
        events: next.events,
      });
    expect(
      host.querySelector(".board-effects")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      host.querySelector(".board-effects button,.board-effects [tabindex]"),
    ).toBeNull();
  },
);
scenario(
  "board-name-uniqueness",
  "Voice-control square selector",
  "Every initial square has a unique accessible name",
  ["Render initial board", "Collect square names"],
  "All 49 accessible names are nonempty and distinguishable by coordinates rather than colour or position alone.",
  () => {
    board();
    const names = [...document.querySelectorAll("[data-square]")].map((node) =>
      node.getAttribute("aria-label"),
    );
    expect(names).toHaveLength(49);
    expect(new Set(names).size).toBe(49);
    expect(names.every((name) => /^[a-g][1-7] /.test(name!))).toBe(true);
  },
);

// A073–A096: real app focus routing and interrupted local interactions.
for (const mode of ["local", "cpu"] as const)
  scenario(
    "focus-start",
    "Keyboard-only first-time player",
    `Keyboard starts ${mode} into playable board`,
    [`Choose ${mode}`, "Focus and activate Start"],
    "Focus moves from the hidden home to one visible board square; no CPU reply occurs before the user's first move.",
    async () => {
      await boot();
      click(`choose-${mode}`);
      el("start-game").focus();
      click("start-game");
      expect(usableFocus().dataset.square).toBeDefined();
      expect(el("ply").textContent).toBe("0 / 200 手");
    },
  );
for (const stage of [
  "idle",
  "pass-preview",
  "summon-selection",
  "summon-preview",
] as const)
  scenario(
    "focus-home-resume",
    "Interrupted keyboard player",
    `Home and resume from ${stage}`,
    ["Start local", `Reach ${stage}`, "Go home", "Resume"],
    "Home focuses Resume; resuming focuses a visible board square; partial choices are cleared without spending or advancing the turn.",
    async () => {
      await boot();
      start();
      if (stage === "pass-preview") click("pass");
      if (stage.startsWith("summon")) {
        click("summon");
        choose("carver");
        if (stage === "summon-preview") square(14).click();
      }
      click("home-button");
      expect(document.activeElement).toBe(el("resume-game"));
      expect(el("home").hidden).toBe(false);
      click("resume-game");
      expect(usableFocus().dataset.square).toBeDefined();
      expect(el("confirm-row").hidden).toBe(true);
      expect(el("ply").textContent).toBe("0 / 200 手");
      expect(el("white-grain").textContent).toBe("16");
    },
  );
scenario(
  "focus-summon-picker",
  "Keyboard-only novice",
  "Summon opens on first affordable piece",
  ["Start local", "Keyboard-activate Summon"],
  "Focus moves into the now-visible picker and the first focus target is enabled and named.",
  async () => {
    await boot();
    start();
    el("summon").focus();
    click("summon");
    const active = usableFocus();
    expect(active.dataset.kind).toBe("bastion");
    expect(active.getAttribute("aria-label")).toContain("バスティオン");
  },
);
for (const kind of ["bastion", "carver", "leaper", "link"] as const)
  scenario(
    "focus-summon-placement",
    "Keyboard-only buyer",
    `Choosing ${kind} focuses an available placement`,
    ["Start local", "Open Summon", `Keyboard-activate ${kind}`],
    "Focus leaves the piece selector for a visible, named legal summon square; price and duration are shown before a commit.",
    async () => {
      await boot();
      start();
      click("summon");
      choose(kind);
      const active = usableFocus();
      expect(active.dataset.available).toBe("true");
      expect(active.getAttribute("aria-label")).toContain("召喚できます");
      expect(el("summon-details").hidden).toBe(false);
      expect(el("confirm-row").hidden).toBe(true);
    },
  );
scenario(
  "focus-pass",
  "Cautious keyboard player",
  "Pass requires focused confirmation",
  ["Start local", "Keyboard-activate Pass"],
  "The confirmation button receives focus, names the pass, and no turn changes yet.",
  async () => {
    await boot();
    start();
    click("pass");
    expect(document.activeElement).toBe(el("confirm"));
    expect(el("confirm").textContent).toBe("パスを確定");
    expect(el("ply").textContent).toBe("0 / 200 手");
  },
);
scenario(
  "focus-back-pass",
  "Indecisive keyboard player",
  "Back from pass returns to Summon",
  ["Preview pass", "Focus and activate Back"],
  "Focus does not remain on the hidden Back control and no pass is committed.",
  async () => {
    await boot();
    start();
    click("pass");
    el("back").focus();
    click("back");
    expect(document.activeElement).toBe(el("summon"));
    usableFocus();
    expect(el("ply").textContent).toBe("0 / 200 手");
  },
);
scenario(
  "focus-back-summon",
  "Placement-adjusting keyboard player",
  "Back from summon retains board focus target",
  ["Preview summon on a3", "Focus and activate Back"],
  "Focus returns to the existing board tab stop, removes ghost/confirmation and keeps the purchase editable.",
  async () => {
    await boot();
    start();
    click("summon");
    choose("carver");
    square(14).focus();
    square(14).click();
    el("back").focus();
    click("back");
    expectRoving(14);
    expect(document.querySelector(".ghost-piece")).toBeNull();
    expect(el("summon-details").hidden).toBe(false);
  },
);
scenario(
  "focus-cancel",
  "Keyboard player changing their mind",
  "Cancel from purchase returns to an enabled main action",
  ["Select Leaper purchase", "Focus and activate Cancel"],
  "Summon regains visible focus, target/price surfaces clear and state remains unchanged.",
  async () => {
    await boot();
    start();
    click("summon");
    choose("leaper");
    el("cancel").focus();
    click("cancel");
    expect(document.activeElement).toBe(el("summon"));
    usableFocus();
    expect(el("summary").hidden).toBe(true);
    expect(document.querySelector(".destination-marker")).toBeNull();
  },
);
for (const origin of ["picker", "board", "confirm", "duration"] as const)
  scenario(
    "focus-escape",
    "Keyboard user escaping an action",
    `Escape from ${origin} keeps visible focus`,
    ["Start a summon selection", `Focus ${origin}`, "Press Escape"],
    "The draft is canceled; focus remains on the board if it was there, otherwise returns to visible Summon; no purchase occurs.",
    async () => {
      await boot();
      start();
      click("summon");
      if (origin === "picker")
        document.querySelector<HTMLElement>('[data-kind="carver"]')!.focus();
      else {
        choose("carver");
        if (origin === "board") square(14).focus();
        if (origin === "confirm") {
          square(14).click();
          el("confirm").focus();
        }
        if (origin === "duration") el("minus").focus();
      }
      if (origin === "confirm") {
        click("menu");
        el("close-menu").focus();
        key(el("close-menu"), "Escape");
        expect(el("confirm-row").hidden).toBe(false);
        expect(el("ply").textContent).toBe("0 / 200 手");
        click("close-menu");
        el("confirm").focus();
      }
      key(document.activeElement as HTMLElement, "Escape");
      const active = usableFocus();
      expect(active).toBe(origin === "board" ? square(14) : el("summon"));
      expect(el("confirm-row").hidden).toBe(true);
      expect(el("piece-picker").hidden).toBe(true);
      expect(el("ply").textContent).toBe("0 / 200 手");
    },
  );
for (const action of ["summon", "pass"] as const)
  scenario(
    "focus-after-commit",
    "Keyboard player handing device over",
    `Committing ${action} leaves a visible board focus`,
    [`Preview ${action}`, "Focus Confirm", "Confirm and await state"],
    "Focus returns to one board square, confirmation controls disappear, and exactly one turn advances.",
    async () => {
      await boot();
      start();
      if (action === "summon") {
        click("summon");
        choose("bastion");
        square(14).click();
      } else click("pass");
      el("confirm").focus();
      await commit();
      expect(usableFocus().dataset.square).toBeDefined();
      expect(el("confirm-row").hidden).toBe(true);
      expect(el("ply").textContent).toBe("1 / 200 手");
    },
  );
scenario(
  "focus-rematch",
  "Keyboard player after a draw",
  "Rematch replaces the hidden result button with usable focus",
  ["Play six confirmed passes", "Keyboard-activate Rematch"],
  "Fresh board receives focus, result actions disappear, and the ply counter resets.",
  async () => {
    await boot();
    start();
    for (let n = 0; n < 6; n++) await pass();
    el("again").focus();
    click("again");
    expect(usableFocus().dataset.square).toBeDefined();
    expect(el("result-actions").hidden).toBe(true);
    expect(el("ply").textContent).toBe("0 / 200 手");
  },
);
scenario(
  "focus-cancel-home",
  "Player declining interruption",
  "Declining Home preserves focus and exact draft",
  ["Prepare pass", "Focus Home", "Decline confirmation"],
  "The arena remains visible and both the pending action and focused Home control are retained.",
  async () => {
    await boot();
    start();
    click("pass");
    el("home-button").focus();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    click("home-button");
    expect(document.activeElement).toBe(el("home-button"));
    expect(el("confirm-row").hidden).toBe(false);
    expect(el("home").hidden).toBe(true);
    expect(el("ply").textContent).toBe("0 / 200 手");
  },
);
scenario(
  "focus-pointer-noninterference",
  "Mixed pointer and keyboard player",
  "Pointer summon does not unexpectedly jump keyboard focus",
  ["Focus board c3", "Dispatch pointer-detail Summon click"],
  "The pointer interaction opens the picker without the keyboard-only focus helper overriding the existing board focus.",
  async () => {
    await boot();
    start();
    square(16).focus();
    el("summon").dispatchEvent(
      new MouseEvent("click", { detail: 1, bubbles: true }),
    );
    expectRoving(16);
    expect(el("piece-picker").hidden).toBe(false);
  },
);

// A097–A120: understandable modes, updates, error recovery and announcements.
for (const [mode, words] of [
  ["cpu", "あなたが先手"],
  ["local", "相手も人"],
  ["friend", "準備完了"],
] as const)
  scenario(
    "novice-mode-guidance",
    "First-time reader",
    `Choosing ${mode} announces the matching next step`,
    [`Choose ${mode} from neutral home`],
    "Exactly one mode is pressed; polite home guidance describes the next step and selecting a mode alone does not start the arena.",
    async () => {
      await boot();
      click(`choose-${mode}`);
      expect(
        document.querySelectorAll('.mode-choice[aria-pressed="true"]'),
      ).toHaveLength(1);
      expect(el(`choose-${mode}`).getAttribute("aria-pressed")).toBe("true");
      expect(el("home-hint").textContent).toContain(words);
      expect(live(el("home-hint"))).toBe(true);
      expect(el("arena").hidden).toBe(true);
    },
  );
scenario(
  "novice-start-gate",
  "First-time keyboard user",
  "Unchosen mode cannot activate Start",
  ["Boot neutral home", "Try Start"],
  "Start is natively disabled and no board or implicit game choice appears.",
  async () => {
    await boot();
    expect(el<HTMLButtonElement>("start-game").disabled).toBe(true);
    click("start-game");
    expect(document.querySelector("[data-square]")).toBeNull();
    expect(el("home").hidden).toBe(false);
  },
);
scenario(
  "home-heading-semantics",
  "Screen-reader heading navigator",
  "Home sections have meaningful heading names",
  ["Read main home and mode group"],
  "Both home sections reference existing visible headings and mode group has an explicit name. Static home-choice CSS has 84px default and 78px small-screen minimum heights; this is not viewport layout evidence.",
  async () => {
    await boot();
    for (const id of ["home", "mode-title"]) {
      const section =
        id === "home" ? el("home") : el("mode-title").parentElement!;
      const label = section.getAttribute("aria-labelledby");
      expect(label).toBeTruthy();
      expect(el(label!).textContent?.length).toBeGreaterThan(0);
    }
    expect(
      document.querySelector(".mode-options")?.getAttribute("aria-label"),
    ).toBe("対戦方法");
    css();
    expect(
      parseFloat(getComputedStyle(el("choose-local")).minHeight),
    ).toBeGreaterThanOrEqual(44);
    expect(authoredCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.mode-choice\s*\{\s*min-height: 78px/,
    );
  },
);
scenario(
  "dialog-naming",
  "Screen-reader rules reader",
  "Rules dialog has an explicit heading and close name",
  ["Open rules from home"],
  "Dialog references its visible heading, close button is named, and keyboard instructions are available as text. Static close-control CSS keeps a 44px target and sticky escape header.",
  async () => {
    await boot();
    click("home-rules");
    expect(el("drawer").getAttribute("aria-labelledby")).toBe("drawer-title");
    expect(el("drawer").hasAttribute("open")).toBe(true);
    expect(el("close-menu").getAttribute("aria-label")).toContain("閉じる");
    expect(el("drawer").textContent).toContain("矢印で移動");
    css();
    expect(
      parseFloat(getComputedStyle(el("close-menu")).minWidth),
    ).toBeGreaterThanOrEqual(44);
    expect(
      parseFloat(getComputedStyle(el("close-menu")).minHeight),
    ).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(el("close-menu").parentElement!).position).toBe(
      "sticky",
    );
  },
);
scenario(
  "dialog-naming",
  "Friend invitation novice",
  "Friend setup dialog explains consent and seat readiness",
  ["Choose Friend", "Start friend setup"],
  "Dialog is named and textual instructions require deliberate room creation and both people ready before play.",
  async () => {
    await boot();
    click("choose-friend");
    click("start-game");
    expect(el("friend-dialog").getAttribute("aria-labelledby")).toBe(
      "friend-title",
    );
    expect(el("friend-description").textContent).toContain("2人が準備完了");
    expect(el("create-room").hidden).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  },
);
for (const [kind, cost] of [
  ["bastion", 1],
  ["carver", 3],
  ["leaper", 2],
  ["link", 1],
] as const)
  scenario(
    "purchase-labels",
    "Nonvisual cautious buyer",
    `${kind} choice names full piece and unit price`,
    ["Open Summon", `Read ${kind} choice`, `Choose ${kind}`],
    "Button includes full Japanese piece name and per-turn price; selected state is exposed separately from style.",
    async () => {
      await boot();
      start();
      click("summon");
      const button = document.querySelector<HTMLButtonElement>(
        `[data-kind="${kind}"]`,
      )!;
      expect(button.getAttribute("aria-label")).toBe(
        `${INFO[kind].name}、1ターンにつき糧${cost}`,
      );
      choose(kind);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(
        document.querySelectorAll('[data-kind][aria-pressed="true"]'),
      ).toHaveLength(1);
    },
  );
for (const n of [1, 5])
  scenario(
    "duration-boundaries",
    "Keyboard user at purchase limits",
    `Duration ${n} boundary exposes native disabled state`,
    ["Select Bastion", `Set duration ${n}`, "Try bounded increment/decrement"],
    "Outward duration control is natively disabled, inward control remains enabled, and repeated boundary activation cannot alter price or duration.",
    async () => {
      await boot();
      start();
      click("summon");
      choose("bastion");
      duration(n);
      const disabled = n === 1 ? "minus" : "plus",
        enabled = n === 1 ? "plus" : "minus";
      expect(el<HTMLButtonElement>(disabled).disabled).toBe(true);
      expect(el<HTMLButtonElement>(enabled).disabled).toBe(false);
      click(disabled);
      expect(el("duration").textContent).toBe(String(n));
      expect(el(disabled).getAttribute("aria-label")).toContain("期間");
    },
  );
scenario(
  "purchase-live-status",
  "Nonvisual price checker",
  "Changing duration announces total and remaining grain",
  ["Select Carver", "Increase duration from three to four"],
  "Atomic polite purchase facts update from 9 to 12 grain and explicitly include four turns and remaining four grain.",
  async () => {
    await boot();
    start();
    click("summon");
    choose("carver");
    click("plus");
    expect(el("purchase-facts").textContent).toBe("4ターンで12糧 · 残り4糧");
    expect(live(el("purchase-facts"))).toBe(true);
    expect(el("purchase-facts").getAttribute("aria-atomic")).toBe("true");
  },
);
scenario(
  "confirmation-live-status",
  "Nonvisual purchase checker",
  "Summon confirmation announces cost and lifetime",
  ["Preview three-turn Carver summon"],
  "Visible confirmation summary is live and describes cost nine, remaining seven, and three-turn lifetime before any payment.",
  async () => {
    await boot();
    start();
    click("summon");
    choose("carver");
    square(14).click();
    expect(el("summary").hidden).toBe(false);
    expect(live(el("summary"))).toBe(true);
    expect(el("summary").textContent).toContain("支払う 9");
    expect(el("summary").textContent).toContain("残る糧 7");
    expect(el("summary").textContent).toContain("期間3ターン");
    expect(el("white-grain").textContent).toBe("16");
  },
);
scenario(
  "turn-live-status",
  "Shared-device nonvisual player",
  "Confirmed pass names the next side in live text",
  ["Confirm White pass"],
  "Polite turn heading changes to Black and novice handoff guidance names the next person.",
  async () => {
    await boot();
    start();
    await pass();
    expect(live(el("turn"))).toBe(true);
    expect(el("turn").textContent).toBe("黒の手番");
    expect(el("hint").textContent).toContain("黒の人の番");
  },
);
scenario(
  "history-live-status",
  "Player who misses animation",
  "Summon result is retained as live textual history",
  [
    "Confirm Bastion at a3",
    "Wait until effects end",
    "Inspect the existing piece without another move",
  ],
  "History still states a3 summon after decorative motion disappears, both in live log and in menu history. Inspecting a piece without committing another move does not rewrite the unchanged live history.",
  async () => {
    await boot();
    start();
    await summon("bastion", 14);
    await vi.advanceTimersByTimeAsync(3000);
    expect(live(el("log"))).toBe(true);
    expect(el("log").textContent).toContain("a3に召喚");
    expect(el("history").textContent).toContain("a3に召喚");
    await unchangedLiveContent(["log"], async () => {
      square(14).click();
      await flush();
    });
  },
);
scenario(
  "invalid-action-announcement",
  "Nonvisual novice misplacing a summon",
  "Invalid summon placement publishes a live correction",
  ["Choose Carver", "Activate forbidden middle-rank square a4"],
  "A visible correction states to choose own-side empty squares and is exposed as a live/status update without committing.",
  async () => {
    await boot();
    start();
    click("summon");
    choose("carver");
    square(21).focus();
    square(21).click();
    expect(el("hint").textContent).toContain("自陣の空きマス");
    expect(el("confirm-row").hidden).toBe(true);
    expect(live(el("hint"))).toBe(true);
    expect(el("ply").textContent).toBe("0 / 200 手");
  },
);
scenario(
  "invalid-action-announcement",
  "Nonvisual novice misunderstanding movement",
  "Invalid move destination publishes a live correction",
  [
    "Summon Carver at a3",
    "Black passes",
    "Select Carver",
    "Activate distant g7",
  ],
  "The invalid-move explanation is live and tells the user to choose a highlighted destination, without replacing the piece selection or committing.",
  async () => {
    await boot();
    start();
    await summon("carver", 14, 5);
    await pass();
    square(14).click();
    square(48).focus();
    square(48).click();
    expect(el("hint").textContent).toContain("そのマスには移動できません");
    expect(live(el("hint"))).toBe(true);
    expect(square(14).getAttribute("aria-pressed")).toBe("true");
    expect(el("ply").textContent).toBe("2 / 200 手");
  },
);
scenario(
  "expiry-live-status",
  "Novice planning a final-lived piece",
  "One-turn owned piece explains exact expiry in live summary",
  ["Summon Bastion for one turn", "Black passes", "Inspect the Bastion"],
  "The visible live explanation says this White turn-end expiry and retains numeric life one rather than requiring badge colour.",
  async () => {
    await boot();
    start();
    await summon("bastion", 14, 1);
    await pass();
    square(14).click();
    expect(live(el("summary"))).toBe(true);
    expect(el("summary").textContent).toContain("この白の手番末に退場");
    expect(square(14).getAttribute("aria-label")).toContain("残り1ターン");
  },
);
scenario(
  "target-live-status",
  "Nonvisual destination learner",
  "Placement legend names target count and unconfirmed coordinate",
  ["Select Link", "Preview b3 placement"],
  "Atomic live legend names summon destinations and the chosen b3 coordinate as unconfirmed, with no colour dependence.",
  async () => {
    await boot();
    start();
    click("summon");
    choose("link");
    square(15).click();
    expect(live(el("target-legend"))).toBe(true);
    expect(el("target-legend").getAttribute("aria-atomic")).toBe("true");
    expect(el("target-legend").textContent).toContain("召喚 20");
    expect(el("target-legend").textContent).toContain("b3");
    expect(el("target-legend").textContent).toContain("確定前");
  },
);
scenario(
  "result-live-status",
  "Nonvisual endgame reader",
  "Six-pass draw is live and has a reachable next action",
  ["Confirm six alternating passes"],
  "Live heading says draw, explanation specifies six passes, active play controls are disabled and Rematch is visible.",
  async () => {
    await boot();
    start();
    for (let n = 0; n < 6; n++) await pass();
    expect(live(el("turn"))).toBe(true);
    expect(el("turn").textContent).toBe("引き分け");
    expect(el("hint").textContent).toContain("6回連続");
    expect(el<HTMLButtonElement>("summon").disabled).toBe(true);
    expect(el<HTMLButtonElement>("pass").disabled).toBe(true);
    expect(el("result-actions").hidden).toBe(false);
  },
);
scenario(
  "disabled-busy-actions",
  "Impatient solo keyboard player",
  "CPU wait disables human actions without disabling inspection",
  ["Start CPU", "Confirm pass before worker reply"],
  "Summon/pass cannot be activated during CPU turn; board squares stay native enabled controls for read-only exploration.",
  async () => {
    await boot();
    start("cpu");
    await pass();
    expect(el<HTMLButtonElement>("summon").disabled).toBe(true);
    expect(el<HTMLButtonElement>("pass").disabled).toBe(true);
    expect(square(3).disabled).toBe(false);
    click("pass");
    expect(el("ply").textContent).toBe("1 / 200 手");
    expect(el("hint").textContent).toContain("CPU");
  },
);
scenario(
  "friend-error-announcement",
  "Nonvisual room creator with failure",
  "Room creation failure publishes an accessible status",
  ["Open friend setup", "Create room using local failing response"],
  "The error is visible, exposes a live or status role, preserves the dialog, and re-enables retry without a real network request.",
  async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/session"
          ? new Response('{"ok":true}')
          : new Response('{"error":"CAPACITY"}', { status: 503 }),
      ),
    );
    await boot();
    click("choose-friend");
    click("start-game");
    click("create-room");
    await flush();
    expect(el("friend-error").hidden).toBe(false);
    expect(el("friend-error").textContent).toContain("混み合っています");
    expect(live(el("friend-error"))).toBe(true);
    expect(el<HTMLButtonElement>("create-room").disabled).toBe(false);
    expect(el("friend-dialog").hasAttribute("open")).toBe(true);
  },
);

// A121–A132: reduced-motion and interruption with authoritative static cues.
for (const quality of [false, true])
  for (const motion of [false, true])
    scenario(
      "display-setting-state",
      "User with saved display needs",
      `Saved quality=${quality} motion=${motion} remains independently named`,
      ["Persist explicit two-flag display fixture", "Boot home", "Start local"],
      "Native pressed states and body classes match each independent saved preference, and no game state is persisted.",
      async () => {
        localStorage.setItem(
          "interval-display-preferences",
          JSON.stringify({ quality, motion }),
        );
        await boot();
        start();
        expect(el("quality").getAttribute("aria-pressed")).toBe(
          String(quality),
        );
        expect(el("motion").getAttribute("aria-pressed")).toBe(String(motion));
        expect(document.body.classList.contains("low-quality")).toBe(quality);
        expect(document.body.classList.contains("no-motion")).toBe(motion);
        expect(localStorage.length).toBe(1);
        expect(el("ply").textContent).toBe("0 / 200 手");
      },
    );
scenario(
  "system-reduced-motion",
  "Vestibular-sensitive OS preference user",
  "OS reduced motion overrides saved app motion=false",
  [
    "Enable system reduced motion",
    "Persist app motion=false",
    "Confirm summon",
  ],
  "No moving piece or hidden authoritative piece appears; static piece name/lifetime and reduced effect layer remain available.",
  async () => {
    media(true);
    motionClock();
    localStorage.setItem(
      "interval-display-preferences",
      '{"quality":false,"motion":false}',
    );
    await boot();
    start();
    await summon("carver", 14);
    expect(
      document.querySelectorAll(".moving-piece,.motion-hidden"),
    ).toHaveLength(0);
    expect(document.querySelector(".board-effects.reduced")).not.toBeNull();
    expect(square(14).getAttribute("aria-label")).toContain("残り3ターン");
    expect(el("motion").getAttribute("aria-pressed")).toBe("false");
  },
);
scenario(
  "motion-interruption",
  "User turning movement off mid-effect",
  "Enabling reduced motion cancels an active transition immediately",
  ["Confirm animated summon", "Activate Reduce motion"],
  "Animated overlays and hidden-static classes clear, readable static piece remains, and action history is not lost.",
  async () => {
    media(false);
    motionClock();
    await boot();
    start();
    await summon("carver", 14);
    expect(document.querySelector(".moving-piece")).not.toBeNull();
    click("motion");
    expect(
      document.querySelectorAll(".moving-piece,.motion-hidden"),
    ).toHaveLength(0);
    expect(square(14).getAttribute("aria-label")).toContain("カーヴァー");
    expect(el("log").textContent).toContain("召喚");
  },
);
scenario(
  "motion-interruption",
  "Motion-sensitive interrupted player",
  "Home cancels motion without losing final state on resume",
  ["Confirm animated summon", "Go Home during animation", "Resume"],
  "Hidden-arena motion is removed, resuming shows final lifetime and turn exactly once with usable focus.",
  async () => {
    media(false);
    motionClock();
    await boot();
    start();
    await summon("leaper", 14, 4);
    expect(document.querySelector(".moving-piece")).not.toBeNull();
    click("home-button");
    expect(
      document.querySelectorAll(".moving-piece,.motion-hidden"),
    ).toHaveLength(0);
    click("resume-game");
    expect(square(14).getAttribute("aria-label")).toContain("残り4ターン");
    expect(el("ply").textContent).toBe("1 / 200 手");
    usableFocus();
  },
);
for (const kind of ["summon", "move", "swap", "capture"] as const)
  scenario(
    "reduced-motion-static-result",
    "Motion-sensitive tactical player",
    `Reduced ${kind} retains final names and life`,
    [
      `Set reduced motion`,
      `Apply legal ${kind} transition`,
      "Inspect resulting square",
    ],
    "No movement overlay obscures the result; authoritative static square name and numeric life match committed state and effect layer is decorative.",
    () => {
      media(true);
      motionClock();
      const f = fixture(kind);
      const { view, host } = board(f.s);
      const next = applyAction(f.s, f.action);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      view.render(next.state, emptySelection(), null, {
        before: f.s,
        events: next.events,
      });
      expect(
        host.querySelectorAll(".moving-piece,.motion-hidden"),
      ).toHaveLength(0);
      expect(
        host
          .querySelector(".board-effects.reduced")
          ?.getAttribute("aria-hidden"),
      ).toBe("true");
      const landed = next.state.pieces.find((p) => p.square === f.to)!;
      expect(landed).toBeDefined();
      expect(square(f.to).getAttribute("aria-label")).toContain(
        `残り${landed.remaining}ターン`,
      );
      expect(square(f.to).querySelector(".life")?.textContent).toBe(
        String(landed.remaining),
      );
    },
  );
scenario(
  "system-motion-change",
  "User changing OS accessibility mid-game",
  "Live OS reduction cancels in-progress movement",
  ["Start unreduced legal move", "Fire prefers-reduced-motion change"],
  "Current movement and hiding classes disappear without changing final square labels or roving focus.",
  () => {
    const preference = media(false);
    motionClock();
    const f = fixture("move");
    const { view, host } = board(f.s);
    square(24).focus();
    const next = applyAction(f.s, f.action);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    view.render(next.state, emptySelection(), null, {
      before: f.s,
      events: next.events,
    });
    expect(host.querySelector(".moving-piece")).not.toBeNull();
    const name = square(24).getAttribute("aria-label");
    preference.change(true);
    expect(host.querySelectorAll(".moving-piece,.motion-hidden")).toHaveLength(
      0,
    );
    expect(square(24).getAttribute("aria-label")).toBe(name);
    expectRoving(24);
  },
);

// A133–A140: accessibility of local-fixture waiting-room state changes.
for (const seat of ["white", "black"] as const)
  scenario(
    "lobby-focus",
    "Keyboard participant returning to waiting room",
    `${seat} not-ready lobby resumes on Ready`,
    [
      `Restore waiting room as ${seat}`,
      "Home",
      "Resume",
      seat === "black"
        ? "Return Home before remote start"
        : "Keep Ready focused",
      "Receive local fixture remote-start poll",
    ],
    "Focus lands on enabled Ready instead of the CSS-hidden board; the user's textual seat remains clear. A subsequent remote start transfers focus only from lobby; it does not steal focus from Home. When waiting on Home, a no-op room poll does not rewrite unchanged home guidance.",
    async () => {
      const room = await roomFixture({ seat, joined: seat === "black" });
      click("home-button");
      click("resume-game");
      expect(document.activeElement).toBe(el("ready"));
      usableFocus();
      expect(el("mode-label").textContent).toBe(
        `あなたは${seat === "white" ? "白" : "黒"}`,
      );
      expect(document.activeElement?.closest(".board-shell")).toBeNull();
      if (seat === "black") click("home-button");
      room.update({
        status: "playing",
        joined: true,
        ready: { white: true, black: true },
      });
      await room.poll();
      if (seat === "white") {
        expect(el("lobby").hidden).toBe(true);
        expect(usableFocus().dataset.square).toBeDefined();
      } else {
        expect(el("home").hidden).toBe(false);
        expect(document.activeElement).toBe(el("resume-game"));
        await unchangedLiveContent(["home-hint"], () => room.poll());
      }
    },
  );
for (const seat of ["white", "black"] as const)
  scenario(
    "lobby-disabled-focus",
    "Already-ready keyboard participant",
    `${seat} ready lobby resumes on usable fallback`,
    [
      `Restore ${seat} already-ready room`,
      "Home",
      "Resume",
      ...(seat === "black"
        ? [
            "Open menu and focus its close button",
            "Receive local fixture remote-start poll",
          ]
        : []),
    ],
    "Ready is natively disabled and labelled complete; focus lands on Copy for host or Home for guest, never a disabled or hidden control. If the opponent starts play while the guest is reading the menu, focus remains in that menu.",
    async () => {
      const room = await roomFixture({
        seat,
        joined: true,
        ready: { white: seat === "white", black: seat === "black" },
      });
      click("home-button");
      click("resume-game");
      expect(el<HTMLButtonElement>("ready").disabled).toBe(true);
      expect(el("ready").textContent).toContain("✓");
      expect(document.activeElement).toBe(
        el(seat === "white" ? "copy" : "home-button"),
      );
      usableFocus();
      if (seat === "black") {
        click("menu");
        el("close-menu").focus();
        room.update({ status: "playing", ready: { white: true, black: true } });
        await room.poll();
        expect(document.activeElement).toBe(el("close-menu"));
        expect(el("drawer").hasAttribute("open")).toBe(true);
      }
    },
  );
scenario(
  "lobby-live-status",
  "Nonvisual host waiting for friend",
  "Remote join publishes a live lobby update",
  [
    "Restore host alone",
    "Poll local fixture where friend joined",
    "Poll unchanged lobby",
    "Continue into playing",
    "Select Carver purchase",
    "Poll unchanged selected purchase",
  ],
  "The joined-state text updates and at least one changed lobby title, hint, or seat is exposed as a live/status update; a subsequent unchanged poll produces no mutations in the live seat status or turn heading. Continuing into play with an unchanged purchase does not rewrite the visible live network banner, summary, or purchase facts.",
  async () => {
    const room = await roomFixture();
    room.update({ joined: true });
    await room.poll();
    expect(el("lobby-title").textContent).toBe("2人がそろいました");
    expect(el("guest-seat").textContent).toContain("フレンド");
    const announced = ["lobby-title", "lobby-hint", "guest-seat"].some((id) =>
      live(el(id)),
    );
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((changes) =>
      records.push(...changes),
    );
    for (const id of ["guest-seat", "turn"])
      observer.observe(el(id), {
        childList: true,
        subtree: true,
        characterData: true,
      });
    await room.poll();
    observer.disconnect();
    expect(
      { announced, unchangedPollMutations: records.length },
      "Join needs live semantics and unchanged poll must not rewrite status",
    ).toEqual({ announced: true, unchangedPollMutations: 0 });
    room.update({ status: "playing", ready: { white: true, black: true } });
    await room.poll();
    click("summon");
    choose("carver");
    const summary = el("summary").innerHTML,
      facts = el("purchase-facts").textContent;
    await unchangedLiveContent(
      ["network-banner", "summary", "purchase-facts", "hint", "turn"],
      () => room.poll(3000),
    );
    expect(el("summary").innerHTML).toBe(summary);
    expect(el("purchase-facts").textContent).toBe(facts);
  },
);
scenario(
  "lobby-live-status",
  "Nonvisual guest waiting for host readiness",
  "Remote readiness publishes a live seat update",
  [
    "Restore joined guest lobby",
    "Poll local fixture where host becomes ready",
    "Poll unchanged lobby",
    "Continue into playing with an unchanged threat to the current player core",
    "Fail a local-fixture poll",
    "Repeat the same local-fixture polling failure",
  ],
  "Host's textual readiness updates without falsely enabling play and its changed status is exposed to assistive technology; unchanged polling does not rewrite this live seat status or turn heading. After a connection failure during play, unchanged error, connection-status and still-relevant core-threat content is not rewritten by another identical failed poll.",
  async () => {
    const room = await roomFixture({ seat: "black", joined: true });
    room.update({ ready: { white: true, black: false } });
    await room.poll();
    expect(el("host-seat").textContent).toContain("準備完了");
    const announced = live(el("host-seat"));
    expect(el("lobby").hidden).toBe(false);
    expect(el("game-controls").hidden).toBe(true);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((changes) =>
      records.push(...changes),
    );
    for (const id of ["host-seat", "turn"])
      observer.observe(el(id), {
        childList: true,
        subtree: true,
        characterData: true,
      });
    await room.poll();
    observer.disconnect();
    expect(
      { announced, unchangedPollMutations: records.length },
      "Readiness needs live semantics and unchanged poll must not rewrite status",
    ).toEqual({ announced: true, unchangedPollMutations: 0 });
    room.update({
      status: "playing",
      ready: { white: true, black: true },
      state: state([piece("threat", "carver", 11, "black")]),
    });
    await room.poll();
    expect(el("tactical-note").textContent).toContain("コアが狙われています");
    room.fetcher.mockImplementation(async () => {
      throw new Error("offline local fixture");
    });
    await room.poll(1500);
    expect(el("error").hidden).toBe(false);
    expect(el("network-banner").textContent).toContain("接続を確認");
    await unchangedLiveContent(
      ["error", "network-banner", "hint", "turn", "tactical-note"],
      () => room.poll(4500),
    );
  },
);
scenario(
  "lobby-copy-recovery",
  "Keyboard host with clipboard denial",
  "Copy failure exposes a labelled selectable link field",
  ["Restore host lobby", "Fail local clipboard write", "Activate Copy"],
  "Fallback link field is read-only, visible, named, selected and focused; the copy control explains manual recovery.",
  async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("denied fixture");
        }),
      },
    });
    await roomFixture();
    click("copy");
    await flush();
    const input = el<HTMLInputElement>("invite-link");
    expect(input.hidden).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute("aria-label")).toBe("招待リンク");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(el("copy").textContent).toContain("下のリンク");
  },
);
scenario(
  "lobby-readiness-warning",
  "Cautious novice friend participant",
  "Ready explains irreversibility and hands focus to the started game",
  [
    "Restore guest lobby with host ready",
    "Inspect Ready description",
    "Focus Ready",
    "Complete Ready against local playing-state fixture",
  ],
  "Ready describes irreversibility and immediate start, does not submit on restoration, and transfers focus from the hidden disabled Ready button to a visible board square when play starts.",
  async () => {
    const room = await roomFixture({
      seat: "black",
      joined: true,
      ready: { white: true, black: false },
    });
    expect(el("ready").getAttribute("aria-describedby")).toBe("ready-note");
    expect(el("ready-note").textContent).toContain("取り消せません");
    expect(el("ready-note").textContent).toContain("すぐ始まります");
    expect(
      room.fetcher.mock.calls.some(([path]) => path.endsWith("/ready")),
    ).toBe(false);
    el("ready").focus();
    room.update({ status: "playing", ready: { white: true, black: true } });
    click("ready");
    await flush();
    expect(el("lobby").hidden).toBe(true);
    expect(usableFocus().dataset.square).toBeDefined();
    expect(document.activeElement?.closest("#lobby")).toBeNull();
  },
);
