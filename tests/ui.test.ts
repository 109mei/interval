// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
it("real_UI_summon_move_pass_and_restart", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
  const click = (s: string) =>
    document.querySelector<HTMLButtonElement>(s)!.click();
  const text = (s: string) => document.querySelector(s)!.textContent;
  expect(
    document
      .querySelector<HTMLAnchorElement>(".panel-jump")
      ?.getAttribute("href"),
  ).toBe("#controls");
  expect(document.getElementById("controls")).not.toBeNull();
  expect(text("#white-grain")).toBe("16");
  click("#pass");
  await new Promise((r) => setTimeout(r, 40));
  click("#pass");
  await new Promise((r) => setTimeout(r, 40));
  expect(text("#ply")).toBe("0 / 200 手");
  click("#confirm");
  await new Promise((r) => setTimeout(r, 40));
  click("#confirm");
  await new Promise((r) => setTimeout(r, 40));
  expect(text("#ply")).toBe("1 / 200 手");
  click("#restart");
  expect(text("#ply")).toBe("0 / 200 手");
  click('[data-kind="carver"]');
  click('[data-square="9"]');
  expect(text("#summary")).toContain("9");
  click("#confirm");
  await vi.waitFor(() => expect(text("#turn")).toBe("黒の手番"));
  expect(text("#white-grain")).toBe("7");
  click("#pass");
  click("#confirm");
  await vi.waitFor(() => expect(text("#turn")).toBe("白の手番"));
  click('[data-square="9"]');
  click('[data-square="18"]');
  click("#confirm");
  await vi.waitFor(() => expect(text("#ply")).toBe("3 / 200 手"));
  for (let i = 0; i < 6; i++) {
    click("#pass");
    click("#confirm");
    await Promise.resolve();
    await Promise.resolve();
  }
  expect(text("#turn")).toBe("引き分け");
  click("#restart");
  expect(text("#ply")).toBe("0 / 200 手");
});
