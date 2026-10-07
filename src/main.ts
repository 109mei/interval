import "./ui/styles.css";
import { createController } from "./app/controller";
import { createBoard2D } from "./render/board2d";
import { createBoard3D } from "./render/board3d";
import { createAdaptiveBoard } from "./render/adaptive";
import type { BoardView } from "./render/board-view";
import { legalActions, PRICES, KINDS } from "./game/rules";
import { previewAction } from "./game/engine";
import type { Action, Kind, Selection } from "./game/types";
import { INFO, icon, squareName } from "./ui/piece-info";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<main><header class="mast"><div class="brand">INTERVAL<small>糧と期限の盤 · PROTOTYPE</small></div><div class="toolbar"><button id="view">2Dに切替</button><button id="quality" aria-pressed="false">軽量</button></div></header><div class="arena"><section class="playfield"><div class="scoreline"><div class="account" id="white-account"><span><i class="dot"></i>WHITE / 糧</span><strong id="white-grain"></strong></div><div class="account" id="black-account"><span><i class="dot black"></i>BLACK / 糧</span><strong id="black-grain"></strong></div></div><div class="board-shell"><div class="board-host" id="board"></div></div><div class="underboard"><span>敵のコア ◆ を取れば勝利</span><span id="ply"></span></div><div class="board-status" id="board-status">2D表示</div><a class="panel-jump" href="#controls">操作パネルへ ↓</a></section><aside class="panel" id="controls"><div class="modebar"><button id="local" class="active">2人で対戦</button><button id="cpu">CPU対戦</button></div><h1 id="turn" aria-live="polite"></h1><p class="hint" id="hint"></p><div class="pieces">${KINDS.map((k) => `<button class="choice" data-kind="${k}">${icon(k)}<span class="name">${INFO[k].name}</span><small>糧${PRICES[k]} / ターン</small></button>`).join("")}</div><div class="duration-row"><span>召喚する期間</span><div class="duration-controls"><button id="minus" aria-label="期間を短くする">−</button><strong id="duration">3</strong><button id="plus" aria-label="期間を長くする">＋</button></div></div><div class="summary" id="summary" aria-live="polite"></div><div class="actions"><button id="cancel">選択解除</button><button class="primary" id="confirm" disabled>確定する</button></div><div class="secondary-row"><button id="pass">この手番をパス</button><button id="restart">最初から</button></div><div class="log" id="log" aria-live="polite">期間分の糧を先払い。残り0の駒は盤から消えます。</div><details class="rulebook"><summary>遊び方と駒の動き</summary><p>自分の番に召喚・移動・交換・パスを1回。自陣の手前2列に召喚できます。毎手番に糧4、保有上限はありません。</p><p>召喚した番は動けず、残り期間も減りません。次の自分の手番から、終了時に自軍の全駒が1ずつ減ります。残り1の駒も行動後に消えます。</p><p>捕獲報酬 = 相手の単価 × 相手の残り期間。自然消滅では報酬なし。コア捕獲は消滅処理より先に勝利です。</p>${KINDS.map((k) => `<p><b>${INFO[k].name}</b> — ${INFO[k].description}</p>`).join("")}<p>連続6パス、または合計200手で引き分け。駒を選ぶと移動先と、確定後に消える駒が表示されます。</p><p>キーボード: Tabで盤へ、矢印で移動、Enterで選択、Escapeで解除。</p></details></aside></div><p class="notice">保存機能はありません。再読み込みすると対局は終了します。</p></main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let selection: Selection = { pieceId: null, candidate: null },
  kind: Kind | null = null,
  duration = 3;
let board: BoardView;
let lastLogPly = -1;
let renderedRevision = "";
const c = createController(() => {
  const t = c.getToken(),
    key = `${t.session}:${t.revision}`;
  if (key !== renderedRevision) {
    clear();
    renderedRevision = key;
  }
  render();
});
function clear() {
  selection = { pieceId: null, candidate: null };
  kind = null;
}
function pick(q: number) {
  const s = c.getState();
  if (c.getBusy() || s.outcome) return;
  const actions = legalActions(s);
  if (kind) {
    const a: Action = { type: "summon", kind, duration, to: q };
    if (previewAction(s, a)) selection = { pieceId: null, candidate: a };
    else {
      $("log").textContent =
        "自陣2列の空きマスと、必要な糧を確認してください。";
    }
    render();
    return;
  }
  const p = s.pieces.find((p) => p.square === q);
  const candidate = actions.find(
    (a) =>
      (a.type === "move" && a.pieceId === selection.pieceId && a.to === q) ||
      (a.type === "swap" &&
        a.pieceId === selection.pieceId &&
        a.allyId === p?.id),
  );
  if (candidate) selection.candidate = candidate;
  else
    selection = { pieceId: p?.side === s.turn ? p.id : null, candidate: null };
  render();
}
let use3D = !new URLSearchParams(location.search).has("2d");
function setupBoard() {
  board?.dispose();
  board = use3D
    ? createAdaptiveBoard(
        $("board"),
        pick,
        (f) => createBoard3D($("board"), pick, f),
        (m) => ($("board-status").textContent = m),
      )
    : createBoard2D($("board"), pick);
  if (!use3D) $("board-status").textContent = "2D表示";
  $("view").textContent = use3D ? "2Dに切替" : "3Dに切替";
}
setupBoard();
$("view").onclick = () => {
  use3D = !use3D;
  setupBoard();
  render();
};
function render() {
  const s = c.getState();
  const preview = selection.candidate
    ? previewAction(s, selection.candidate)
    : null;
  if (selection.candidate && !preview) selection.candidate = null;
  $("white-grain").textContent = String(s.grain.white);
  $("black-grain").textContent = String(s.grain.black);
  $("white-account").classList.toggle("turn", s.turn === "white" && !s.outcome);
  $("black-account").classList.toggle("turn", s.turn === "black" && !s.outcome);
  $("turn").textContent = s.outcome
    ? s.outcome.kind === "win"
      ? `${s.outcome.winner === "white" ? "白" : "黒"}の勝利`
      : "引き分け"
    : `${s.turn === "white" ? "白" : "黒"}の手番`;
  $("turn").classList.toggle("result", !!s.outcome);
  if (c.getMode() === "cpu" && s.turn === "black" && !s.outcome)
    $("turn").textContent = "黒の手番 · CPU思考中";
  $("local").classList.toggle("active", c.getMode() === "local");
  $("cpu").classList.toggle("active", c.getMode() === "cpu");
  $("ply").textContent = `${s.ply} / 200 手`;
  const selected = s.pieces.find((p) => p.id === selection.pieceId);
  $("hint").textContent = s.outcome
    ? "もう一局なら「最初から」。"
    : kind
      ? INFO[kind].description
      : selected
        ? `${INFO[selected.kind].name} · 残り${selected.remaining}ターン。${INFO[selected.kind].description}`
        : "盤の駒を選ぶか、新しい駒を召喚してください。";
  $("duration").textContent = String(duration);
  $("confirm").textContent =
    selection.candidate?.type === "pass" ? "パスを確定" : "確定する";
  ($("minus") as HTMLButtonElement).disabled = duration === 1;
  ($("plus") as HTMLButtonElement).disabled = duration === 5;
  document.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((b) => {
    b.classList.toggle("active", b.dataset.kind === kind);
    b.disabled = !!s.outcome || c.getBusy();
  });
  $("summary").innerHTML = preview
    ? `支払い <strong>${preview.cost}</strong> ／ 獲得 <strong>${preview.reward}</strong><br>確定後の糧 ${preview.grainAfter} · この手番末に消える駒 ${preview.expires.length}体`
    : kind
      ? `召喚費用 <strong>${PRICES[kind] * duration}</strong> 糧<br>${duration}回先の自分の手番末に退場。自陣の空きマスを選択。`
      : "駒・期間・配置を選ぶと、費用と結果を確認できます。";
  ($("confirm") as HTMLButtonElement).disabled =
    !preview || c.getBusy() || !!s.outcome;
  ($("pass") as HTMLButtonElement).disabled = c.getBusy() || !!s.outcome;
  if (s.ply !== lastLogPly) {
    lastLogPly = s.ply;
    const es = c.getLastEvents();
    if (es.length) {
      $("log").textContent =
        es
          .filter((e) => e.type !== "income")
          .map((e) =>
            e.type === "capture"
              ? `捕獲で糧+${e.amount}`
              : e.type === "expire"
                ? `${e.pieceIds.length}体が期限切れ`
                : e.type === "move"
                  ? `${squareName(e.squares[0])} → ${squareName(e.squares[1])}`
                  : e.type === "swap"
                    ? "位置交換"
                    : e.type === "summon"
                      ? `${squareName(e.squares[0])}に召喚（糧${e.amount}）`
                      : e.type === "finish"
                        ? "対局終了"
                        : "",
          )
          .join(" · ") || "パス";
    }
  }
  board?.render(s, selection, preview);
}
document.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach(
  (b) =>
    (b.onclick = () => {
      selection = { pieceId: null, candidate: null };
      kind = b.dataset.kind as Kind;
      render();
    }),
);
$("minus").onclick = () => {
  duration = Math.max(1, duration - 1);
  selection.candidate = null;
  render();
};
$("plus").onclick = () => {
  duration = Math.min(5, duration + 1);
  selection.candidate = null;
  render();
};
$("cancel").onclick = () => {
  clear();
  render();
};
$("confirm").onclick = async () => {
  const a = selection.candidate;
  if (!a) return;
  const token = c.getToken();
  clear();
  await c.submit(a, token);
  render();
};
$("pass").onclick = () => {
  if (c.getBusy() || c.getState().outcome) return;
  kind = null;
  selection = { pieceId: null, candidate: { type: "pass" } };
  render();
};
$("restart").onclick = () => {
  if (
    c.getState().ply > 0 &&
    !confirm("進行中の対局を終了して、最初から始めますか？")
  )
    return;
  clear();
  c.restart(c.getMode());
};
function changeMode(mode: "local" | "cpu") {
  if (c.getMode() === mode) return;
  if (
    c.getState().ply > 0 &&
    !confirm("対戦方法を変えて、最初から始めますか？")
  )
    return;
  clear();
  lastLogPly = -1;
  c.restart(mode);
}
$("local").onclick = () => changeMode("local");
$("cpu").onclick = () => changeMode("cpu");
$("quality").onclick = () => {
  const active = document.body.classList.toggle("no-motion");
  $("quality").setAttribute("aria-pressed", String(active));
  render();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    clear();
    render();
  }
});
render();
