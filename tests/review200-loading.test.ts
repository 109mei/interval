// @vitest-environment jsdom
/**
 * R200-L001..R200-L060: distinct deferred-renderer lifecycle sequences.
 * Real main/controller/rules/2D DOM; only asynchronous 3D module availability,
 * unavailable GPU view and CPU Worker are controlled locally. No browser/GPU,
 * mobile, native dialog, layout, network, or physical-keyboard claim is made.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import type { BoardView } from "../src/render/board-view";
import type {
  Action,
  GameState,
  Kind,
  Preview,
  Selection,
} from "../src/game/types";

const evidence = join(tmpdir(), "interval-review200-loading-results.json");
const ledgerPath = "docs/review200/loading-cases.json";
type Row = {
  id: string;
  persona: string;
  task: string;
  precondition: string;
  sequence: string[];
  assertion: string;
  observation: string;
  change: string;
  retest: string;
  limitations: string;
};
const old: Row[] = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, "utf8"))
  : [];
const rows: Row[] = [];
function scenario(
  persona: string,
  task: string,
  sequence: string[],
  assertion: string,
  run: () => Promise<void>,
) {
  const id = `R200-L${String(rows.length + 1).padStart(3, "0")}`;
  const previous = old.find((row) => row.id === id);
  const row: Row = {
    id,
    persona,
    task,
    precondition:
      "Fresh main module and storage; 3D import held at a local promise gate until the specified completion; fetch forbidden; Worker simulated.",
    sequence,
    assertion,
    observation: previous?.observation ?? "NOT RUN",
    change: previous?.change ?? "Awaiting scenario execution.",
    retest: "NOT RUN",
    limitations:
      "Automated jsdom executes the current main.ts in memory with TypeScript/static-import plumbing stripped and only its dynamic-3D-import expression replaced by a cached gated promise; all app handlers and imported production modules remain real. The 3D boundary uses a real 2D delegate and the CPU Worker is simulated. No actual WebGL, browser layout, mobile input, native dialog or external service verification.",
  };
  rows.push(row);
  it(`${id}: ${task}`, async () => {
    try {
      await run();
      if (row.observation === "NOT RUN")
        row.observation =
          "PASS: all specified assertions passed in the initial focused local execution.";
      if (row.change.includes("Awaiting"))
        row.change =
          "No production change justified: the stated asynchronous sequence preserved the asserted state, input, focus or resource invariant.";
      row.retest =
        "PASS: all assertions passed in the latest fresh focused run.";
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.replace(/\u001b\[[0-9;]*m/g, "")
          : String(error);
      if (row.observation === "NOT RUN") row.observation = `FAIL: ${message}`;
      row.retest = `FAIL: ${message}`;
      row.change = "Failure requires diagnosis.";
      throw error;
    }
  });
}

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
const click = (id: string) => el<HTMLButtonElement>(id).click();
const square = (q: number) =>
  document.querySelector<HTMLButtonElement>(`#board [data-square="${q}"]`)!;
const choose = (kind: Kind) =>
  document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!.click();
const flush = async () => {
  for (let n = 0; n < 25; n++) await Promise.resolve();
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Snapshot = {
  state: GameState;
  selection: Selection;
  preview: Preview | null;
};
type GPU = {
  marker: HTMLElement;
  failure: () => void;
  dispose: Mock<() => void>;
  snapshots: Snapshot[];
  renderFailure: boolean;
};
let gate: ReturnType<typeof deferred>;
let imports = 0;
let attempts = 0;
let moduleSettled = false;
let rejectModule = false;
let factoryFailure = false;
let firstRenderFailure = false;
let views: GPU[] = [];
let listeners: [string, EventListenerOrEventListenerObject][] = [];
let workers: W[] = [];
class W {
  onmessage?: (e: { data: Action }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
function removeListeners() {
  for (const [name, listener] of listeners)
    document.removeEventListener(name, listener);
  listeners = [];
}
async function boot(path = "/") {
  vi.resetModules();
  gate = deferred();
  const modules: Record<string, unknown> = {
    "./app/controller": await import("../src/app/controller"),
    "./app/online": await import("../src/app/online"),
    "./render/board-targets": await import("../src/render/board-targets"),
    "./render/board2d": await import("../src/render/board2d"),
    "./render/adaptive": await import("../src/render/adaptive"),
    "./render/motion": await import("../src/render/motion"),
    "./game/rules": await import("../src/game/rules"),
    "./game/engine": await import("../src/game/engine"),
    "./ui/piece-info": await import("../src/ui/piece-info"),
    "./ui/feedback": await import("../src/ui/feedback"),
  };
  const { createBoard2D } = modules[
    "./render/board2d"
  ] as typeof import("../src/render/board2d");
  const module = {
    createBoard3D(
      host: HTMLElement,
      onSquare: (q: number) => void,
      failure: () => void,
    ): BoardView {
      attempts++;
      if (factoryFailure)
        throw Error("Locally simulated GPU construction failure");
      const marker = document.createElement("div");
      marker.dataset.simulatedGpu = String(attempts);
      host.append(marker);
      // Real 2D interaction delegate, not a claim about Three.js/GPU rendering.
      const inner = createBoard2D(marker, onSquare);
      const item: GPU = {
        marker,
        failure,
        snapshots: [],
        renderFailure: firstRenderFailure,
        dispose: vi.fn(() => {
          inner.dispose();
          marker.remove();
        }),
      };
      views.push(item);
      return {
        render(state, selection, preview, transition) {
          item.snapshots.push(structuredClone({ state, selection, preview }));
          if (item.renderFailure) {
            item.renderFailure = false;
            throw Error("Locally simulated draw failure");
          }
          inner.render(state, selection, preview, transition);
        },
        cancelMotion: () => inner.cancelMotion?.(),
        dispose: () => item.dispose(),
      };
    },
  };
  let cachedImport: Promise<typeof module> | undefined;
  const deferredBoardImport = () =>
    (cachedImport ??= (() => {
      imports++;
      return gate.promise.then(() => {
        moduleSettled = true;
        if (rejectModule)
          throw Error("Locally simulated deferred chunk failure");
        return module;
      });
    })());
  document.body.innerHTML = '<div id="app"></div>';
  document.body.className = "";
  history.replaceState(null, "", path);
  // Vitest 5 documents that concurrent imports during an async manual mock can
  // bypass the mock (requestWithMockedModule's shared callstack). Therefore read
  // the current production entry without editing it, strip types, bind its exact
  // static imports to real modules, and replace ONLY the deferred module seam.
  // All app statements, event handlers and lifecycle checks execute unchanged.
  let main = stripTypeScriptTypes(readFileSync("src/main.ts", "utf8"));
  main = main.replace('import "./ui/styles.css";', "");
  main = main.replace(
    /import\s+(\{[\s\S]*?\})\s+from\s+"([^"]+)";/g,
    (_all, names: string, path: string) => {
      if (!(path in modules)) throw Error(`Unbound production import: ${path}`);
      return `const ${names} = modules[${JSON.stringify(path)}];`;
    },
  );
  const seam = 'import("./render/board3d")';
  expect(main.split(seam)).toHaveLength(2);
  main = main.replace(seam, "deferredBoardImport()");
  new Function("modules", "deferredBoardImport", main)(
    modules,
    deferredBoardImport,
  );
  await flush();
}
function start(mode: "local" | "cpu" = "local") {
  click(`choose-${mode}`);
  click("start-game");
}
async function settle() {
  expect(imports).toBeGreaterThan(0);
  gate.resolve();
  await flush();
  expect(moduleSettled).toBe(true);
}
async function reject() {
  rejectModule = true;
  await settle();
}
function last() {
  return views.at(-1)!.snapshots.at(-1)!;
}
function ply(n: number) {
  expect(el("ply").textContent).toBe(`${n} / 200 手`);
}
function cells() {
  expect(document.querySelectorAll("#board [data-square]")).toHaveLength(49);
}
function gpu(count = 1) {
  expect(document.querySelectorAll("#board [data-simulated-gpu]")).toHaveLength(
    1,
  );
  expect(views).toHaveLength(count);
  expect(el("board-status").textContent).toBe("3D表示");
  cells();
}
function fallback() {
  expect(document.querySelector("[data-simulated-gpu]")).toBeNull();
  expect(el("board-status").textContent).toContain("2D表示");
  expect(el("view").textContent).toBe("3Dに切替");
  cells();
}
function duration(n: number) {
  while (Number(el("duration").textContent) > n) click("minus");
  while (Number(el("duration").textContent) < n) click("plus");
}
function proposal(kind: Kind = "carver", q = 14, life = 3) {
  click("summon");
  choose(kind);
  duration(life);
  square(q).click();
}
async function commit() {
  click("confirm");
  await flush();
}
async function pass() {
  click("pass");
  await commit();
}
async function summon(kind: Kind = "carver", q = 14, life = 3) {
  proposal(kind, q, life);
  await commit();
}
function focusSquare(q: number) {
  expect((document.activeElement as HTMLElement).dataset.square).toBe(
    String(q),
  );
  expect(document.querySelectorAll('#board [tabindex="0"]')).toHaveLength(1);
  expect(
    el("board").querySelector<HTMLElement>('[tabindex="0"]')!.dataset.square,
  ).toBe(String(q));
}
function latestCandidate(candidate: Action | null) {
  expect(last().selection.candidate).toEqual(candidate);
}

beforeEach(() => {
  vi.useFakeTimers();
  imports = attempts = 0;
  moduleSettled = false;
  rejectModule = factoryFailure = firstRenderFailure = false;
  views = [];
  workers = [];
  localStorage.clear();
  sessionStorage.clear();
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((n, l, o) => {
    listeners.push([n, l]);
    add(n, l, o);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("Worker", W);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Loading campaign forbids external requests");
    }),
  );
});
afterEach(async () => {
  vi.mocked(window.confirm).mockReturnValue(true);
  if (document.getElementById("home-button") && !el("home-button").hidden)
    click("home-button");
  if (gate) await settle();
  removeListeners();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = "";
});
afterAll(() => {
  expect(rows).toHaveLength(60);
  expect(new Set(rows.map((row) => row.id)).size).toBe(60);
  writeFileSync(evidence, JSON.stringify(rows, null, 2) + "\n");
});

// L001-L012: input and state advance while a single late import is pending.
scenario(
  "Impatient first-time player",
  "Triple Start retains one live upgrade and the subsequent proposal",
  [
    "Start local three times synchronously",
    "Preview carver a3",
    "Release import",
  ],
  "One upgraded board; one uncommitted carver proposal; no turn or grain spent",
  async () => {
    await boot();
    start();
    click("start-game");
    click("start-game");
    proposal();
    await settle();
    gpu();
    ply(0);
    expect(attempts).toBe(1);
    latestCandidate({ type: "summon", kind: "carver", duration: 3, to: 14 });
    expect(el("white-grain").textContent).toBe("16");
  },
);
scenario(
  "Mode-comparing beginner",
  "CPU startup switched locally before the import completes uses the final mode",
  [
    "Choose friend, local, CPU",
    "Start CPU",
    "Switch to local in menu",
    "Preview pass and release import",
  ],
  "Final local mode, pass preview and no CPU Worker survive the upgrade",
  async () => {
    await boot();
    for (const m of ["friend", "local", "cpu"]) click(`choose-${m}`);
    click("start-game");
    click("cpu");
    click("local");
    click("pass");
    await settle();
    gpu();
    latestCandidate({ type: "pass" });
    expect(el("mode-label").textContent).toBe("この端末で2人");
    expect(workers).toHaveLength(0);
    ply(0);
  },
);
scenario(
  "Fast double-clicker",
  "Repeated confirmation during loading spends and commits the summon once",
  [
    "Start local",
    "Preview leaper a3",
    "Click Confirm three times in the same task",
    "Release import",
  ],
  "Exactly one new piece, one ply, and four grain spent",
  async () => {
    await boot();
    start();
    proposal("leaper", 14, 2);
    click("confirm");
    click("confirm");
    click("confirm");
    await flush();
    await settle();
    gpu();
    ply(1);
    expect(last().state.pieces).toHaveLength(1);
    expect(last().state.grain.white).toBe(12);
    expect(last().state.pieces[0]).toMatchObject({
      kind: "leaper",
      square: 14,
      remaining: 2,
    });
  },
);
scenario(
  "Careful reviser",
  "Back then a different summon destination upgrades only the revised proposal",
  ["Preview carver a3", "Back", "Choose b3", "Release import"],
  "Only b3 remains the candidate with zero committed moves",
  async () => {
    await boot();
    start();
    proposal();
    click("back");
    square(15).click();
    await settle();
    latestCandidate({ type: "summon", kind: "carver", duration: 3, to: 15 });
    expect(document.querySelectorAll(".ghost-piece")).toHaveLength(1);
    expect(square(14).querySelector(".ghost-piece")).toBeNull();
    ply(0);
  },
);
scenario(
  "Beginner abandoning a pass",
  "Pass preview changed to a bastion proposal is current at upgrade",
  [
    "Preview pass",
    "Back",
    "Preview bastion c3 for two turns",
    "Release import",
  ],
  "Latest summon candidate replaces pass without a turn advance",
  async () => {
    await boot();
    start();
    click("pass");
    click("back");
    proposal("bastion", 16, 2);
    await settle();
    latestCandidate({ type: "summon", kind: "bastion", duration: 2, to: 16 });
    expect(el("confirm").textContent).toBe("召喚を確定");
    ply(0);
  },
);
scenario(
  "Player comparing pieces",
  "Rapid kind changes before placement retain the last kind and duration",
  [
    "Choose carver, leaper, link",
    "Set five turns and preview c3",
    "Release import",
  ],
  "Link at c3 costs five, with the exact five-turn candidate",
  async () => {
    await boot();
    start();
    click("summon");
    choose("carver");
    choose("leaper");
    choose("link");
    duration(5);
    square(16).click();
    await settle();
    latestCandidate({ type: "summon", kind: "link", duration: 5, to: 16 });
    expect(last().preview?.cost).toBe(5);
    expect(last().preview?.grainAfter).toBe(11);
  },
);
scenario(
  "Player holding duration controls",
  "Repeated lower and upper duration bounds remain legal during upgrade",
  [
    "Choose bastion",
    "Click Minus eight times then Plus eight times",
    "Preview a3",
    "Release import",
  ],
  "Five-turn cap and disabled Plus agree with the upgraded proposal",
  async () => {
    await boot();
    start();
    click("summon");
    choose("bastion");
    for (let i = 0; i < 8; i++) click("minus");
    for (let i = 0; i < 8; i++) click("plus");
    square(14).click();
    await settle();
    latestCandidate({ type: "summon", kind: "bastion", duration: 5, to: 14 });
    expect(el<HTMLButtonElement>("plus").disabled).toBe(true);
    expect(last().preview?.cost).toBe(5);
    ply(0);
  },
);
scenario(
  "Two players ending quickly",
  "Six passes before import completion upgrade the draw rather than the opening",
  ["Start local", "Confirm six passes", "Release import"],
  "Draw outcome, disabled input and six-ply position survive late upgrade",
  async () => {
    await boot();
    start();
    for (let i = 0; i < 6; i++) await pass();
    await settle();
    gpu();
    ply(6);
    expect(last().state.outcome).toEqual({ kind: "draw", reason: "passes" });
    expect(el("turn").textContent).toBe("引き分け");
    expect(el<HTMLButtonElement>("pass").disabled).toBe(true);
  },
);
scenario(
  "Two players rematching",
  "Rematch before deferred completion upgrades the replacement match",
  [
    "Reach six-pass draw",
    "Choose another game",
    "Preview leaper b3",
    "Release import",
  ],
  "Fresh session plus new leaper proposal, no stale draw outcome or history",
  async () => {
    await boot();
    start();
    for (let i = 0; i < 6; i++) await pass();
    click("again");
    proposal("leaper", 15, 2);
    await settle();
    gpu();
    ply(0);
    expect(last().state.outcome).toBeNull();
    latestCandidate({ type: "summon", kind: "leaper", duration: 2, to: 15 });
    expect(el("history").textContent).toBe("まだ指されていません。");
  },
);
scenario(
  "Player protecting a started match",
  "Declined restart during loading preserves the paid position",
  ["Summon carver a3", "Decline restart", "Release import"],
  "Existing piece and one-ply history remain; no reset",
  async () => {
    await boot();
    start();
    await summon();
    vi.mocked(window.confirm).mockReturnValue(false);
    click("restart");
    await settle();
    gpu();
    ply(1);
    expect(last().state.pieces[0]).toMatchObject({
      kind: "carver",
      square: 14,
    });
    expect(last().state.grain.white).toBe(7);
    expect(el("history").textContent).toContain("a3に召喚");
  },
);
scenario(
  "Player accepting a fresh start",
  "Accepted restart clears old pieces before a late upgrade",
  ["Summon carver a3", "Accept restart", "Preview pass", "Release import"],
  "Opening resources and zero pieces replace the abandoned position",
  async () => {
    await boot();
    start();
    await summon();
    click("restart");
    click("pass");
    await settle();
    gpu();
    ply(0);
    expect(last().state.pieces).toHaveLength(0);
    expect(last().state.grain.white).toBe(16);
    latestCandidate({ type: "pass" });
  },
);
scenario(
  "Solo player with slow graphics",
  "CPU reply received before graphics loading upgrades both committed turns",
  [
    "Start CPU and pass",
    "Advance Worker launch",
    "Deliver legal black summon",
    "Release import",
  ],
  "Two plies, white turn and CPU piece appear once with unlocked input",
  async () => {
    await boot();
    start("cpu");
    await pass();
    await vi.advanceTimersByTimeAsync(301);
    expect(workers).toHaveLength(1);
    workers[0].onmessage!({
      data: { type: "summon", kind: "bastion", to: 28, duration: 2 },
    });
    await flush();
    await settle();
    gpu();
    ply(2);
    expect(last().state.turn).toBe("white");
    expect(last().state.pieces[0]).toMatchObject({
      side: "black",
      square: 28,
      remaining: 2,
    });
    expect(el<HTMLButtonElement>("summon").disabled).toBe(false);
  },
);

// L013-L024: outstanding work crosses home, display generations and CPU sessions.
scenario(
  "Frequently interrupted player",
  "Two home-resume cycles before completion mount only the current generation",
  ["Summon one piece", "Home, resume, home, resume", "Release import"],
  "One upgraded renderer and the original paid one-ply position",
  async () => {
    await boot();
    start();
    await summon();
    for (let i = 0; i < 2; i++) {
      click("home-button");
      click("resume-game");
    }
    await settle();
    gpu();
    expect(attempts).toBe(1);
    ply(1);
    expect(last().state.pieces).toHaveLength(1);
  },
);
scenario(
  "Player choosing lighter graphics at home",
  "Home changes to 2D and resumes before the old import resolves",
  [
    "Summon a piece",
    "Home",
    "Choose 2D in settings",
    "Resume and release old import",
  ],
  "Exact resumed 2D position and explicit 2D status with no GPU construction",
  async () => {
    await boot();
    start();
    await summon();
    click("home-button");
    click("view");
    click("resume-game");
    await settle();
    fallback();
    expect(attempts).toBe(0);
    ply(1);
    expect(square(14).getAttribute("aria-label")).toContain("カーヴァー");
  },
);
scenario(
  "Player switching opponents at home",
  "A new CPU match at home supersedes a pending local match load",
  ["Advance local game", "Home, choose CPU, start new game", "Release import"],
  "CPU opening replaces old local progress, without starting a black Worker",
  async () => {
    await boot();
    start();
    await summon();
    click("home-button");
    start("cpu");
    await settle();
    gpu();
    ply(0);
    expect(last().state.pieces).toHaveLength(0);
    expect(el("mode-label").textContent).toContain("CPU対戦");
    expect(workers).toHaveLength(0);
  },
);
scenario(
  "Player declining a replacement match",
  "Declined home replacement followed by resume upgrades the preserved local match",
  [
    "Summon locally and go home",
    "Choose CPU, decline new game",
    "Resume original and release import",
  ],
  "Local mode, paid piece and one ply survive the declined replacement",
  async () => {
    await boot();
    start();
    await summon();
    click("home-button");
    click("choose-cpu");
    vi.mocked(window.confirm).mockReturnValue(false);
    click("start-game");
    expect(el("home").hidden).toBe(false);
    click("resume-game");
    await settle();
    gpu();
    ply(1);
    expect(el("mode-label").textContent).toBe("この端末で2人");
    expect(last().state.pieces).toHaveLength(1);
  },
);
scenario(
  "Rules reader changing the next mode",
  "Choosing local through home rules cannot mount a late renderer until Start",
  [
    "Start CPU then home",
    "Open rules and choose local",
    "Release import at home",
    "Start local",
  ],
  "No hidden GPU at home; one renderer mounts only for the later deliberate start",
  async () => {
    await boot();
    start("cpu");
    click("home-button");
    click("home-rules");
    click("local");
    await settle();
    expect(attempts).toBe(0);
    expect(el("board").childElementCount).toBe(0);
    click("start-game");
    gpu();
    ply(0);
    expect(el("mode-label").textContent).toBe("この端末で2人");
  },
);
scenario(
  "Player testing display preferences",
  "Off-on preference changes at home cache loading without mounting hidden graphics",
  ["Start then home", "Toggle 2D then 3D", "Release import", "Resume"],
  "No GPU while home; cached factory creates one board on resume",
  async () => {
    await boot();
    start();
    click("home-button");
    click("view");
    click("view");
    await settle();
    expect(attempts).toBe(0);
    expect(el("board").childElementCount).toBe(0);
    click("resume-game");
    gpu();
    expect(imports).toBe(1);
  },
);
scenario(
  "Player rapidly comparing views",
  "Four in-flight display toggles preserve one current upgrade and candidate",
  ["Preview link a3", "Toggle 2D,3D,2D,3D", "Release import"],
  "Only latest generation mounts; exact uncommitted link proposal survives",
  async () => {
    await boot();
    start();
    proposal("link", 14, 4);
    for (let i = 0; i < 4; i++) click("view");
    await settle();
    gpu();
    expect(attempts).toBe(1);
    latestCandidate({ type: "summon", kind: "link", duration: 4, to: 14 });
    ply(0);
  },
);
scenario(
  "Embedding host replacing its content",
  "Detached provisional host rejects the late renderer mount",
  [
    "Start and retain old host reference",
    "Detach board host",
    "Release import",
    "Restore host",
  ],
  "Disconnected host receives no GPU or replacement state",
  async () => {
    await boot();
    start();
    const host = el("board");
    const parent = host.parentElement!;
    host.remove();
    await settle();
    expect(attempts).toBe(0);
    expect(host.querySelector("[data-simulated-gpu]")).toBeNull();
    parent.append(host);
    cells();
  },
);
scenario(
  "Embedding shell refreshing a board slot",
  "Same-id replacement host cannot be targeted by the old import callback",
  [
    "Start and replace board node with same-id clone",
    "Release import",
    "Restore original node for cleanup",
  ],
  "No GPU mounts in a new same-id host owned by a different generation",
  async () => {
    await boot();
    start();
    const oldHost = el("board");
    const replacement = document.createElement("div");
    replacement.id = "board";
    oldHost.replaceWith(replacement);
    await settle();
    expect(attempts).toBe(0);
    expect(replacement.childElementCount).toBe(0);
    replacement.replaceWith(oldHost);
  },
);
scenario(
  "Player browsing friend setup",
  "A late result at home cannot mount under the unopened friend match",
  ["Start local, home", "Release import", "Choose friend and open dialog"],
  "Home remains board-free, friend dialog opens, no request or renderer is created",
  async () => {
    await boot();
    start();
    click("home-button");
    await settle();
    click("choose-friend");
    click("start-game");
    expect(el("friend-dialog").hasAttribute("open")).toBe(true);
    expect(el("home").hidden).toBe(false);
    expect(el("board").childElementCount).toBe(0);
    expect(attempts).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  },
);
scenario(
  "Solo player interrupted before CPU search",
  "Home pauses CPU timing while the module resolves then resume starts one search",
  [
    "CPU pass",
    "Home before 300ms",
    "Release import and advance one second",
    "Resume and advance 301ms",
  ],
  "No hidden Worker/renderer before resume; one search and one renderer afterward",
  async () => {
    await boot();
    start("cpu");
    await pass();
    click("home-button");
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(workers).toHaveLength(0);
    expect(attempts).toBe(0);
    click("resume-game");
    await vi.advanceTimersByTimeAsync(301);
    gpu();
    expect(workers).toHaveLength(1);
    ply(1);
  },
);
scenario(
  "Solo player changing games during search",
  "Stale CPU completion cannot overwrite a replacement local session before upgrade",
  [
    "Start CPU, pass and launch Worker",
    "Home then start local",
    "Deliver old Worker response",
    "Release import",
  ],
  "Old Worker is terminated; local opening remains zero ply and empty",
  async () => {
    await boot();
    start("cpu");
    await pass();
    await vi.advanceTimersByTimeAsync(301);
    const stale = workers[0];
    click("home-button");
    start();
    stale.onmessage!({
      data: { type: "summon", kind: "bastion", to: 28, duration: 1 },
    });
    await flush();
    await settle();
    gpu();
    expect(stale.terminate).toHaveBeenCalledTimes(1);
    ply(0);
    expect(last().state.pieces).toHaveLength(0);
    expect(el("mode-label").textContent).toBe("この端末で2人");
  },
);

// L025-L036: focus and retained selection across the precise asynchronous swap.
scenario(
  "Keyboard-only explorer",
  "Arrow navigation before upgrade preserves the new square and next arrow origin",
  ["Focus a3 then ArrowUp", "Release import", "ArrowRight"],
  "Focus is a4 after replacement, then b4 with one roving tab stop",
  async () => {
    await boot();
    start();
    square(14).focus();
    square(14).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    await settle();
    focusSquare(21);
    square(21).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    focusSquare(22);
  },
);
scenario(
  "Keyboard user returning from controls",
  "Inactive board tab stop survives upgrade without stealing a control's focus",
  ["Focus e3 on board", "Move focus to Summon", "Release import"],
  "Summon retains focus and e3 remains the sole board entry point",
  async () => {
    await boot();
    start();
    square(18).focus();
    el("summon").focus();
    await settle();
    expect(document.activeElement).toBe(el("summon"));
    expect(
      el("board").querySelector<HTMLElement>('[tabindex="0"]')!.dataset.square,
    ).toBe("18");
    expect(el("board").querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  },
);
scenario(
  "Keyboard user reviewing a purchase",
  "Upgrade leaves focused Confirm attached to the same pending purchase",
  ["Preview bastion c3", "Focus Confirm", "Release import", "Confirm"],
  "Focus is not stolen; candidate commits exactly once after replacement",
  async () => {
    await boot();
    start();
    proposal("bastion", 16, 4);
    el("confirm").focus();
    await settle();
    expect(document.activeElement).toBe(el("confirm"));
    latestCandidate({ type: "summon", kind: "bastion", duration: 4, to: 16 });
    await commit();
    ply(1);
    expect(last().state.pieces).toHaveLength(1);
  },
);
scenario(
  "Keyboard user reading settings",
  "Upgrade while settings are open leaves focus on the chosen quality control",
  ["Focus d4 then open menu", "Focus Quality and enable it", "Release import"],
  "Drawer stays open, Quality stays focused and pressed, board entry remains d4",
  async () => {
    await boot();
    start();
    square(24).focus();
    click("menu");
    el("quality").focus();
    click("quality");
    await settle();
    expect(el("drawer").hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(el("quality"));
    expect(el("quality").getAttribute("aria-pressed")).toBe("true");
    expect(
      el("board").querySelector<HTMLElement>('[tabindex="0"]')!.dataset.square,
    ).toBe("24");
  },
);
scenario(
  "Keyboard user considering a friend",
  "Friend dialog focus remains in the dialog when a local board upgrades",
  ["Start local then open friend dialog", "Focus Close", "Release import"],
  "Dialog and focused Close persist; no room network request occurs",
  async () => {
    await boot();
    start();
    click("friend");
    el("close-friend").focus();
    await settle();
    gpu();
    expect(el("friend-dialog").hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(el("close-friend"));
    expect(fetch).not.toHaveBeenCalled();
  },
);
scenario(
  "Keyboard user declining navigation",
  "Declined Home keeps the focused square available for the late upgrade",
  ["Focus g3", "Decline Home confirmation", "Release import"],
  "Game remains visible with g3 focused and no session reset",
  async () => {
    await boot();
    start();
    square(20).focus();
    vi.mocked(window.confirm).mockReturnValue(false);
    click("home-button");
    await settle();
    gpu();
    focusSquare(20);
    expect(el("arena").hidden).toBe(false);
    ply(0);
  },
);
scenario(
  "Keyboard user choosing placement",
  "Kind selection's placement focus and summon overlay survive upgrade",
  [
    "Open Summon and choose leaper",
    "Capture automatically focused legal placement",
    "Release import",
  ],
  "Same available square is focused, same duration and no candidate is falsely committed",
  async () => {
    await boot();
    start();
    click("summon");
    choose("leaper");
    const q = Number((document.activeElement as HTMLElement).dataset.square);
    expect(Number.isInteger(q)).toBe(true);
    expect(square(q).dataset.available).toBe("true");
    await settle();
    focusSquare(q);
    expect(square(q).dataset.available).toBe("true");
    expect(last().selection.summon).toEqual({ kind: "leaper", duration: 3 });
    latestCandidate(null);
    ply(0);
  },
);
scenario(
  "Keyboard user cancelling a plan",
  "Cancelled purchase leaves focus on Summon and no ghost on late upgrade",
  ["Preview link b3", "Cancel", "Release import"],
  "Summon focus remains; selection, candidate and ghost are cleared",
  async () => {
    await boot();
    start();
    proposal("link", 15, 3);
    click("cancel");
    await settle();
    expect(document.activeElement).toBe(el("summon"));
    latestCandidate(null);
    expect(last().selection.summon).toBeNull();
    expect(document.querySelector(".ghost-piece")).toBeNull();
  },
);
scenario(
  "Keyboard user inspecting the opponent",
  "Opponent inspection survives upgrade with focus and non-actionable reference markers",
  [
    "White summons carver, black summons leaper",
    "Inspect black leaper and focus a5",
    "Release import",
  ],
  "Exact selected black piece remains inspect-only and Confirm stays unavailable",
  async () => {
    await boot();
    start();
    await summon();
    await summon("leaper", 28, 2);
    square(28).click();
    square(28).focus();
    await settle();
    focusSquare(28);
    expect(last().selection.inspectOnly).toBe(true);
    expect(last().selection.pieceId).toBe(
      last().state.pieces.find((p) => p.side === "black")!.id,
    );
    expect(el<HTMLButtonElement>("confirm").disabled).toBe(true);
    ply(2);
  },
);
scenario(
  "Keyboard user changing duration in place",
  "Changing duration clears a stale candidate without resetting board focus on upgrade",
  [
    "Preview carver c3 for three turns",
    "Focus c3",
    "Increase duration",
    "Release import",
  ],
  "c3 keeps focus; duration four is preserved and old candidate is invalidated",
  async () => {
    await boot();
    start();
    proposal("carver", 16, 3);
    square(16).focus();
    click("plus");
    await settle();
    focusSquare(16);
    latestCandidate(null);
    expect(last().selection.summon).toEqual({ kind: "carver", duration: 4 });
    expect(el("confirm-row").hidden).toBe(true);
  },
);
scenario(
  "Motion-sensitive keyboard player",
  "Reducing motion mid-transition before upgrade keeps focus and clears transient effects",
  [
    "Commit carver summon",
    "Focus f3 and enable reduced motion",
    "Release import",
  ],
  "Latest position, f3 focus and reduced-motion preference persist without old moving nodes",
  async () => {
    await boot();
    start();
    await summon();
    square(19).focus();
    click("motion");
    await settle();
    focusSquare(19);
    expect(document.body.classList.contains("no-motion")).toBe(true);
    expect(el("motion").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".moving-piece")).toBeNull();
    ply(1);
  },
);
scenario(
  "Keyboard player without a GPU",
  "Construction failure at upgrade restores focus into the replacement 2D board",
  [
    "Preview bastion c3",
    "Focus c3",
    "Make GPU constructor throw",
    "Release import",
  ],
  "Fallback keeps c3 focus and the exact confirmable proposal",
  async () => {
    await boot();
    start();
    proposal("bastion", 16, 2);
    square(16).focus();
    factoryFailure = true;
    await settle();
    fallback();
    focusSquare(16);
    expect(el<HTMLButtonElement>("confirm").disabled).toBe(false);
    expect(square(16).querySelector(".ghost-piece")).not.toBeNull();
    ply(0);
  },
);

// L037-L048: module and renderer failures, retry, and stale failure callbacks.
scenario(
  "Player on a failing chunk connection",
  "Rejected chunk retains a pending purchase which can still be committed",
  ["Preview leaper b3 for two turns", "Reject module", "Confirm in fallback"],
  "Fallback preserves proposal, then commits one piece with correct price",
  async () => {
    await boot();
    start();
    proposal("leaper", 15, 2);
    await reject();
    fallback();
    expect(el("board-status").textContent).toContain("読み込めない");
    expect(el<HTMLButtonElement>("confirm").disabled).toBe(false);
    await commit();
    ply(1);
    expect(square(15).getAttribute("aria-label")).toContain(
      "リーパー 残り2ターン",
    );
    expect(el("white-grain").textContent).toBe("12");
  },
);
scenario(
  "Interrupted player on a failing connection",
  "Chunk rejection at home leaves the match resumable and retry failure truthful",
  ["Summon then home", "Reject module at home", "Resume and settle retry"],
  "No hidden GPU, preserved paid position, and a truthful 2D error after resume",
  async () => {
    await boot();
    start();
    await summon();
    click("home-button");
    await reject();
    expect(attempts).toBe(0);
    expect(el("board").childElementCount).toBe(0);
    click("resume-game");
    await flush();
    fallback();
    ply(1);
    expect(square(14).getAttribute("aria-label")).toContain("カーヴァー");
  },
);
scenario(
  "Player who explicitly chose 2D",
  "Obsolete chunk rejection cannot replace explicit 2D status or selection",
  ["Preview link c3", "Choose 2D", "Reject old module"],
  "Exact explicit 2D caption, proposal and zero GPU attempts remain",
  async () => {
    await boot();
    start();
    proposal("link", 16, 2);
    click("view");
    await reject();
    fallback();
    expect(el("board-status").textContent).toBe("2D表示");
    expect(el("confirm-row").hidden).toBe(false);
    expect(square(16).querySelector(".ghost-piece")).not.toBeNull();
    expect(attempts).toBe(0);
  },
);
scenario(
  "Player retrying before failure arrives",
  "Only the latest of overlapping display requests reports the rejected chunk",
  ["Commit pass", "Toggle 2D then 3D while loading", "Reject shared module"],
  "Latest failure gives one usable 49-cell fallback at one ply",
  async () => {
    await boot();
    start();
    await pass();
    click("view");
    click("view");
    await reject();
    fallback();
    expect(el("board-status").textContent).toContain("読み込めない");
    expect(attempts).toBe(0);
    ply(1);
    click("pass");
    expect(el<HTMLButtonElement>("confirm").disabled).toBe(false);
  },
);
scenario(
  "Persistent player on a broken connection",
  "Repeated manual retries of a rejected module preserve the paid board and input",
  [
    "Summon bastion",
    "Reject module",
    "Request 3D twice after each failure",
    "Preview pass",
  ],
  "Each retry returns to a truthful fallback without spending or duplicating pieces",
  async () => {
    await boot();
    start();
    await summon("bastion", 14, 2);
    await reject();
    for (let i = 0; i < 2; i++) {
      click("view");
      await flush();
      fallback();
    }
    ply(1);
    expect(document.querySelectorAll("#board [data-piece-id]")).toHaveLength(1);
    click("pass");
    expect(el("confirm").textContent).toBe("パスを確定");
    expect(attempts).toBe(0);
  },
);
scenario(
  "Player with unavailable graphics hardware",
  "Constructor failure retains both committed state and the next-side proposal",
  [
    "White summons carver",
    "Black previews bastion a5",
    "Fail GPU construction on release",
  ],
  "Existing white piece and black ghost coexist correctly with current resources",
  async () => {
    await boot();
    start();
    await summon();
    proposal("bastion", 28, 2);
    factoryFailure = true;
    await settle();
    fallback();
    ply(1);
    expect(square(14).getAttribute("aria-label")).toContain("白 カーヴァー");
    expect(square(28).querySelector(".ghost-piece.black")).not.toBeNull();
    expect(el("black-grain").textContent).toBe("16");
    expect(el<HTMLButtonElement>("confirm").disabled).toBe(false);
  },
);
scenario(
  "Player hitting the first draw failure",
  "First upgraded render exception disposes partial graphics and keeps the proposal",
  [
    "Preview carver a3",
    "Throw on upgraded renderer's first draw",
    "Release import",
  ],
  "One disposal and a complete playable fallback with unchanged candidate and grain",
  async () => {
    await boot();
    start();
    proposal();
    firstRenderFailure = true;
    await settle();
    fallback();
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
    expect(square(14).querySelector(".ghost-piece")).not.toBeNull();
    expect(el("white-grain").textContent).toBe("16");
    expect(el<HTMLButtonElement>("confirm").disabled).toBe(false);
  },
);
scenario(
  "Player whose GPU fails on a later turn",
  "Draw exception during a committed action falls back to the new state",
  [
    "Load graphics",
    "Preview bastion a3",
    "Throw on the next render and confirm",
  ],
  "Fallback shows committed new state, not the pre-confirm preview",
  async () => {
    await boot();
    start();
    await settle();
    proposal("bastion", 14, 2);
    views[0].renderFailure = true;
    await commit();
    fallback();
    ply(1);
    expect(square(14).getAttribute("aria-label")).toContain("残り2ターン");
    expect(document.querySelector(".ghost-piece")).toBeNull();
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
    expect(el("turn").textContent).toBe("黒の手番");
  },
);
scenario(
  "Keyboard player during GPU context loss",
  "Runtime graphics loss preserves board focus or an external menu focus without duplicate disposal",
  [
    "Load graphics, focus e3 and signal context failure twice",
    "Retry GPU, focus d4 then focus Quality in the menu",
    "Signal second renderer failure twice",
  ],
  "First fallback restores e3 focus; second retains external Quality focus and d4 tab entry; each renderer disposes once",
  async () => {
    await boot();
    start();
    await settle();
    square(18).focus();
    views[0].failure();
    views[0].failure();
    fallback();
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
    focusSquare(18);
    click("view");
    gpu(2);
    square(24).focus();
    click("menu");
    el("quality").focus();
    views[1].failure();
    views[1].failure();
    fallback();
    expect(document.activeElement).toBe(el("quality"));
    expect(el("drawer").hasAttribute("open")).toBe(true);
    expect(
      el("board").querySelector<HTMLElement>('[tabindex="0"]')!.dataset.square,
    ).toBe("24");
    expect(el("board").querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(views[1].dispose).toHaveBeenCalledTimes(1);
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
  },
);
scenario(
  "Player switching to the stable display",
  "Old graphics failure after switching to 2D cannot wipe the new candidate",
  [
    "Load graphics",
    "Switch to 2D and preview link c3",
    "Deliver stale graphics-failure callback",
  ],
  "Replacement 2D nodes and candidate are unchanged; old graphics disposes once",
  async () => {
    await boot();
    start();
    await settle();
    const oldView = views[0];
    click("view");
    proposal("link", 16, 2);
    const node = square(16);
    oldView.failure();
    fallback();
    expect(square(16)).toBe(node);
    expect(square(16).querySelector(".ghost-piece")).not.toBeNull();
    expect(oldView.dispose).toHaveBeenCalledTimes(1);
    expect(el("board-status").textContent).toBe("2D表示");
  },
);
scenario(
  "Player who already returned home",
  "Delayed graphics failure at home cannot recreate a hidden board or change navigation",
  [
    "Load graphics and commit a summon",
    "Return home",
    "Deliver old graphics-failure callback",
  ],
  "Home stays board-free and focused Resume remains connected with one disposal",
  async () => {
    await boot();
    start();
    await settle();
    await summon();
    const oldView = views[0];
    click("home-button");
    oldView.failure();
    expect(el("board").childElementCount).toBe(0);
    expect(document.activeElement).toBe(el("resume-game"));
    expect(el("home").hidden).toBe(false);
    expect(oldView.dispose).toHaveBeenCalledTimes(1);
  },
);
scenario(
  "Player retrying recovered hardware",
  "A successful manual retry after constructor failure preserves the current preview",
  [
    "Fail GPU construction during upgrade",
    "Preview link b3 in fallback",
    "Allow construction and request 3D",
  ],
  "Retry mounts one live GPU at the exact uncommitted fallback proposal",
  async () => {
    await boot();
    start();
    factoryFailure = true;
    await settle();
    fallback();
    proposal("link", 15, 4);
    factoryFailure = false;
    click("view");
    gpu();
    expect(attempts).toBe(2);
    latestCandidate({ type: "summon", kind: "link", duration: 4, to: 15 });
    expect(last().preview?.cost).toBe(4);
    ply(0);
  },
);

// L049-L060: post-load cleanup combined with subsequent sessions and retries.
scenario(
  "Player resuming after a successful upgrade",
  "Home-resume after upgrade disposes the old view once and reuses the loaded module",
  ["Load graphics and summon", "Home then resume", "Deliver old view failure"],
  "One fresh live view at retained state; old callback cannot downgrade it",
  async () => {
    await boot();
    start();
    await settle();
    await summon();
    const oldView = views[0];
    click("home-button");
    click("resume-game");
    oldView.failure();
    gpu(2);
    expect(oldView.dispose).toHaveBeenCalledTimes(1);
    expect(imports).toBe(1);
    expect(views[1].dispose).not.toHaveBeenCalled();
    ply(1);
    expect(last().state.pieces).toHaveLength(1);
  },
);
scenario(
  "Player playing between display changes",
  "A move committed in 2D between loaded 3D sessions appears in the next 3D view",
  ["Load graphics", "Switch to 2D and summon", "Switch back to 3D"],
  "Second view receives committed piece and one ply; first is disposed once",
  async () => {
    await boot();
    start();
    await settle();
    click("view");
    await summon("leaper", 16, 2);
    click("view");
    gpu(2);
    ply(1);
    expect(last().state.pieces[0]).toMatchObject({
      kind: "leaper",
      square: 16,
    });
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
    expect(imports).toBe(1);
  },
);
scenario(
  "Player exiting during summon motion",
  "Home during provisional summon motion cleans resources before a late import resolves",
  [
    "Summon with loading pending",
    "Go home before motion completion",
    "Release import and advance timers",
  ],
  "No hidden GPU, transient effect, motion timer or residual board survives",
  async () => {
    await boot();
    start();
    await summon();
    click("home-button");
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(el("board").childElementCount).toBe(0);
    expect(document.querySelector(".moving-piece, .board-effects")).toBeNull();
    expect(attempts).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
scenario(
  "Player changing display during provisional motion",
  "Switching to explicit 2D during an animated summon cancels old effects before late resolution",
  [
    "Summon while loading",
    "Select 2D immediately",
    "Release stale module and advance timers",
  ],
  "New 2D board retains the piece without inherited motion nodes or GPU mount",
  async () => {
    await boot();
    start();
    await summon();
    click("view");
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    fallback();
    ply(1);
    expect(square(14).getAttribute("aria-label")).toContain("カーヴァー");
    expect(document.querySelector(".moving-piece, .action-cue")).toBeNull();
    expect(attempts).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
scenario(
  "Player changing two display preferences",
  "Quality and motion changes during loading do not start a second importer or replay the last move",
  [
    "Summon while loading",
    "Enable quality and reduced motion",
    "Release import",
    "Return home",
  ],
  "Both settings survive one upgrade, no replayed effects, complete cleanup on home",
  async () => {
    await boot();
    start();
    await summon();
    click("quality");
    click("motion");
    await settle();
    gpu();
    expect(imports).toBe(1);
    expect(document.body.classList.contains("low-quality")).toBe(true);
    expect(document.body.classList.contains("no-motion")).toBe(true);
    expect(document.querySelector(".moving-piece, .action-cue")).toBeNull();
    click("home-button");
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
scenario(
  "Players viewing an ended game later",
  "Draw then home before completion resumes only the final result after loading",
  [
    "Reach six-pass draw",
    "Return home without confirmation",
    "Release import",
    "Resume ended match",
  ],
  "No GPU at home; resumed GPU shows draw with disabled move controls",
  async () => {
    await boot();
    start();
    for (let i = 0; i < 6; i++) await pass();
    vi.mocked(window.confirm).mockClear();
    click("home-button");
    expect(window.confirm).not.toHaveBeenCalled();
    await settle();
    expect(attempts).toBe(0);
    click("resume-game");
    gpu();
    ply(6);
    expect(last().state.outcome).toEqual({ kind: "draw", reason: "passes" });
    expect(el<HTMLButtonElement>("summon").disabled).toBe(true);
  },
);
scenario(
  "Solo player switching modes mid-search",
  "In-game local reset terminates pending CPU search before the graphics upgrade",
  [
    "CPU pass and launch Worker",
    "Switch local and accept reset",
    "Deliver stale error",
    "Release import",
  ],
  "No fallback search or old action runs; local opening upgrades once",
  async () => {
    await boot();
    start("cpu");
    await pass();
    await vi.advanceTimersByTimeAsync(301);
    const oldWorker = workers[0];
    click("local");
    oldWorker.onerror!();
    await flush();
    await settle();
    gpu();
    ply(0);
    expect(oldWorker.terminate).toHaveBeenCalledTimes(1);
    expect(last().state.pieces).toHaveLength(0);
    expect(el("mode-label").textContent).toBe("この端末で2人");
  },
);
scenario(
  "Player resuming after context loss",
  "Fallback preference persists through home and resume until an explicit GPU retry",
  [
    "Load graphics then lose context",
    "Commit bastion in fallback",
    "Home, resume, then explicitly retry 3D",
  ],
  "Resume stays 2D at the exact state; only explicit retry constructs another GPU",
  async () => {
    await boot();
    start();
    await settle();
    views[0].failure();
    await summon("bastion", 14, 2);
    click("home-button");
    click("resume-game");
    fallback();
    expect(attempts).toBe(1);
    ply(1);
    click("view");
    gpu(2);
    expect(last().state.pieces[0]).toMatchObject({ square: 14, remaining: 2 });
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
  },
);
scenario(
  "Player recovering a failed frame",
  "Candidate chosen after draw failure is retained through immediate GPU retry",
  [
    "Load graphics",
    "Force render error on Quality change",
    "Preview carver c3 in fallback",
    "Retry GPU",
  ],
  "Second view receives fallback candidate and old failed renderer stays disposed",
  async () => {
    await boot();
    start();
    await settle();
    views[0].renderFailure = true;
    click("quality");
    fallback();
    proposal("carver", 16, 2);
    click("view");
    gpu(2);
    latestCandidate({ type: "summon", kind: "carver", duration: 2, to: 16 });
    expect(last().preview?.cost).toBe(6);
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
  },
);
scenario(
  "Impatient solo player resuming twice",
  "Double Resume during a pending import restarts the paused CPU search only once",
  [
    "CPU pass then home",
    "Activate Resume twice",
    "Advance 301ms then release import",
  ],
  "One Worker and one GPU with one-ply black turn; no duplicate CPU job",
  async () => {
    await boot();
    start("cpu");
    await pass();
    click("home-button");
    click("resume-game");
    click("resume-game");
    await vi.advanceTimersByTimeAsync(301);
    await settle();
    gpu();
    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    expect(last().state.turn).toBe("black");
    ply(1);
  },
);
scenario(
  "Player repeatedly testing settings",
  "Settings churn while importing leaves one live board and fully releases it at home",
  [
    "Preview link a3",
    "Toggle quality six times and motion five times",
    "Release import and go home",
  ],
  "Final setting parity and proposal are correct; all view resources and timers release",
  async () => {
    await boot();
    start();
    proposal("link", 14, 2);
    for (let i = 0; i < 6; i++) click("quality");
    for (let i = 0; i < 5; i++) click("motion");
    await settle();
    gpu();
    latestCandidate({ type: "summon", kind: "link", duration: 2, to: 14 });
    expect(el("quality").getAttribute("aria-pressed")).toBe("false");
    expect(el("motion").getAttribute("aria-pressed")).toBe("true");
    click("home-button");
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
    expect(el("board").childElementCount).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
scenario(
  "Solo player continuing after persistent load failure",
  "Failed retry followed by a new 2D CPU game keeps failure callbacks out of the new session",
  [
    "Reject module and retry once",
    "Go home and start CPU with fallback preference",
    "Pass and complete CPU Worker",
  ],
  "CPU game advances two plies in explicit 2D with no GPU attempts or stale loading state",
  async () => {
    await boot();
    start();
    await reject();
    click("view");
    await flush();
    fallback();
    click("home-button");
    start("cpu");
    fallback();
    expect(el("board-status").textContent).toBe("2D表示");
    await pass();
    await vi.advanceTimersByTimeAsync(301);
    workers[0].onmessage!({
      data: { type: "summon", kind: "bastion", to: 28, duration: 1 },
    });
    await flush();
    ply(2);
    fallback();
    expect(attempts).toBe(0);
    expect(square(28).getAttribute("aria-label")).toContain("黒 バスティオン");
  },
);
