// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
const el = (id: string) => document.getElementById(id)!;
const click = (selector: string) =>
  document.querySelector<HTMLButtonElement>(selector)!.click();
async function boot() {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", "/?2d");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
}
async function commit() {
  click("#confirm");
  await Promise.resolve();
  await Promise.resolve();
}
async function pass() {
  click("#pass");
  await commit();
}
async function summon(kind: string, to: number, life = 3) {
  click("#summon");
  click(`[data-kind="${kind}"]`);
  while (Number(el("duration").textContent) > life) click("#minus");
  while (Number(el("duration").textContent) < life) click("#plus");
  click(`[data-square="${to}"]`);
  await commit();
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
it("Mika invalid summon retap removes prior purchase without spending or losing duration", async () => {
  await boot();
  click("#summon");
  click('[data-kind="carver"]');
  click("#minus");
  click('[data-square="9"]');
  expect(el("confirm-row").hidden).toBe(false);
  click('[data-square="16"]');
  expect(el("confirm-row").hidden).toBe(true);
  expect(document.querySelector(".ghost-piece")).toBeNull();
  expect(el("duration").textContent).toBe("2");
  expect(el("white-grain").textContent).toBe("16");
  click('[data-square="8"]');
  expect(el("hint").textContent).toContain("b2");
  await commit();
  expect(el("white-grain").textContent).toBe("10");
  expect(
    document.querySelector('[data-square="8"] .piece-mark')?.textContent,
  ).toBe("曲");
});
it("Nao can correct an illegal move with one destination tap", async () => {
  await boot();
  await summon("carver", 9);
  await pass();
  click('[data-square="9"]');
  click('[data-square="16"]');
  expect(
    document.querySelector('[data-square="9"]')?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(el("hint").textContent).toContain("移動できません");
  expect(document.querySelectorAll(".target").length).toBeGreaterThan(0);
  click('[data-square="22"]');
  expect(el("hint").textContent).toContain("b4");
  await commit();
  expect(el("ply").textContent).toBe("3 / 200 手");
});
it("Nao learns remaining one expires this own turn and the owner is named on the other turn", async () => {
  await boot();
  await summon("carver", 9, 1);
  click('[data-square="9"]');
  expect(el("summary").textContent).toContain("次の白の手番末");
  click("#cancel");
  await pass();
  click('[data-square="9"]');
  expect(el("summary").textContent).toContain("この白の手番末");
  expect(el("summary").textContent).not.toContain("次の自分");
});
it("Ren sees Link aging and every expiring piece before a support exchange", async () => {
  await boot();
  await summon("link", 8, 3);
  await pass();
  await summon("leaper", 9, 1);
  await pass();
  click('[data-square="8"]');
  expect(el("summary").textContent).toContain("手番末");
  expect(el("summary").textContent).not.toContain("残り期間は変わらない");
  click('[data-square="9"]');
  expect(el("summary").textContent).toContain("2 体が退場");
  expect(el("summary").textContent).toContain("c2 リーパー");
  expect(el("summary").textContent).toContain("d2 バスティオン");
});
it("Ren is warned of the sixth-pass draw and can choose again without ending the match", async () => {
  await boot();
  for (let i = 0; i < 5; i++) await pass();
  click("#pass");
  expect(el("tactical-note").textContent).toContain("6回連続");
  expect(el("tactical-note").textContent).toContain("引き分け");
  click("#back");
  expect(el("turn").textContent).toContain("手番");
  expect(el("ply").textContent).toBe("5 / 200 手");
});
it("Ren inspects opponent attack squares without making opponent moves actionable", async () => {
  await boot();
  await summon("carver", 9);
  click('[data-square="9"]');
  expect(
    document
      .querySelector('[data-square="22"]')
      ?.classList.contains("inspect-target"),
  ).toBe(true);
  expect(
    document.querySelector('[data-square="22"]')?.getAttribute("aria-label"),
  ).toContain("参考");
  expect(el("summary").textContent).toContain("参考");
  click('[data-square="22"]');
  expect(el("confirm-row").hidden).toBe(true);
  expect(el("ply").textContent).toBe("1 / 200 手");
});
it("Sora sees readiness consequences before committing and useful room limit recovery", async () => {
  const { createGame } = await import("../src/game/engine");
  const room = {
    id: "a".repeat(32),
    seat: "white",
    version: 0,
    status: "waiting",
    expiresAt: Date.now() + 86400000,
    joined: false,
    ready: { white: false, black: false },
    state: createGame(),
  };
  let capped = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (p: string) =>
        new Response(
          JSON.stringify(
            p === "/api/session"
              ? { ok: true }
              : capped
                ? { error: "ROOM_LIMIT" }
                : room,
          ),
          { status: capped && p === "/api/rooms" ? 429 : 200 },
        ),
    ),
  );
  await boot();
  click("#create-room");
  await vi.waitFor(() => expect(el("lobby").hidden).toBe(false));
  expect(el("ready-note").textContent).toContain("取り消せません");
  expect(el("ready-note").textContent).toContain("すぐ始まります");
  click("#leave");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("この端末で2人"),
  );
  capped = true;
  click("#create-room");
  await vi.waitFor(() =>
    expect(el("friend-error").textContent).toContain("終了・退出した部屋"),
  );
  expect(el("friend-error").textContent).toContain("フレンドに部屋");
  expect(el("friend-error").textContent).toContain("期限");
  expect((el("create-room") as HTMLButtonElement).disabled).toBe(false);
});

it("Nao's zero-target guidance matches immobility and insufficient grain", async () => {
  await boot();
  click('[data-square="10"]');
  click('[data-square="17"]');
  expect(el("hint").textContent).not.toContain("光る行き先");
  expect(el("hint").textContent).toContain("召喚");
  click("#cancel");
  await summon("carver", 9, 5);
  await pass();
  click("#summon");
  click('[data-kind="carver"]');
  expect(el("hint").textContent).toContain("期間を短く");
  click('[data-square="8"]');
  expect(el("hint").textContent).toContain("期間を短く");
  for (let i = 0; i < 4; i++) click("#minus");
  expect(el("hint").textContent).not.toContain("糧が足りません");
  expect(document.querySelectorAll(".target").length).toBeGreaterThan(0);
});
