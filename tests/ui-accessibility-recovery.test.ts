// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const el = (id: string) => document.getElementById(id)!;
const click = (selector: string) =>
  document.querySelector<HTMLButtonElement>(selector)!.click();
const escape = () =>
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
async function confirmAction() {
  el("confirm").focus();
  click("#confirm");
  await vi.waitFor(() =>
    expect(
      (document.activeElement as HTMLElement).dataset.square,
    ).toBeDefined(),
  );
}
let listeners: [string, EventListenerOrEventListenerObject][];
async function boot() {
  for (const [type, listener] of listeners)
    document.removeEventListener(type, listener);
  listeners.length = 0;
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  document.body.className = "";
  history.replaceState(null, "", "/?2d");
  await import("../src/main");
}
beforeEach(() => {
  listeners = [];
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type, listener, options) => {
      listeners.push([type, listener]);
      add(type, listener, options);
    },
  );
  localStorage.clear();
});
afterEach(() => {
  for (const [type, listener] of listeners)
    document.removeEventListener(type, listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.className = "";
});
it("Escape from summon confirmation returns to a visible summon control without committing", async () => {
  await boot();
  click("#summon");
  click('[data-kind="carver"]');
  click('[data-square="9"]');
  el("confirm").focus();
  escape();
  expect(el("confirm-row").hidden).toBe(true);
  expect(document.activeElement).toBe(el("summon"));
  expect(el("ply").textContent).toBe("0 / 200 手");
  expect(document.querySelector(".ghost-piece")).toBeNull();
});
it("Escape keeps a still-visible board square focused and leaves menu decisions alone", async () => {
  await boot();
  click("#summon");
  click('[data-kind="carver"]');
  const square = document.querySelector<HTMLElement>('[data-square="9"]')!;
  square.focus();
  square.click();
  escape();
  expect(document.activeElement).toBe(square);
  expect(el("confirm-row").hidden).toBe(true);
  click("#pass");
  click("#menu");
  el("close-menu").focus();
  escape();
  expect(el("confirm-row").hidden).toBe(false);
  expect(document.activeElement).toBe(el("close-menu"));
  expect(el("ply").textContent).toBe("0 / 200 手");
});
it("keyboard rematch returns to a usable board control after hiding the result action", async () => {
  await boot();
  for (let i = 0; i < 6; i++) {
    click("#pass");
    await confirmAction();
    await vi.waitFor(() =>
      expect(el("ply").textContent).toBe(`${i + 1} / 200 手`),
    );
  }
  el("again").focus();
  click("#again");
  expect(el("result-actions").hidden).toBe(true);
  expect((document.activeElement as HTMLElement).dataset.square).toBeDefined();
  expect(el("ply").textContent).toBe("0 / 200 手");
});
it("explicit lightweight and reduced-motion choices survive a fresh app load and can be cleared", async () => {
  await boot();
  click("#quality");
  click("#motion");
  expect(document.body.classList.contains("low-quality")).toBe(true);
  expect(document.body.classList.contains("no-motion")).toBe(true);
  await boot();
  expect(el("quality").getAttribute("aria-pressed")).toBe("true");
  expect(el("motion").getAttribute("aria-pressed")).toBe("true");
  expect(document.body.classList.contains("low-quality")).toBe(true);
  expect(document.body.classList.contains("no-motion")).toBe(true);
  click("#quality");
  click("#motion");
  await boot();
  expect(el("quality").getAttribute("aria-pressed")).toBe("false");
  expect(el("motion").getAttribute("aria-pressed")).toBe("false");
  expect(document.body.classList.contains("low-quality")).toBe(false);
  expect(document.body.classList.contains("no-motion")).toBe(false);
});
it.each(["{bad-json", "null", "[]", '{"quality":"true","motion":1}'])(
  "malformed or incorrectly typed display preferences cannot break startup: %s",
  async (saved) => {
    localStorage.setItem("interval-display-preferences", saved);
    await boot();
    expect(document.querySelectorAll("[data-square]")).toHaveLength(49);
    expect(el("quality").getAttribute("aria-pressed")).toBe("false");
    expect(el("motion").getAttribute("aria-pressed")).toBe("false");
    click("#motion");
    expect(document.body.classList.contains("no-motion")).toBe(true);
  },
);
it("blocked storage access still allows the game and both display controls to work", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  await boot();
  click("#quality");
  click("#motion");
  expect(el("quality").getAttribute("aria-pressed")).toBe("true");
  expect(el("motion").getAttribute("aria-pressed")).toBe("true");
  click("#pass");
  await confirmAction();
  await vi.waitFor(() => expect(el("ply").textContent).toBe("1 / 200 手"));
});
it("a failed preference write keeps the current choice usable without disturbing other storage", async () => {
  localStorage.setItem("unrelated", "preserved");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full storage", "QuotaExceededError");
  });
  await boot();
  click("#quality");
  click("#motion");
  expect(el("quality").getAttribute("aria-pressed")).toBe("true");
  expect(el("motion").getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem("unrelated")).toBe("preserved");
});
it("persisted motion-off never overrides the operating system's reduced-motion preference", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  await boot();
  click("#motion");
  click("#motion");
  await boot();
  expect(el("motion").getAttribute("aria-pressed")).toBe("false");
  click("#summon");
  click('[data-kind="carver"]');
  click('[data-square="9"]');
  await confirmAction();
  await vi.waitFor(() => expect(el("ply").textContent).toBe("1 / 200 手"));
  expect(document.querySelector(".board-effects.reduced")).not.toBeNull();
  expect(
    document.querySelectorAll(".moving-piece,.motion-hidden"),
  ).toHaveLength(0);
  expect(document.querySelector('[data-square="9"] .life')?.textContent).toBe(
    "3",
  );
});
it("display persistence writes only its two flags and never writes a gameplay record", async () => {
  localStorage.setItem("unrelated", "preserved");
  await boot();
  expect(localStorage.length).toBe(1);
  click("#quality");
  const saved = localStorage.getItem("interval-display-preferences");
  expect(JSON.parse(saved!)).toEqual({ quality: true, motion: false });
  click("#pass");
  await confirmAction();
  await vi.waitFor(() => expect(el("ply").textContent).toBe("1 / 200 手"));
  expect(localStorage.length).toBe(2);
  expect(localStorage.getItem("interval-display-preferences")).toBe(saved);
  expect(localStorage.getItem("unrelated")).toBe("preserved");
  await boot();
  expect(el("ply").textContent).toBe("0 / 200 手");
});
