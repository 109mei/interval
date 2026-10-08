// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { createCaseLedger } from "./quality/case-ledger";
const { registerCase } = createCaseLedger("clarity");
const el = (id: string) => document.getElementById(id)!;
const click = (selector: string) =>
  document.querySelector<HTMLButtonElement>(selector)!.click();
let listeners: [string, EventListenerOrEventListenerObject][];
beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type, listener, options) => {
      listeners.push([type, listener]);
      add(type, listener, options);
    },
  );
});
afterEach(() => {
  for (const [type, listener] of listeners)
    document.removeEventListener(type, listener);
  document.head.querySelector("[data-clarity-css]")?.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = "";
});
async function boot() {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  await import("../src/main");
}
for (const [kind, price] of [
  ["bastion", 1],
  ["carver", 3],
  ["leaper", 2],
  ["link", 1],
] as const)
  for (let duration = 1; duration <= 5; duration++)
    registerCase(
      {
        id: `Q-CLARITY-COST-${kind}-${duration}`,
        category: "DOM upfront purchase facts",
        inputs: { kind, duration, grain: 16, action: "choose without placing" },
        assertions: [
          "Exact duration, cost and post-purchase balance are beside duration controls before placement",
          "Purchase facts are a polite atomic announcement",
          "Choosing never spends or commits",
        ],
      },
      async () => {
        await boot();
        click("#summon");
        click(`[data-kind="${kind}"]`);
        while (Number(el("duration").textContent) > duration) click("#minus");
        while (Number(el("duration").textContent) < duration) click("#plus");
        const facts = el("purchase-facts");
        expect(
          facts,
          "price must be beside quantity, not only below the explanatory panel",
        ).not.toBeNull();
        expect(facts.closest(".duration-row")).not.toBeNull();
        expect(facts.textContent).toBe(
          `${duration}回で${price * duration}糧 · 残り${16 - price * duration}糧`,
        );
        expect(facts.getAttribute("aria-live")).toBe("polite");
        expect(facts.getAttribute("aria-atomic")).toBe("true");
        expect(el("white-grain").textContent).toBe("16");
        expect(el("ply").textContent).toBe("0 / 200 手");
        expect(el("confirm-row").hidden).toBe(true);
      },
    );
registerCase(
  {
    id: "Q-CLARITY-CANCEL-44",
    category: "DOM target dimensions",
    inputs: { control: "selection cancel", css: "production stylesheet" },
    assertions: ["Selection cancel has at least 44px minimum height and width"],
  },
  async () => {
    await boot();
    click("#summon");
    const style = document.createElement("style");
    style.dataset.clarityCss = "";
    style.textContent = readFileSync("src/ui/styles.css", "utf8");
    document.head.append(style);
    const css = getComputedStyle(el("cancel"));
    expect(parseFloat(css.minHeight)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(css.minWidth)).toBeGreaterThanOrEqual(44);
  },
);

registerCase(
  {
    id: "Q-CLARITY-SHORTAGE-RECOVERY",
    category: "DOM upfront purchase facts",
    inputs: {
      firstPurchase: { kind: "carver", duration: 5, to: 9 },
      opponent: "pass",
      nextDuration: [5, 1],
      nextTo: 8,
    },
    assertions: [
      "An unaffordable duration names the exact shortfall, never a negative balance",
      "Shortening duration updates the same cost facts without spending",
      "Cancel clears selection without committing",
    ],
  },
  async () => {
    await boot();
    click("#summon");
    click('[data-kind="carver"]');
    click("#plus");
    click("#plus");
    click('[data-square="9"]');
    click("#confirm");
    await Promise.resolve();
    await Promise.resolve();
    click("#pass");
    click("#confirm");
    await Promise.resolve();
    await Promise.resolve();
    click("#summon");
    click('[data-kind="carver"]');
    expect(el("purchase-facts").textContent).toBe("5回で15糧 · 10糧不足");
    expect(el("purchase-facts").textContent).not.toContain("残り-");
    for (let i = 0; i < 4; i++) click("#minus");
    expect(el("purchase-facts").textContent).toBe("1回で3糧 · 残り2糧");
    click('[data-square="8"]');
    click("#cancel");
    expect(el("summon-details").hidden).toBe(true);
    expect(el("purchase-facts").textContent).toBe("");
    expect(el("white-grain").textContent).toBe("5");
    expect(el("ply").textContent).toBe("2 / 200 手");
  },
);
