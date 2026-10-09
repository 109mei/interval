import { test, expect } from "@playwright/test";
test("mobile full match and repeated controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?2d");
  await expect(page.locator("#home")).toBeVisible();
  await page.locator("#choose-local").click();
  await page.locator("#start-game").click();
  await expect(page.locator("[data-square]")).toHaveCount(49);
  await expect(page.locator("#white-grain")).toHaveText("16");
  await page.locator("#summon").click();
  await page.locator('[data-kind="carver"]').click();
  await page.locator('[data-square="9"]').click();
  await expect(page.locator("#summary")).toContainText("9");
  await page.locator("#confirm").click();
  await expect(page.locator("#white-grain")).toHaveText("7");
  await expect(page.locator("#turn")).toHaveText("黒の手番");
  await page.locator("#pass").click();
  await page.locator("#confirm").click();
  await page.locator('[data-square="9"]').click();
  await page.locator('[data-square="18"]').click();
  await page.locator("#confirm").click();
  await expect(page.locator("#ply")).toContainText("3 /");
  await page.screenshot({ path: "test-results/mobile-2d.png", fullPage: true });
  for (let i = 0; i < 6; i++) {
    await page.locator("#pass").click();
    await page.locator("#confirm").click();
  }
  await expect(page.locator("#turn")).toHaveText("引き分け");
  page.once("dialog", (d) => d.accept());
  await page.locator("#menu").click();
  await page.locator("#restart").click();
  await expect(page.locator("#ply")).toHaveText("0 / 200 手");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("cpu input and mode restart", async ({ page }) => {
  await page.goto("/?2d");
  await expect(page.locator("#home")).toBeVisible();
  await page.locator("#choose-local").click();
  await page.locator("#start-game").click();
  await page.locator("#menu").click();
  await page.locator("#cpu").click();
  await page.locator("#pass").click();
  await page.locator("#confirm").click();
  await expect(page.locator("#ply")).toHaveText("2 / 200 手");
  page.once("dialog", (d) => d.accept());
  await page.locator("#menu").click();
  await page.locator("#local").click();
  await expect(page.locator("#ply")).toHaveText("0 / 200 手");
  await page.waitForTimeout(250);
  await expect(page.locator("#ply")).toHaveText("0 / 200 手");
});
test("actual 3D or honest automatic fallback", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("#choose-local").click();
  await page.locator("#start-game").click();
  await expect(page.locator("[data-square]")).toHaveCount(49);
  await page.screenshot({
    path: "test-results/desktop-default.png",
    fullPage: true,
  });
  await page.locator("#menu").click();
  const status = await page.locator("#board-status").innerText();
  test.info().annotations.push({ type: "renderer", description: status });
  await page.locator("#view").click();
  await expect(page.locator("#board-status")).toHaveText("2D表示");
  await page.locator("#close-menu").click();
  await page.locator('[data-square="0"]').focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[data-square="7"]')).toBeFocused();
});

test.describe("portrait touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("touch summons with contextual controls", async ({ page }) => {
    await page.goto("/?2d");
    await expect(page.locator("#home")).toBeVisible();
    await page.locator("#choose-local").click();
    await page.locator("#start-game").click();
    await page.locator("#summon").tap();
    await page.locator('[data-kind="carver"]').tap();
    await page.locator('[data-square="9"]').tap();
    await page.locator("#confirm").tap();
    await expect(page.locator("#white-grain")).toHaveText("7");
    await expect(page.locator("#ply")).toHaveText("1 / 200 手");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/portrait-touch.png",
      fullPage: true,
    });
  });
});
