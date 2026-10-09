// @vitest-environment jsdom
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";

// 100 distinct automated entry/short-interaction/continuation scenarios.
// DOM behavior, injected workers and fake time are not real browser/phone tests.
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
const click = (id: string) => el<HTMLButtonElement>(id).click();
const square = (q: number) =>
  document.querySelector<HTMLButtonElement>(`[data-square="${q}"]`)!;
const choose = (kind: string) =>
  document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!.click();
const flush = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};
let listeners: [string, EventListenerOrEventListenerObject][] = [];
let workers: W[] = [];
class W {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
function removeListeners() {
  for (const [n, l] of listeners) document.removeEventListener(n, l);
  listeners = [];
}
async function boot(path = "/?2d") {
  removeListeners();
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  document.body.className = "";
  history.replaceState(null, "", path);
  await import("../src/main");
  await flush();
}
function start(mode = "local") {
  click("choose-" + mode);
  click("start-game");
}
function duration(n: number) {
  while (Number(el("duration").textContent) > n) click("minus");
  while (Number(el("duration").textContent) < n) click("plus");
}
function proposal(k = "bastion", q = 14, life = 3) {
  click("summon");
  choose(k);
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
function expectPly(n: number) {
  expect(el("ply").textContent).toBe(`${n} / 200 手`);
}
function neutral() {
  expect(el("home").hidden).toBe(false);
  expect(el("arena").hidden).toBe(true);
  expect(el<HTMLButtonElement>("start-game").disabled).toBe(true);
  expect(document.querySelector("[data-square]")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(workers).toHaveLength(0);
}
function active() {
  expect(el("home").hidden).toBe(true);
  expect(el("arena").hidden).toBe(false);
  expect(el<HTMLButtonElement>("summon").disabled).toBe(false);
}
function cleared() {
  expect(el("confirm-row").hidden).toBe(true);
  expect(document.querySelector(".ghost-piece")).toBeNull();
}
const cases: Record<string, unknown>[] = [];
function scenario(
  category: string,
  persona: string,
  title: string,
  sequence: string[],
  expected: string,
  run: () => Promise<void> | void,
) {
  const id = `F${String(cases.length + 1).padStart(3, "0")}`;
  const row: Record<string, unknown> = {
    id,
    category,
    persona,
    title,
    sequence,
    expected,
    baselineObservation: "not run",
    finding: null,
    fixOrNoChange: "Awaiting execution",
    retest: "not run",
    limitations:
      "Automated real-main jsdom, fake time and injected Worker. No GPU, actual browser layout, phone touch, native dialog or human-study evidence.",
  };
  cases.push(row);
  it(`${id}: ${title}`, async () => {
    try {
      await run();
      row.baselineObservation =
        "All scenario assertions passed against the inspected local source.";
      row.fixOrNoChange = "No production change justified by this scenario.";
      row.retest = "pass";
    } catch (e) {
      row.baselineObservation = String(e);
      row.finding = String(e);
      row.fixOrNoChange =
        "Investigate failing observation before classifying product vs fixture.";
      row.retest = "fail";
      throw e;
    }
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  workers = [];
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
      throw Error("This flow campaign forbids real network");
    }),
  );
});
afterEach(() => {
  const h = document.getElementById("home-button");
  if (h && !h.hidden) {
    vi.mocked(window.confirm).mockReturnValue(true);
    h.click();
  }
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
  expect(cases).toHaveLength(100);
  writeFileSync(
    join(tmpdir(), "interval-review500-flow-results.json"),
    JSON.stringify(cases, null, 2),
  );
});

const coldCases = [
  {
    name: "literal fresh URL keeps WebGL and CPU construction deferred",
    path: "/",
    view: "2Dに切替",
  },
  {
    name: "2D entry chooses the truthful retry direction without mounting a board",
    path: "/?2d",
    view: "3Dに切替",
  },
  {
    name: "unrecognized CPU query never grants automatic start",
    path: "/?2d&cpu=true",
    view: "3Dに切替",
  },
  {
    name: "unrelated fragment never acts as a friend invitation",
    path: "/?2d#help",
    view: "3Dに切替",
  },
  {
    name: "short invalid room ID cannot start recovery",
    path: "/?2d&room=abc",
    view: "3Dに切替",
  },
  {
    name: "uppercase noncanonical room ID cannot start recovery",
    path: "/?2d&room=" + "A".repeat(32),
    view: "3Dに切替",
  },
];
for (const c of coldCases)
  scenario(
    "fresh entry",
    "Nao, first visitor",
    c.name,
    [`Open ${c.path}`, "Advance 10 seconds without Start"],
    "Neutral home, no board/Worker/network; correct display-switch caption",
    async () => {
      await boot(c.path);
      await vi.advanceTimersByTimeAsync(10000);
      neutral();
      expect(el("view").textContent).toBe(c.view);
    },
  );
for (const [name, saved, q, m] of [
  ["lightweight saved alone", '{"quality":true,"motion":false}', true, false],
  [
    "motion reduction saved alone",
    '{"quality":false,"motion":true}',
    false,
    true,
  ],
  [
    "both display accommodations saved",
    '{"quality":true,"motion":true}',
    true,
    true,
  ],
  ["malformed preferences", "{broken", false, false],
  ["null preferences", "null", false, false],
  ["array masquerading as preferences", "[true,true]", false, false],
  [
    "string and numeric boolean impostors",
    '{"quality":"true","motion":1}',
    false,
    false,
  ],
] as const)
  scenario(
    "fresh preferences",
    "Mika, returning visitor",
    `Cold home with ${name}`,
    ["Seed exact saved display payload", "Open app without choosing game"],
    "Only strict boolean flags restore; gameplay never restores or auto-starts",
    async () => {
      localStorage.setItem("interval-display-preferences", saved);
      await boot();
      neutral();
      expect(el("quality").getAttribute("aria-pressed")).toBe(String(q));
      expect(el("motion").getAttribute("aria-pressed")).toBe(String(m));
    },
  );
scenario(
  "storage recovery",
  "Mika, privacy-restricted visitor",
  "Blocked preference reads still permit an explicit local opening",
  ["Deny localStorage getter", "Open home", "Choose local and Start"],
  "No startup exception; two cores, no purchased pieces and usable first turn",
  async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await boot();
    neutral();
    start();
    active();
    expectPly(0);
    expect(document.querySelectorAll(".piece.core")).toHaveLength(2);
  },
);
scenario(
  "storage recovery",
  "Mika, full-storage visitor",
  "Failed display persistence does not prevent selected accommodations or Start",
  [
    "Make setItem throw quota error",
    "Toggle quality and motion on home",
    "Start local",
  ],
  "Both current-visit flags work and first turn remains usable",
  async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await boot();
    click("quality");
    click("motion");
    start();
    active();
    expect(document.body.classList.contains("low-quality")).toBe(true);
    expect(document.body.classList.contains("no-motion")).toBe(true);
  },
);
scenario(
  "choice exploration",
  "Nao, indecisive visitor",
  "Menu opponent choices remain deliberate while mode carousel stays consistent",
  [
    "Select CPU, friend, local on home",
    "Open rules; choose CPU",
    "Wait; choose local; Start",
  ],
  "No early board/network; one pressed mode and explanatory copy agrees with final mode",
  async () => {
    await boot();
    for (const m of ["cpu", "friend", "local"]) click("choose-" + m);
    click("home-rules");
    click("cpu");
    expect(el("home-hint").textContent).toContain("あなたが先手");
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelector("[data-square]")).toBeNull();
    start();
    active();
    expect(fetch).not.toHaveBeenCalled();
  },
);

const kinds = [
  { kind: "bastion", price: 1, name: "バスティオン" },
  { kind: "carver", price: 3, name: "カーヴァー" },
  { kind: "leaper", price: 2, name: "リーパー" },
  { kind: "link", price: 1, name: "リンク" },
];
for (const k of kinds)
  for (const life of [1, 2, 3, 4, 5])
    scenario(
      "first purchase contract",
      "Nao, learning costs",
      `${k.kind} duration ${life}: preview agrees with first-turn payment and newborn lifetime`,
      [
        "Start local from fresh home",
        `Choose ${k.kind} for ${life} turns`,
        "Select a3, inspect price, confirm",
      ],
      `Spend ${k.price * life} from16 once; newborn remains${life}; black starts16; two cores persist`,
      async () => {
        await boot();
        start();
        proposal(k.kind, 14, life);
        expect(el("purchase-facts").textContent).toBe(
          `${life}ターンで${k.price * life}糧 · 残り${16 - k.price * life}糧`,
        );
        expect(el("summary").textContent).toContain(`期間${life}ターン`);
        await commit();
        expectPly(1);
        expect(el("white-grain").textContent).toBe(String(16 - k.price * life));
        expect(el("black-grain").textContent).toBe("16");
        expect(square(14).getAttribute("aria-label")).toContain(
          `${k.name} 残り${life}ターン`,
        );
        expect(document.querySelectorAll(".piece.core")).toHaveLength(2);
      },
    );
for (const k of kinds)
  for (const invalid of [
    { q: 3, name: "own fixed core" },
    { q: 21, name: "excluded central rank" },
    { q: 28, name: "opponent nearest rank" },
    { q: 45, name: "opponent fixed core" },
  ])
    scenario(
      "invalid retap recovery",
      "Mika, imprecise tapper",
      `${k.kind} candidate cannot survive a retap on ${invalid.name}`,
      [
        "Start local",
        `Propose ${k.kind} at a3 for2`,
        `Retap square${invalid.q}`,
        "Choose b3 and confirm",
      ],
      "Invalid square clears actionable ghost; alternative destination spends only once",
      async () => {
        await boot();
        start();
        proposal(k.kind, 14, 2);
        square(invalid.q).click();
        cleared();
        expect(el("hint").textContent).toContain("空きマス");
        expectPly(0);
        square(15).click();
        await commit();
        expectPly(1);
        expect(square(14).querySelector(".piece")).toBeNull();
        expect(square(15).getAttribute("aria-label")).toContain(k.name);
        expect(el("white-grain").textContent).toBe(String(16 - 2 * k.price));
      },
    );
for (const k of kinds)
  for (const interruption of ["rules", "quality", "motion", "home"] as const)
    scenario(
      "purchase interruption",
      "Mika, interrupted play",
      `${k.kind} purchase across ${interruption} interruption`,
      [
        "Start local",
        `Propose ${k.kind} at c3 for4`,
        `Visit ${interruption}`,
        "Resume intention and commit",
      ],
      interruption === "home"
        ? "Home cancels uncommitted intent; resumed game has same funds and needs fresh destination"
        : "Settings preserve exact candidate, price and duration; commit remains single",
      async () => {
        await boot();
        start();
        proposal(k.kind, 16, 4);
        if (interruption === "home") {
          click("home-button");
          click("resume-game");
          cleared();
          expectPly(0);
          proposal(k.kind, 16, 4);
        } else {
          click("menu");
          if (interruption !== "rules") click(interruption);
          click("close-menu");
          expect(el("confirm-row").hidden).toBe(false);
          expect(square(16).querySelector(".ghost-piece")).not.toBeNull();
        }
        await commit();
        expectPly(1);
        expect(el("white-grain").textContent).toBe(String(16 - 4 * k.price));
        expect(square(16).getAttribute("aria-label")).toContain("残り4ターン");
      },
    );

const rapid: [string, string, string[], () => Promise<void>][] = [
  [
    "double Summon remains a selection, not a purchase",
    "No cost or ply advances; picker remains available",
    ["Summon twice"],
    async () => {
      click("summon");
      click("summon");
      expectPly(0);
      expect(el("piece-picker").hidden).toBe(false);
      expect(el("white-grain").textContent).toBe("16");
    },
  ],
  [
    "reselecting the same kind removes an older proposed destination",
    "Kind selection is retained but destination needs reconfirmation",
    ["Propose Carver", "Tap Carver again"],
    async () => {
      proposal("carver");
      choose("carver");
      cleared();
      expect(el("kind-label").textContent).toContain("カーヴァー");
    },
  ],
  [
    "repeated destination taps never spend before Confirm",
    "One ghost and one uncommitted action",
    ["Propose Leaper", "Tap same destination five times"],
    async () => {
      proposal("leaper");
      for (let n = 0; n < 5; n++) square(14).click();
      expect(document.querySelectorAll(".ghost-piece")).toHaveLength(1);
      expectPly(0);
      await commit();
      expectPly(1);
    },
  ],
  [
    "double Confirm during submission cannot become the opponent's move",
    "Exactly one paid action",
    ["Propose Link", "Confirm twice without awaiting"],
    async () => {
      proposal("link");
      click("confirm");
      click("confirm");
      await flush();
      expectPly(1);
      expect(el("white-grain").textContent).toBe("13");
      expect(el("black-grain").textContent).toBe("16");
    },
  ],
  [
    "double Pass only prepares one action",
    "Explicit final confirmation remains necessary",
    ["Pass twice", "Confirm"],
    async () => {
      click("pass");
      click("pass");
      expectPly(0);
      await commit();
      expectPly(1);
      expect(el("turn").textContent).toBe("黒の手番");
    },
  ],
  [
    "Summon replaces a prepared pass without quietly passing",
    "Picker replaces pass candidate and remains free",
    ["Pass", "Summon"],
    async () => {
      click("pass");
      click("summon");
      cleared();
      expect(el("piece-picker").hidden).toBe(false);
      expectPly(0);
    },
  ],
  [
    "Pass replaces a paid proposal without buying it",
    "Only pass occurs; original square stays empty",
    ["Propose Carver", "Pass", "Confirm"],
    async () => {
      proposal("carver");
      click("pass");
      expect(document.querySelector(".ghost-piece")).toBeNull();
      await commit();
      expectPly(1);
      expect(el("white-grain").textContent).toBe("16");
    },
  ],
  [
    "Choose Again preserves kind and duration but clears destination",
    "Second destination is the only purchased square",
    ["Propose Bastion4", "Choose Again", "Choose b3", "Confirm"],
    async () => {
      proposal("bastion", 14, 4);
      click("back");
      cleared();
      expect(el("duration").textContent).toBe("4");
      square(15).click();
      await commit();
      expect(square(14).querySelector(".piece")).toBeNull();
      expect(square(15).getAttribute("aria-label")).toContain("残り4ターン");
    },
  ],
  [
    "Escape after a proposal cancels both ghost and price commitment",
    "Board remains ply0 with all16 grain",
    ["Propose Leaper", "Escape"],
    async () => {
      proposal("leaper");
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      cleared();
      expectPly(0);
      expect(el("white-grain").textContent).toBe("16");
    },
  ],
  [
    "lengthening an already-selected contract requires destination reconfirmation",
    "Old3-turn destination cannot accidentally buy4 turns",
    ["Propose Link3", "Increase duration", "Select new destination", "Confirm"],
    async () => {
      proposal("link");
      click("plus");
      cleared();
      square(15).click();
      await commit();
      expect(square(15).getAttribute("aria-label")).toContain("残り4ターン");
      expect(el("white-grain").textContent).toBe("12");
    },
  ],
  [
    "shortening an already-selected contract requires destination reconfirmation",
    "Only new2-turn candidate commits",
    ["Propose Carver3", "Decrease duration", "Retarget", "Confirm"],
    async () => {
      proposal("carver");
      click("minus");
      cleared();
      square(15).click();
      await commit();
      expect(el("white-grain").textContent).toBe("10");
      expect(square(15).getAttribute("aria-label")).toContain("残り2ターン");
    },
  ],
  [
    "changing piece kind cannot commit the older cheaper proposal",
    "New kind price and geometry own the candidate",
    ["Propose Bastion", "Choose Carver", "Retarget", "Confirm"],
    async () => {
      proposal("bastion");
      choose("carver");
      cleared();
      square(15).click();
      await commit();
      expect(el("white-grain").textContent).toBe("7");
      expect(square(15).getAttribute("aria-label")).toContain("カーヴァー");
    },
  ],
  [
    "repeated lower-limit duration taps do not underflow or change cost",
    "One-turn contract remains1 and costs exact unit price",
    ["Choose Carver1", "Press minus five times", "Select/confirm"],
    async () => {
      proposal("carver", 14, 1);
      for (let n = 0; n < 5; n++) click("minus");
      expect(el("duration").textContent).toBe("1");
      await commit();
      expect(el("white-grain").textContent).toBe("13");
    },
  ],
  [
    "repeated upper-limit duration taps do not overrun affordability",
    "Five-turn Carver stays15 and leaves1",
    ["Choose Carver5", "Press plus five times", "Confirm"],
    async () => {
      proposal("carver", 14, 5);
      for (let n = 0; n < 5; n++) click("plus");
      expect(el("duration").textContent).toBe("5");
      await commit();
      expect(el("white-grain").textContent).toBe("1");
    },
  ],
  [
    "declining home preserves the current purchase exactly",
    "Candidate, duration, price and match remain available",
    ["Propose Leaper4", "Home; decline", "Confirm"],
    async () => {
      proposal("leaper", 14, 4);
      vi.mocked(window.confirm).mockReturnValueOnce(false);
      click("home-button");
      expect(el("home").hidden).toBe(true);
      expect(el("confirm-row").hidden).toBe(false);
      await commit();
      expect(el("white-grain").textContent).toBe("8");
    },
  ],
  [
    "declining restart after one move keeps the next player's pending purchase",
    "Black intended action survives without restoring white funds",
    ["White Bastion2", "Black Leaper2 proposal", "Restart; decline", "Confirm"],
    async () => {
      proposal("bastion", 14, 2);
      await commit();
      proposal("leaper", 28, 2);
      click("menu");
      vi.mocked(window.confirm).mockReturnValueOnce(false);
      click("restart");
      click("close-menu");
      await commit();
      expectPly(2);
      expect(el("black-grain").textContent).toBe("12");
      expect(square(28).getAttribute("aria-label")).toContain("リーパー");
    },
  ],
];
for (const [title, expected, sequence, run] of rapid)
  scenario(
    "few-tap resilience",
    "Mika, rapid-input visitor",
    title,
    ["Fresh local Start", ...sequence],
    expected,
    async () => {
      await boot();
      start();
      await run();
    },
  );

for (const delay of [0, 299, 301])
  scenario(
    "CPU cancellation timing",
    "Nao, first CPU match",
    `Home at ${delay}ms cancels only the unfinished CPU turn`,
    [
      "Start CPU; human pass",
      `Advance${delay}ms`,
      "Home; inject old reply; Resume; new reply",
    ],
    "Home freezes ply1; stale reply does not change it; resumed current reply reaches ply2 once",
    async () => {
      await boot();
      start("cpu");
      await pass();
      await vi.advanceTimersByTimeAsync(delay);
      const old = workers[0];
      click("home-button");
      old?.onmessage?.({ data: { type: "pass" } });
      await flush();
      await vi.advanceTimersByTimeAsync(9000);
      expectPly(1);
      click("resume-game");
      await vi.advanceTimersByTimeAsync(301);
      workers.at(-1)!.onmessage?.({ data: { type: "pass" } });
      await flush();
      expectPly(2);
      active();
    },
  );
scenario(
  "CPU cancellation timing",
  "Mika, interrupted CPU match",
  "Declining Home does not terminate the active CPU worker",
  ["Human pass; await worker", "Home; decline", "Current worker replies"],
  "No pause; the pending move completes normally",
  async () => {
    await boot();
    start("cpu");
    await pass();
    await vi.advanceTimersByTimeAsync(301);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    click("home-button");
    expect(workers[0].terminate).not.toHaveBeenCalled();
    workers[0].onmessage?.({ data: { type: "pass" } });
    await flush();
    expectPly(2);
    active();
  },
);
scenario(
  "CPU resume idempotency",
  "Mika, repeated button presses",
  "Repeated Resume starts one replacement CPU worker",
  [
    "Human pass; Home before worker",
    "Resume twice; advance301ms",
    "Worker replies",
  ],
  "Exactly one replacement search and one CPU move",
  async () => {
    await boot();
    start("cpu");
    await pass();
    click("home-button");
    click("resume-game");
    click("resume-game");
    await vi.advanceTimersByTimeAsync(301);
    expect(workers).toHaveLength(1);
    workers[0].onmessage?.({ data: { type: "pass" } });
    await flush();
    expectPly(2);
  },
);
scenario(
  "CPU stale error",
  "Mika, interrupted CPU match",
  "Late failure from a paused CPU generation cannot run fallback search",
  ["Start worker", "Home", "Old worker error; advance8s", "Resume"],
  "Paused state staysply1 with no extra worker or action",
  async () => {
    await boot();
    start("cpu");
    await pass();
    await vi.advanceTimersByTimeAsync(301);
    click("home-button");
    workers[0].onerror?.();
    await vi.advanceTimersByTimeAsync(8000);
    expectPly(1);
    expect(workers).toHaveLength(1);
    click("resume-game");
    expectPly(1);
  },
);
for (const replacement of ["local", "cpu"])
  scenario(
    "CPU match replacement",
    "Ren, changing opponent",
    `Replacing unfinished CPU game with ${replacement} rejects the old legal reply`,
    [
      "Start CPU worker",
      "Menu; select replacement and approve",
      "Old worker replies",
    ],
    "Fresh match retains ply0/16grain/two cores; stale action cannot affect it",
    async () => {
      await boot();
      start("cpu");
      await pass();
      await vi.advanceTimersByTimeAsync(301);
      const old = workers[0];
      click("menu");
      click(replacement);
      old.onmessage?.({ data: { type: "pass" } });
      await flush();
      expectPly(0);
      expect(el("white-grain").textContent).toBe("16");
      expect(el("black-grain").textContent).toBe("12");
      expect(old.terminate).toHaveBeenCalled();
    },
  );
for (const response of ["null", "illegal", "error", "timeout"] as const)
  scenario(
    "CPU bounded recovery",
    "Nao, unreliable worker",
    `CPU ${response} response recovers with an actual legal local fallback`,
    ["Start CPU; human pass", "Wait for worker", `Inject ${response}`],
    "Fallback commits one legal action, releases CPU lock and returns human turn",
    async () => {
      await boot();
      start("cpu");
      await pass();
      await vi.advanceTimersByTimeAsync(301);
      if (response === "null") workers[0].onmessage?.({ data: null });
      else if (response === "illegal")
        workers[0].onmessage?.({
          data: { type: "summon", kind: "carver", to: 3, duration: 5 },
        });
      else if (response === "error") workers[0].onerror?.();
      else await vi.advanceTimersByTimeAsync(6001);
      await flush();
      expectPly(2);
      expect(el("turn").textContent).toBe("白の手番");
      active();
      expect(workers[0].terminate).toHaveBeenCalled();
    },
  );

scenario(
  "long continuation",
  "Mika, frequent interruptions",
  "Forty Home/Resume visits preserve one existing contract and both balances",
  ["Buy white Carver5; black pass", "Home/Resume40times", "White pass"],
  "Navigation grants no income/aging; only real pass ages5to4",
  async () => {
    await boot();
    start();
    proposal("carver", 14, 5);
    await commit();
    await pass();
    for (let n = 0; n < 40; n++) {
      click("home-button");
      click("resume-game");
      expectPly(2);
      expect(el("white-grain").textContent).toBe("5");
      expect(el("black-grain").textContent).toBe("16");
      expect(square(14).getAttribute("aria-label")).toContain("残り5ターン");
    }
    await pass();
    expect(square(14).getAttribute("aria-label")).toContain("残り4ターン");
  },
);
scenario(
  "selection churn",
  "Ren, comparing alternatives",
  "Eighty different proposals followed by one commitment buy only the final Link",
  [
    "Cycle4kinds and5durations through20rounds of proposal/cancel",
    "Commit Link2 at b3",
  ],
  "No accumulated ghost/action; exact final cost2 and ply1",
  async () => {
    await boot();
    start();
    for (let n = 0; n < 80; n++) {
      proposal(kinds[n % 4].kind, 14 + (n % 7), 1 + (n % 5));
      click("cancel");
      cleared();
      expectPly(0);
    }
    proposal("link", 15, 2);
    await commit();
    expectPly(1);
    expect(el("white-grain").textContent).toBe("14");
    expect(
      document.querySelectorAll(".board-grid .piece:not(.core)"),
    ).toHaveLength(1);
  },
);
scenario(
  "display churn",
  "Mika, adjusting comfort",
  "Repeated quality/motion settings never duplicate state updates or purchase effects",
  ["Start local; proposalLeaper4", "Toggle each flag20times", "Commit"],
  "Settings return off, one purchase remains, exact8grain and stable accessible piece",
  async () => {
    await boot();
    start();
    proposal("leaper", 14, 4);
    for (let n = 0; n < 20; n++) {
      click("quality");
      click("motion");
    }
    expect(el("quality").getAttribute("aria-pressed")).toBe("false");
    expect(el("motion").getAttribute("aria-pressed")).toBe("false");
    await commit();
    expectPly(1);
    expect(el("white-grain").textContent).toBe("8");
    expect(square(14).getAttribute("aria-label")).toContain("残り4ターン");
  },
);
scenario(
  "fresh rematch",
  "Nao, learning through replay",
  "Six confirmed passes and a rematch restore only the documented opening",
  ["Start local; six passes", "Rematch", "Buy Bastion1"],
  "Draw stops actions; rematch has two cores, no free wall and usable first purchase",
  async () => {
    await boot();
    start();
    for (let n = 0; n < 6; n++) await pass();
    expect(el("turn").textContent).toBe("引き分け");
    expect(el<HTMLButtonElement>("summon").disabled).toBe(true);
    click("again");
    expectPly(0);
    expect(document.querySelectorAll(".piece:not(.core)")).toHaveLength(0);
    proposal("bastion", 14, 1);
    await commit();
    expectPly(1);
    expect(el("white-grain").textContent).toBe("15");
  },
);
