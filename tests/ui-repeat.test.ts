// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { createGame } from "../src/game/engine";
const click = (selector: string) =>
  document.querySelector<HTMLButtonElement>(selector)!.click();
const el = (id: string) => document.getElementById(id)!;
async function boot(path = "/?2d") {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, "", path);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await import("../src/main");
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
it("a former invite guest can create the next match without stale invite instructions", async () => {
  const id = "a".repeat(32);
  let room = {
    id,
    seat: "black",
    version: 2,
    status: "finished",
    expiresAt: Date.now() + 86400000,
    joined: true,
    ready: { white: true, black: true },
    state: {
      ...createGame(),
      ply: 6,
      outcome: { kind: "draw", reason: "passes" },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (p: string) =>
        new Response(
          JSON.stringify(p === "/api/session" ? { ok: true } : room),
          { status: 200 },
        ),
    ),
  );
  await boot(`/?2d#room=${id}&invite=${"b".repeat(64)}`);
  click("#join-room");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("あなたは黒"),
  );
  click("#again");
  expect(el("friend-title").textContent).toBe("フレンド対戦");
  expect(el("friend-description").textContent).toContain("部屋をつくり");
});
it("leaving an invited room restores the ability to create a different room", async () => {
  const id = "c".repeat(32);
  const room = {
    id,
    seat: "black",
    version: 1,
    status: "waiting",
    expiresAt: Date.now() + 86400000,
    joined: true,
    ready: { white: false, black: false },
    state: createGame(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (p: string) =>
        new Response(
          JSON.stringify(
            p === "/api/session"
              ? { ok: true }
              : p.endsWith("/leave")
                ? { ...room, status: "closed", version: 2 }
                : room,
          ),
          { status: 200 },
        ),
    ),
  );
  await boot(`/?2d#room=${id}&invite=${"d".repeat(64)}`);
  click("#join-room");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("あなたは黒"),
  );
  click("#leave");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("この端末で2人"),
  );
  expect(history.state).toBeNull();
  expect(location.search).toBe("");
  expect(location.hash).toBe("");
  click("#friend");
  expect(el("join-room").hidden).toBe(true);
  expect(el("create-room").hidden).toBe(false);
});
it("keyboard summon keeps focus on the next usable control instead of a hidden button", async () => {
  await boot();
  el("summon").focus();
  click("#summon");
  expect((document.activeElement as HTMLElement).dataset.kind).toBe("bastion");
  click('[data-kind="carver"]');
  const focused = document.activeElement as HTMLElement;
  expect(focused.dataset.square).toBeDefined();
  expect(focused.classList.contains("target")).toBe(true);
});
it("keyboard pass, confirm and cancel return focus to visible game controls", async () => {
  await boot();
  el("pass").focus();
  click("#pass");
  expect(document.activeElement).toBe(el("confirm"));
  click("#confirm");
  await vi.waitFor(() => expect(el("ply").textContent).toBe("1 / 200 手"));
  await vi.waitFor(() =>
    expect(
      (document.activeElement as HTMLElement).dataset.square,
    ).toBeDefined(),
  );
  click("#summon");
  click("#cancel");
  expect(document.activeElement).toBe(el("summon"));
});
it("a new room clears the previous room's manually copied invite", async () => {
  let created = 0;
  let current: any;
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/session")
        return new Response(JSON.stringify({ ok: true }));
      if (path === "/api/rooms")
        current = {
          id: (++created === 1 ? "a" : "c").repeat(32),
          invite: (created === 1 ? "b" : "d").repeat(64),
          seat: "white",
          version: 0,
          status: "waiting",
          expiresAt: Date.now() + 86400000,
          joined: false,
          ready: { white: false, black: false },
          state: createGame(),
        };
      return new Response(
        JSON.stringify(
          path.endsWith("/leave")
            ? { ...current, status: "closed", version: 1 }
            : current,
        ),
      );
    }),
  );
  await boot();
  click("#create-room");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("あなたは白"),
  );
  click("#copy");
  await vi.waitFor(() => expect(el("invite-link").hidden).toBe(false));
  click("#leave");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("この端末で2人"),
  );
  click("#create-room");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("あなたは白"),
  );
  expect(el("invite-link").hidden).toBe(true);
  expect((el("invite-link") as HTMLInputElement).value).toBe("");
  expect(el("copy").textContent).toBe("招待リンクをコピー");
  click("#leave");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("この端末で2人"),
  );
});
it("a late clipboard failure cannot display a departed room's invite", async () => {
  let rejectCopy!: (e: Error) => void;
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: () =>
        new Promise<void>((_, reject) => {
          rejectCopy = reject;
        }),
    },
  });
  const room = {
    id: "e".repeat(32),
    invite: "f".repeat(64),
    seat: "white",
    version: 0,
    status: "waiting",
    expiresAt: Date.now() + 86400000,
    joined: false,
    ready: { white: false, black: false },
    state: createGame(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path === "/api/session"
              ? { ok: true }
              : path.endsWith("/leave")
                ? { ...room, status: "closed", version: 1 }
                : room,
          ),
        ),
    ),
  );
  await boot();
  click("#create-room");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("あなたは白"),
  );
  click("#copy");
  click("#leave");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("この端末で2人"),
  );
  rejectCopy(new Error("blocked"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(el("invite-link").hidden).toBe(true);
  expect((el("invite-link") as HTMLInputElement).value).toBe("");
});
it("failed recovery followed by a new room cannot expose the old room's pending leave", async () => {
  const old = "a".repeat(32),
    next = "b".repeat(32);
  sessionStorage.setItem(
    `interval-pending:${old}`,
    JSON.stringify({
      op: "leave",
      body: { commandId: "old-leave", version: 0 },
    }),
  );
  const room = {
    id: next,
    seat: "white",
    version: 0,
    status: "waiting",
    expiresAt: Date.now() + 86400000,
    joined: false,
    ready: { white: false, black: false },
    state: createGame(),
    invite: "d".repeat(64),
  };
  const writes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path.includes(old)) throw Error("offline");
      if (path.endsWith("/leave")) writes.push(path);
      return new Response(
        JSON.stringify(
          path === "/api/session"
            ? { ok: true }
            : path.endsWith("/leave")
              ? { ...room, status: "closed", version: 1 }
              : room,
        ),
      );
    }),
  );
  await boot(`/?2d&room=${old}`);
  await vi.waitFor(() => expect(el("retry").hidden).toBe(false));
  click("#friend");
  click("#create-room");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("あなたは白"),
  );
  expect(el("retry").hidden).toBe(true);
  expect((el("ready") as HTMLButtonElement).disabled).toBe(false);
  click("#retry");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(writes).toHaveLength(0);
  expect(el("lobby").hidden).toBe(false);
  click("#leave");
  await vi.waitFor(() =>
    expect(el("mode-label").textContent).toBe("この端末で2人"),
  );
});
it.each(["pass", "summon"] as const)(
  "keyboard choosing again from %s restores a visible decision target",
  async (action) => {
    await boot();
    if (action === "pass") click("#pass");
    else {
      click("#summon");
      click('[data-kind="carver"]');
      click('[data-square="9"]');
    }
    el("back").focus();
    click("#back");
    if (action === "pass") expect(document.activeElement).toBe(el("summon"));
    else
      expect(
        (document.activeElement as HTMLElement).dataset.square,
      ).toBeDefined();
    expect(el("confirm-row").hidden).toBe(true);
  },
);
it("room recovery identifies the online mode before the state request completes", async () => {
  let finishSession!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/api/session"
        ? new Promise<Response>((resolve) => {
            finishSession = resolve;
          })
        : new Response(JSON.stringify({ error: "NO_SEAT" }), { status: 403 }),
    ),
  );
  await boot(`/?2d&room=${"e".repeat(32)}`);
  expect(el("mode-label").textContent).toBe("フレンド対戦");
  expect(el("turn").textContent).toBe("対局を復元中");
  expect(el("hint").textContent).toContain("接続");
  finishSession(new Response(JSON.stringify({ ok: true })));
  await vi.waitFor(() => expect(el("retry").hidden).toBe(false));
  expect(el("mode-label").textContent).toBe("フレンド対戦");
});
