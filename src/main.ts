import "./ui/styles.css";
import { createController } from "./app/controller";
import { createOnline, NetworkError } from "./app/online";
import {
  boardTargets,
  targetMarker,
  TARGET_NAMES,
} from "./render/board-targets";
import { createBoard2D } from "./render/board2d";
import { createAdaptiveBoard } from "./render/adaptive";
import type { BoardView } from "./render/board-view";
import { recoverTransition, type BoardTransition } from "./render/motion";
import { pieceActions, validState, PRICES, KINDS } from "./game/rules";
import { previewAction, analyzeAction } from "./game/engine";
import type { Action, Kind, Selection, GameState } from "./game/types";
import { INFO, icon, squareName } from "./ui/piece-info";
import {
  actionLabel,
  coreAttackers,
  transitionText,
  expiryExplanation,
  outcomeNotice,
} from "./ui/feedback";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<main><header class="mast"><div class="brand">INTERVAL<span>糧と期限の盤</span></div><div class="toolbar"><button id="home-button" class="text-button" hidden>ホーム</button><button id="friend" class="invite-button">フレンド対戦</button><button id="menu" aria-label="遊び方・設定を開く">☰</button></div></header>
<section id="home" class="home" aria-labelledby="home-title"><div class="home-intro"><div class="eyebrow">TURN-BASED STRATEGY</div><h1 id="home-title">一手に、期限を。</h1><p>糧で駒を召喚し、相手の王（コア）を狙う。<br>残りターンのある駒で戦う、7×7の盤。</p><div class="home-emblem" aria-hidden="true"><span>◆</span><i></i><span>◇</span></div></div><section class="home-choices" aria-labelledby="mode-title"><div class="eyebrow">NEW MATCH</div><h2 id="mode-title">遊び方を選ぶ</h2><div class="mode-options" role="group" aria-label="対戦方法"><button id="choose-cpu" class="mode-choice" aria-pressed="false"><span class="mode-symbol" aria-hidden="true">◈</span><span><b>CPUと対戦</b><small>ひとりで練習。あなたは白、CPUは黒。</small></span></button><button id="choose-local" class="mode-choice" aria-pressed="false"><span class="mode-symbol" aria-hidden="true">◑</span><span><b>この端末で2人</b><small>白と黒を交互に操作。端末を渡して遊ぶ。</small></span></button><button id="choose-friend" class="mode-choice" aria-pressed="false"><span class="mode-symbol" aria-hidden="true">↗</span><span><b>フレンド対戦</b><small>招待リンクでつながる、離れた相手と。</small></span></button></div><p id="home-hint" class="fine" aria-live="polite">対戦方法を選んでから、開始してください。</p><button id="start-game" class="primary wide" disabled>対戦をはじめる</button><button id="resume-game" class="wide" hidden>中断した対局に戻る</button><p class="home-rule">最初は王（コア）だけ。自分側の3列に駒を召喚してはじめます。</p><button id="home-rules" class="text-button">遊び方を見る</button></section></section><div class="arena" id="arena" hidden><section class="playfield"><div class="scoreline"><div class="account" id="white-account"><span><i class="dot"></i>白 <small>糧</small></span><strong id="white-grain"></strong></div><div class="turnbox"><h1 id="turn" aria-live="polite"></h1><span id="mode-label">この端末で2人</span></div><div class="account" id="black-account"><span><i class="dot black"></i>黒 <small>糧</small></span><strong id="black-grain"></strong></div></div><div class="board-shell"><div class="board-host" id="board"></div></div><div class="underboard"><span>敵のコア ◆ を取れば勝利</span><span id="ply"></span></div><div id="target-legend" class="target-legend" aria-live="polite" aria-atomic="true" hidden></div><div id="board-legend" class="board-legend"><span>守 壁 · 曲 カーヴァー · 跳 リーパー · 換 リンク</span><span>丸数字 = 残りターン数（持ち主の手番）</span></div><div class="network-banner" id="network-banner" aria-live="polite" hidden></div></section>
<aside class="panel" id="controls"><section id="lobby" hidden><div class="eyebrow">FRIEND MATCH</div><h2 id="lobby-title">フレンドを招待</h2><p id="lobby-hint"></p><div class="seats" aria-live="polite" aria-atomic="true"><span id="host-seat"></span><span id="guest-seat"></span></div><button id="copy" class="primary wide">招待リンクをコピー</button><button id="share" class="wide">リンクを共有</button><input id="invite-link" aria-label="招待リンク" readonly hidden><p id="ready-note" class="fine">準備完了は取り消せません。2人が押すとすぐ始まります。席を外すときは、戻ってから押してください。</p><button id="ready" class="primary wide" aria-describedby="ready-note">準備完了</button><p class="fine">部屋は作成から24時間有効。招待リンクは対戦する1人だけに送ってください。</p></section>
<section id="game-controls"><div class="control-head"><span id="stage-label">YOUR MOVE</span><button id="cancel" class="text-button" hidden>選択解除</button></div><p id="hint" class="hint" aria-live="polite" aria-atomic="true"></p><div id="idle-controls"><button id="summon" class="primary">＋ 駒を召喚</button><button id="pass">パス</button></div><div class="pieces" id="piece-picker" hidden>${KINDS.map((k) => `<button class="choice" data-kind="${k}" aria-label="${INFO[k].name}、1ターンにつき糧${PRICES[k]}">${icon(k)}<span>${INFO[k].short}</span><span class="piece-name">${INFO[k].name}</span><small>${PRICES[k]}糧 / 1ターン</small></button>`).join("")}</div><div id="summon-details" hidden><div class="duration-row"><div class="purchase-choice"><span id="kind-label"></span><span id="purchase-facts" aria-live="polite" aria-atomic="true"></span></div><div class="duration-controls" role="group" aria-label="召喚する期間"><button id="minus" aria-label="期間を短くする">−</button><strong><span id="duration">3</span><small>ターン</small></strong><button id="plus" aria-label="期間を長くする">＋</button></div></div></div><div class="summary" id="summary" aria-live="polite" hidden></div><p id="tactical-note" class="tactical-note" aria-live="polite" hidden></p><div class="actions" id="confirm-row" hidden><button id="back">選び直す</button><button class="primary" id="confirm" disabled>確定する</button></div><div id="result-actions" hidden><button id="again" class="primary wide">もう一局</button></div></section><div class="error" id="error" role="status" hidden></div><button id="retry" class="wide" hidden>再接続 / 送信結果を確認</button><p class="log" id="log" aria-live="polite">1手の選択が、次の時間をつくる。</p></aside></div></main>
<dialog id="drawer" aria-labelledby="drawer-title"><div class="drawer-top"><h2 id="drawer-title">対局メニュー</h2><button id="close-menu" aria-label="メニューを閉じる">✕</button></div><section><h3>対戦方法</h3><div class="modebar"><button id="local">この端末で2人</button><button id="cpu">CPU対戦</button></div><button id="restart" class="wide">最初から</button><button id="leave" class="wide danger" hidden>部屋を退出する</button></section><section><h3>表示</h3><div class="settings"><button id="view">2Dに切替</button><button id="quality" aria-pressed="false">軽量表示</button><button id="motion" aria-pressed="false">動きを減らす</button></div><p id="board-status" class="fine"></p></section><section><h3>遊び方</h3><p>自分の番に召喚・移動・交換・パスのどれかを1回。駒と行き先を選び、確認して確定します。</p><p>最初に糧12。自分の手番が始まるたびに＋4、保有上限なし。自陣の手前3列へ召喚できます。中央の1列と相手側には召喚できません。</p><p>召喚費用は単価×期間（1〜5ターン）。召喚した番は期間が減らず、次の自分の手番から全自軍の残りターン数が1ずつ減ります。0で退場します。</p><p>捕獲すると相手の単価×残り期間を獲得。コア捕獲は期限切れより先に勝利。6連続パスか200手で引き分けです。</p>${KINDS.map((k) => `<div class="rule-piece">${icon(k)}<p><b>${INFO[k].name}</b><br>${INFO[k].description}</p></div>`).join("")}<p class="fine">盤の操作: Tabで盤へ、矢印で移動、Enterで選択、Escで解除。フレンド対戦は同じブラウザなら再読み込みで復帰できます。Cookieの削除・別ブラウザへの切替では復帰できません。CPU・端末内対戦は再読み込みでリセットされます。</p></section><section><h3>直前の手</h3><p id="history">まだ指されていません。</p></section></dialog>
<dialog id="friend-dialog" aria-labelledby="friend-title"><div class="drawer-top"><h2 id="friend-title">フレンド対戦</h2><button id="close-friend" aria-label="閉じる">✕</button></div><p id="friend-description">部屋をつくり、招待リンクを1人に送ってください。2人が準備完了すると対戦が始まります。</p><button id="create-room" class="primary wide">部屋をつくる</button><button id="join-room" class="primary wide" hidden>この部屋に参加</button><p id="friend-error" class="error" role="status" aria-atomic="true" hidden></p><p class="fine">アカウント登録不要。部屋の有効期限は24時間です。</p></dialog>`;
let selection: Selection = { pieceId: null, candidate: null },
  kind: Kind | null = null,
  duration = 3,
  picking = false,
  board: BoardView | undefined,
  mode: "local" | "cpu" | "online" = "local",
  renderKey = "",
  renderedSession = "",
  initializing = true;
let screen: "home" | "game" = "home";
let chosenMode: "local" | "cpu" | "friend" | null = null;
let hasMatch = false;
let lastRoomState: GameState | null = null;
let lastBoardState: GameState | null = null;
let invalidPick = "";
let copyAttempt = 0;
const c = createController(() => {
  if (!initializing) render();
});
const online = createOnline(() => {
  if (!initializing) render();
});
function state() {
  return online.room && mode === "online" ? online.room.state : c.getState();
}
function busy() {
  if (screen !== "game") return true;
  return mode === "online"
    ? online.busy ||
        online.pending ||
        !online.connected ||
        online.room?.status !== "playing" ||
        online.room?.seat !== state().turn
    : c.getBusy();
}
function clear() {
  selection = { pieceId: null, candidate: null };
  kind = null;
  picking = false;
  invalidPick = "";
}
function pick(q: number) {
  if (screen !== "game") return;
  const s = state();
  if (s.outcome) return;
  if (busy()) {
    const piece = s.pieces.find((p) => p.square === q);
    if (piece) {
      clear();
      selection.pieceId = piece.id;
      render();
    }
    return;
  }
  invalidPick = "";
  if (kind) {
    const a: Action = { type: "summon", kind, duration, to: q };
    if (previewAction(s, a)) selection = { pieceId: null, candidate: a };
    else {
      selection.candidate = null;
      invalidPick =
        PRICES[kind] * duration > s.grain[s.turn]
          ? "糧が足りません。期間を短くしてから配置してください。"
          : "光っている自陣の空きマスを選んでください。";
    }
    render();
    return;
  }
  const p = s.pieces.find((p) => p.square === q);
  const selected = s.pieces.find((piece) => piece.id === selection.pieceId);
  const actions = selected && validState(s) ? pieceActions(s, selected) : [];
  const candidate = actions.find(
    (a) =>
      (a.type === "move" && a.pieceId === selection.pieceId && a.to === q) ||
      (a.type === "swap" &&
        a.pieceId === selection.pieceId &&
        a.allyId === p?.id),
  );
  if (candidate) selection.candidate = candidate;
  else if (
    !p &&
    selection.pieceId &&
    s.pieces.some(
      (piece) => piece.id === selection.pieceId && piece.side === s.turn,
    )
  ) {
    selection.candidate = null;
    invalidPick = actions.some(
      (a) =>
        (a.type === "move" || a.type === "swap") &&
        a.pieceId === selection.pieceId,
    )
      ? "そのマスには移動できません。光る行き先を選んでください。"
      : "この駒は今は移動できません。別の駒を選ぶか、召喚・パスを選んでください。";
  } else {
    selection = { pieceId: p?.id ?? null, candidate: null };
    picking = false;
  }
  render();
}
let use3D = !new URLSearchParams(location.search).has("2d");
let boardGeneration = 0;
let createBoard3D: typeof import("./render/board3d").createBoard3D | undefined;
$("view").textContent = use3D ? "2Dに切替" : "3Dに切替";
function setupBoard() {
  board?.dispose();
  const generation = ++boardGeneration;
  const host = $("board");
  const requested3D = use3D;
  const status = (message: string) => {
    $("board-status").textContent = message;
    if (message.startsWith("2D")) use3D = false;
    $("view").textContent = use3D ? "2Dに切替" : "3Dに切替";
  };
  board =
    use3D && createBoard3D
      ? createAdaptiveBoard(
          $("board"),
          pick,
          (f) => createBoard3D!($("board"), pick, f),
          status,
        )
      : createBoard2D($("board"), pick);
  if (!requested3D) status("2D表示");
  else if (!createBoard3D) {
    status("立体表示を読み込み中 · 2Dの盤で操作できます");
    void import("./render/board3d").then(
      (module) => {
        createBoard3D = module.createBoard3D;
        if (
          generation !== boardGeneration ||
          !use3D ||
          screen !== "game" ||
          !host.isConnected ||
          $("board") !== host
        )
          return;
        const focused = document.activeElement as HTMLElement | null;
        const square = $("board").contains(focused)
          ? focused?.dataset.square
          : undefined;
        const tabSquare =
          $("board").querySelector<HTMLElement>('[tabindex="0"]')?.dataset
            .square;
        setupBoard();
        render();
        if (tabSquare !== undefined) {
          $("board")
            .querySelectorAll<HTMLElement>("[data-square]")
            .forEach((button) => {
              button.tabIndex = button.dataset.square === tabSquare ? 0 : -1;
            });
        }
        if (square !== undefined)
          $("board")
            .querySelector<HTMLElement>(`[data-square="${square}"]`)
            ?.focus();
      },
      () => {
        if (
          generation === boardGeneration &&
          use3D &&
          screen === "game" &&
          host.isConnected &&
          $("board") === host
        )
          status("2D表示 · 立体表示を読み込めないため切り替えました");
      },
    );
  }
  $("view").textContent = use3D ? "2Dに切替" : "3Dに切替";
}
function show(id: string, v: boolean) {
  $(id).hidden = !v;
}
function setText(id: string, value: string) {
  const element = $(id);
  if (element.textContent !== value) element.textContent = value;
}
function render() {
  show("home", screen === "home");
  show("arena", screen === "game");
  show("home-button", screen === "game");
  show("friend", screen === "game");
  show("resume-game", hasMatch);
  ($("start-game") as HTMLButtonElement).disabled =
    !chosenMode ||
    (!!online.room && !online.unavailable && chosenMode !== "friend");
  $("start-game").textContent =
    chosenMode === "friend"
      ? online.room
        ? "対局に戻る"
        : "フレンド対戦へ"
      : "対戦をはじめる";
  for (const choice of ["cpu", "local", "friend"])
    $("choose-" + choice).setAttribute(
      "aria-pressed",
      String(chosenMode === choice),
    );
  setText(
    "home-hint",
    online.room && !online.unavailable
      ? "参加中の部屋があります。対局に戻るか、対局メニューで退出してください。"
      : chosenMode === "cpu"
        ? "あなたが先手です。召喚する駒を選ぶところから始まります。"
        : chosenMode === "local"
          ? "このモードでは相手も人が操作します。白と黒の手番を交互に進めます。"
          : chosenMode === "friend"
            ? "部屋の作成または招待から参加後、2人の準備完了で始まります。"
            : "対戦方法を選んでから、開始してください。",
  );
  const activeRoom = mode === "online" ? online.room : null;
  ($("leave") as HTMLButtonElement).disabled = online.busy || online.pending;
  show("leave", !!activeRoom);
  show("restart", !activeRoom && screen === "game");
  ($("local") as HTMLButtonElement).disabled =
    !!activeRoom && !online.unavailable;
  ($("cpu") as HTMLButtonElement).disabled =
    !!activeRoom && !online.unavailable;
  if (screen === "home") {
    if (board) {
      board.dispose();
      board = undefined;
      boardGeneration++;
    }
    return;
  }
  if (!board) setupBoard();
  const s = state(),
    room = mode === "online" ? online.room : null,
    key = room
      ? `${room.id}:${room.version}`
      : `${c.getToken().session}:${c.getToken().revision}`;
  const sessionKey = room
    ? `room:${room.id}`
    : `${mode}:${c.getToken().session}`;
  if (sessionKey !== renderedSession) {
    board?.cancelMotion?.();
    lastBoardState = null;
    copyAttempt++;
    $("copy").textContent = "招待リンクをコピー";
    ($("invite-link") as HTMLInputElement).value = "";
    show("invite-link", false);
    const emptyHistory =
      room && s.ply > 0
        ? "現在の盤面から再開しました。"
        : "まだ指されていません。";
    setText("log", emptyHistory);
    $("history").textContent = emptyHistory;
    renderedSession = sessionKey;
    lastRoomState = null;
  }
  if (key !== renderKey) {
    clear();
    renderKey = key;
  }
  const transition: BoardTransition | null =
    lastBoardState && s.ply === lastBoardState.ply + 1
      ? room
        ? recoverTransition(lastBoardState, s)
        : { before: lastBoardState, events: c.getLastEvents() }
      : null;
  if (room && lastRoomState) {
    const line = transitionText(
      lastRoomState,
      s,
      lastRoomState === lastBoardState ? transition : undefined,
    );
    if (line) {
      setText("log", line);
      $("history").textContent = line;
    }
  }
  lastRoomState = room ? s : null;
  const analysis = selection.candidate
    ? analyzeAction(s, selection.candidate)
    : null;
  const pv = analysis?.preview ?? null;
  if (selection.candidate && !pv) selection.candidate = null;
  const locked = busy() || !!s.outcome,
    selected = s.pieces.find((p) => p.id === selection.pieceId),
    isLobby = !!room && room.status === "waiting",
    closed = room?.status === "closed",
    movable = !!selected && pieceActions(s, selected).length > 0;
  $("white-grain").textContent = String(s.grain.white);
  $("black-grain").textContent = String(s.grain.black);
  $("white-account").classList.toggle("turn", s.turn === "white" && !s.outcome);
  $("black-account").classList.toggle("turn", s.turn === "black" && !s.outcome);
  setText(
    "turn",
    mode === "online" && !room
      ? online.busy
        ? "対局を復元中"
        : "接続を確認"
      : closed
        ? "対戦終了"
        : isLobby
          ? "参加を待機"
          : s.outcome
            ? s.outcome.kind === "win"
              ? `${s.outcome.winner === "white" ? "白" : "黒"}の勝利`
              : "引き分け"
            : `${s.turn === "white" ? "白" : "黒"}の手番`,
  );
  $("turn").classList.toggle("result", !!s.outcome);
  $("mode-label").textContent = room
    ? `あなたは${room.seat === "white" ? "白" : "黒"}`
    : mode === "online"
      ? "フレンド対戦"
      : mode === "cpu"
        ? "CPU対戦 · あなたは白"
        : "この端末で2人";
  $("ply").textContent = `${s.ply} / 200 手`;
  $("stage-label").textContent = s.outcome
    ? "RESULT"
    : locked
      ? "WAITING"
      : selection.candidate
        ? "CONFIRM"
        : kind
          ? "PLACE"
          : picking
            ? "SUMMON"
            : selected
              ? movable
                ? "MOVE"
                : "PIECE INFO"
              : "YOUR MOVE";
  setText(
    "hint",
    closed
      ? "退出により部屋が終了しました。新しい部屋でまた遊べます。"
      : s.outcome
        ? s.outcome.kind === "win"
          ? `${s.outcome.winner === "white" ? "白" : "黒"}が相手のコアを捕獲しました。`
          : s.outcome.reason === "passes"
            ? "6回連続のパスで引き分けです。"
            : "200手に達したため引き分けです。"
        : mode === "online" && online.pending
          ? "送信結果を確認しています。再接続ボタンで同じ操作の結果を確認できます。"
          : invalidPick
            ? invalidPick
            : selection.candidate
              ? actionLabel(s, selection.candidate)
              : selected
                ? `${selected.side === "white" ? "白" : "黒"}の${INFO[selected.kind].name} · 残り${selected.remaining}ターン${selected.kind === "bastion" ? "。この駒は移動できません。" : selected.side === s.turn && !movable ? "。今は行き先がありません。" : ""}`
                : mode === "online" && !online.connected
                  ? "接続を確認しています。復帰後に続けられます。"
                  : locked
                    ? mode === "cpu"
                      ? "CPUが考えています…"
                      : online.busy
                        ? "送信中…"
                        : "相手の手番です。駒を押すと動きを確認できます。"
                    : kind
                      ? PRICES[kind] * duration > s.grain[s.turn]
                        ? "糧が足りません。期間を短くしてから配置してください。"
                        : `${INFO[kind].name}を光るマスに配置`
                      : picking
                        ? "召喚する駒を選ぶ"
                        : s.ply === 0
                          ? "まずは駒を召喚。カーヴァーは単独で前に進めます。"
                          : mode === "local"
                            ? `${s.turn === "white" ? "白" : "黒"}の人の番です。駒を選ぶか、召喚してください。`
                            : "盤の駒を選ぶか、新しい駒を召喚",
  );
  const restoreLobbyFocus =
    !isLobby &&
    !$("lobby").hidden &&
    $("lobby").contains(document.activeElement);
  document.querySelector("main")!.classList.toggle("is-lobby", isLobby);
  show("lobby", isLobby);
  show("game-controls", !isLobby);
  show(
    "idle-controls",
    !picking &&
      (!selected || !movable) &&
      !selection.candidate &&
      !s.outcome &&
      !closed,
  );
  show("piece-picker", picking && !selection.candidate);
  show("summon-details", !!kind && !selection.candidate);
  show("summary", !!pv || !!kind || !!selected);
  show("confirm-row", !!pv);
  show("cancel", picking || !!selected || !!selection.candidate);
  show("result-actions", !!s.outcome || !!closed);
  $("duration").textContent = String(duration);
  $("kind-label").textContent = kind ? INFO[kind].name : "";
  const purchaseCost = kind ? PRICES[kind] * duration : 0;
  setText(
    "purchase-facts",
    kind
      ? `${duration}ターンで${purchaseCost}糧 · ${purchaseCost > s.grain[s.turn] ? `${purchaseCost - s.grain[s.turn]}糧不足` : `残り${s.grain[s.turn] - purchaseCost}糧`}`
      : "",
  );
  const summary = pv
    ? `<div class="preview-numbers"><span>支払う <b>${pv.cost}</b></span><span>獲得 <b>${pv.reward}</b></span><span>残る糧 <b>${pv.grainAfter}</b></span></div><span class="expiry-note">${
        pv.expires.length
          ? `この手番末に ${pv.expires.length} 体が退場（${pv.expires
              .map((id) => s.pieces.find((p) => p.id === id)!)
              .map((p) => `${squareName(p.square)} ${INFO[p.kind].name}`)
              .join("、")}）`
          : "この手番末の退場なし"
      }${selection.candidate?.type === "summon" ? ` · 期間${duration}ターン` : ""}</span>`
    : kind
      ? `<span class="piece-explanation">${INFO[kind].description}</span><b>${PRICES[kind] * duration} 糧</b> を先払い · 期間 ${duration} ターン${PRICES[kind] * duration > s.grain[s.turn] ? '<span class="shortage">糧が足りません。期間を短くしてください。</span>' : '<span class="expiry-note">召喚した番は期間が減りません。</span>'}`
      : selected
        ? `<b class="selected-name">${INFO[selected.kind].name}</b><span class="piece-explanation">${INFO[selected.kind].description}</span><span class="expiry-note">${expiryExplanation(s, selected)}${selected.side !== s.turn || busy() ? '<span class="inspection-note">点線は現在の移動・交換先（参考）。この駒は今は操作できません。</span>' : ""}</span>`
        : "";
  if ($("summary").innerHTML !== summary) $("summary").innerHTML = summary;
  const simulated = analysis?.transition;
  const danger =
    simulated?.ok && !simulated.state.outcome
      ? coreAttackers(simulated.state, s.turn).length
      : 0;
  const threatened =
    !s.outcome && !isLobby ? coreAttackers(s, s.turn).length : 0;
  const note =
    simulated?.ok && simulated.state.outcome
      ? outcomeNotice(simulated.state.outcome)
      : danger
        ? "注意: この手の後、相手はコアを捕獲できます。"
        : !selection.candidate && threatened
          ? "コアが狙われています。攻撃する駒の捕獲や経路の防御を確認しましょう。"
          : "";
  setText("tactical-note", note);
  show("tactical-note", !!note);
  $("confirm").textContent =
    selection.candidate?.type === "pass"
      ? "パスを確定"
      : selection.candidate?.type === "summon"
        ? "召喚を確定"
        : "この手を確定";
  $("confirm") as HTMLButtonElement;
  ($("confirm") as HTMLButtonElement).disabled = !pv || locked;
  ($("summon") as HTMLButtonElement).disabled = locked;
  ($("pass") as HTMLButtonElement).disabled = locked;
  ($("minus") as HTMLButtonElement).disabled = duration === 1;
  ($("plus") as HTMLButtonElement).disabled = duration === 5;
  document.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((b) => {
    b.classList.toggle("active", b.dataset.kind === kind);
    b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
    b.disabled = locked || PRICES[b.dataset.kind as Kind] > s.grain[s.turn];
  });
  if (room) {
    $("lobby-title").textContent = room.joined
      ? "2人がそろいました"
      : "フレンドを招待";
    $("lobby-hint").textContent = room.joined
      ? "2人とも準備完了で対戦が始まります。"
      : "リンクを送って、参加を待ちましょう。";
    setText(
      "host-seat",
      `白 · ${room.seat === "white" ? "あなた" : "ホスト"} ${room.ready.white ? "✓ 準備完了" : ""}`,
    );
    setText(
      "guest-seat",
      `黒 · ${room.joined ? (room.seat === "black" ? "あなた" : "フレンド") : "参加待ち"} ${room.ready.black ? "✓ 準備完了" : ""}`,
    );
    show("copy", room.seat === "white");
    show("share", room.seat === "white" && !!navigator.share);
    $("ready").textContent = room.ready[room.seat] ? "準備完了 ✓" : "準備完了";
    ($("ready") as HTMLButtonElement).disabled =
      room.ready[room.seat] ||
      online.busy ||
      online.pending ||
      !online.connected;
  }
  show("error", mode === "online" && !!online.error);
  setText("error", online.error);
  show("retry", mode === "online" && (!!online.error || online.pending));
  ($("retry") as HTMLButtonElement).disabled = online.busy;
  ($("leave") as HTMLButtonElement).disabled = online.busy || online.pending;
  show("network-banner", !!room && !isLobby && !s.outcome);
  setText(
    "network-banner",
    online.pending
      ? "送信結果の確認待ち · 同じ操作を安全に再確認できます"
      : online.busy
        ? "送信中…"
        : !online.connected
          ? "接続を確認しています。盤面が戻るまで操作をお待ちください。"
          : room?.status === "closed"
            ? "この部屋は終了しました"
            : room?.state.turn === room?.seat
              ? "あなたの手番です"
              : "フレンドの手番です",
  );
  show("leave", !!room);
  show("restart", !room);
  ($("local") as HTMLButtonElement).disabled = !!room && !online.unavailable;
  ($("cpu") as HTMLButtonElement).disabled = !!room && !online.unavailable;
  $("again").textContent = room ? "新しい部屋で遊ぶ" : "もう一局";
  $("local").classList.toggle("active", mode === "local");
  $("cpu").classList.toggle("active", mode === "cpu");
  if (!room) {
    const es = c.getLastEvents();
    if (es.length) {
      const line =
        es
          .filter((e) => e.type !== "income")
          .map((e) =>
            e.type === "capture"
              ? `捕獲 +${e.amount}糧`
              : e.type === "expire"
                ? `${e.pieceIds.length}体が退場`
                : e.type === "move"
                  ? `${squareName(e.squares[0])} → ${squareName(e.squares[1])}`
                  : e.type === "swap"
                    ? "位置交換"
                    : e.type === "summon"
                      ? `${squareName(e.squares[0])}に召喚`
                      : e.type === "finish"
                        ? "対局終了"
                        : "",
          )
          .join(" · ") || "パス";
      setText("log", line);
      $("history").textContent = line;
    }
  }
  selection.summon = kind ? { kind, duration } : null;
  selection.inspectOnly = !!selected && (selected.side !== s.turn || busy());
  const targetInfo = boardTargets(s, selection);
  const showTargets = !isLobby && !s.outcome && (!!selected || !!kind);
  show("target-legend", showTargets);
  show("board-legend", !showTargets);
  $("target-legend").classList.toggle(
    "reference-legend",
    targetInfo.inspectOnly,
  );
  const counts = [...targetInfo.kinds.values()].reduce(
    (out, k) => out.set(k, (out.get(k) ?? 0) + 1),
    new Map<keyof typeof TARGET_NAMES, number>(),
  );
  const destination = pv?.targets[0];
  const targetLegend = showTargets
    ? `<span class="target-context">${selected ? `${squareName(selected.square)} ${targetInfo.inspectOnly ? "参考・操作不可" : "選択中"}` : "配置先"}${destination !== undefined ? ` → ${squareName(destination)} <b>確定前</b>` : ""}</span><span class="target-key">${targetInfo.inspectOnly ? `<span class="reference-swatch" aria-hidden="true"></span>点線 ${targetInfo.targets.size}マス` : [...counts].map(([k, n]) => `<span class="target-key-item">${targetMarker(k)}${TARGET_NAMES[k]} ${n}</span>`).join("") || (kind ? "配置できるマスなし" : "行き先なし")}</span>`
    : "";
  if ($("target-legend").dataset.visual !== targetLegend) {
    $("target-legend").innerHTML = targetLegend;
    $("target-legend").dataset.visual = targetLegend;
  }

  board?.render(s, selection, pv, transition);
  lastBoardState = s;
  if (restoreLobbyFocus && !document.querySelector("dialog[open]"))
    document.querySelector<HTMLElement>('#board [tabindex="0"]')?.focus();
}
const displayPreferenceKey = "interval-display-preferences";
const displaySettings = [
  { id: "quality", className: "low-quality" },
  { id: "motion", className: "no-motion" },
] as const;
let savedDisplay: unknown;
try {
  savedDisplay = JSON.parse(
    localStorage.getItem(displayPreferenceKey) ?? "null",
  );
} catch {
  // Blocked or malformed storage must not prevent the game from starting.
}
for (const { id, className } of displaySettings) {
  const enabled =
    !!savedDisplay &&
    typeof savedDisplay === "object" &&
    !Array.isArray(savedDisplay) &&
    (savedDisplay as Record<string, unknown>)[id] === true;
  document.body.classList.toggle(className, enabled);
  $(id).setAttribute("aria-pressed", String(enabled));
}
function saveDisplayPreferences() {
  try {
    localStorage.setItem(
      displayPreferenceKey,
      JSON.stringify(
        Object.fromEntries(
          displaySettings.map(({ id, className }) => [
            id,
            document.body.classList.contains(className),
          ]),
        ),
      ),
    );
  } catch {
    // The selected settings still work for this visit when storage is unavailable.
  }
}
c.pause();
initializing = false;
render();
function keyboardFocus(event: MouseEvent, selector: string) {
  if (event.detail === 0)
    document.querySelector<HTMLElement>(selector)?.focus();
}
function keyboardGameFocus(event: MouseEvent) {
  const target = !$("lobby").hidden
    ? !($("ready") as HTMLButtonElement).disabled
      ? "#ready"
      : !$("copy").hidden
        ? "#copy"
        : "#home-button"
    : '#board [tabindex="0"]';
  keyboardFocus(event, target);
}
$("summon").onclick = (event) => {
  if (busy() || state().outcome) return;
  clear();
  picking = true;
  selection = { pieceId: null, candidate: null };
  render();
  keyboardFocus(event, "[data-kind]:not(:disabled)");
};
document.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach(
  (b) =>
    (b.onclick = (event) => {
      if (busy()) return;
      invalidPick = "";
      picking = true;
      kind = b.dataset.kind as Kind;
      selection = { pieceId: null, candidate: null };
      render();
      keyboardFocus(
        event,
        '#board .target, #board [data-available="true"], #minus:not(:disabled)',
      );
    }),
);
$("minus").onclick = () => {
  invalidPick = "";
  duration = Math.max(1, duration - 1);
  selection.candidate = null;
  render();
};
$("plus").onclick = () => {
  invalidPick = "";
  duration = Math.min(5, duration + 1);
  selection.candidate = null;
  render();
};
$("cancel").onclick = (event) => {
  clear();
  render();
  keyboardFocus(event, busy() ? '#board [tabindex="0"]' : "#summon");
};
$("back").onclick = (event) => {
  invalidPick = "";
  selection.candidate = null;
  render();
  keyboardFocus(
    event,
    kind || selection.pieceId ? '#board [tabindex="0"]' : "#summon",
  );
};
$("pass").onclick = (event) => {
  if (busy() || state().outcome) return;
  clear();
  selection.candidate = { type: "pass" };
  render();
  keyboardFocus(event, "#confirm");
};
$("confirm").onclick = async (event) => {
  const a = selection.candidate;
  if (!a || busy()) return;
  clear();
  if (mode === "online") await online.submit(a);
  else await c.submit(a, c.getToken());
  render();
  keyboardFocus(event, '#board [tabindex="0"]');
};
function dialog(id: string, open: boolean) {
  const d = $(id) as HTMLDialogElement;
  if (open) {
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  } else if (typeof d.close === "function") d.close();
  else d.removeAttribute("open");
}
$("menu").onclick = () => dialog("drawer", true);
$("home-rules").onclick = () => dialog("drawer", true);
for (const choice of ["cpu", "local", "friend"] as const) {
  $("choose-" + choice).onclick = () => {
    if (screen !== "home") return;
    chosenMode = choice;
    render();
  };
}
function enterGame() {
  screen = "game";
  hasMatch = true;
  render();
}
$("start-game").onclick = (event) => {
  if (!chosenMode) return;
  if (chosenMode === "friend") {
    if (online.room) {
      enterGame();
      keyboardGameFocus(event);
      return;
    }
    openFriendDialog();
    return;
  }
  if (online.room && !online.unavailable) return;
  if (
    hasMatch &&
    state().ply > 0 &&
    !state().outcome &&
    !confirm("中断した対局を終了して、新しい対局を始めますか？")
  )
    return;
  if (mode === "online" || online.busy || history.state?.invite) {
    online.stop();
    history.replaceState(null, "", location.pathname);
  }
  mode = chosenMode;
  clear();
  screen = "game";
  hasMatch = true;
  c.restart(mode);
  render();
  keyboardGameFocus(event);
};
$("resume-game").onclick = (event) => {
  if (!hasMatch) return;
  screen = "game";
  if (mode !== "online") {
    if (online.busy) online.stop();
    c.resume();
  }
  render();
  keyboardGameFocus(event);
};
$("home-button").onclick = () => {
  if (screen !== "game") return;
  const message =
    mode === "online"
      ? "席を保持してホームに戻りますか？フレンド対戦は一時停止されません。"
      : "対局を一時停止してホームに戻りますか？このページを開いている間は再開できます。";
  if (!state().outcome && !confirm(message)) return;
  if (mode !== "online") c.pause();
  clear();
  screen = "home";
  dialog("drawer", false);
  render();
  $("resume-game").focus();
};
$("close-menu").onclick = () => dialog("drawer", false);
function openFriendDialog() {
  const invited = !!history.state?.invite && !!history.state?.room;
  $("friend-title").textContent = invited
    ? "招待が届いています"
    : "フレンド対戦";
  $("friend-description").textContent = invited
    ? "参加すると黒の席に着きます。準備完了で対戦が始まります。"
    : "部屋をつくり、招待リンクを1人に送ってください。2人が準備完了すると対戦が始まります。";
  show("create-room", !invited);
  show("join-room", invited);
  show("friend-error", false);
  dialog("friend-dialog", true);
}
$("friend").onclick = () => {
  if (online.room) dialog("drawer", true);
  else openFriendDialog();
};
$("close-friend").onclick = () => dialog("friend-dialog", false);
function reset(m: "local" | "cpu") {
  if (screen === "home") {
    chosenMode = m;
    dialog("drawer", false);
    render();
    return;
  }
  if (mode === "online" && online.room && !online.unavailable) return;
  if (mode === "online") {
    online.stop();
    history.replaceState(null, "", location.pathname);
  }
  if (
    state().ply > 0 &&
    !state().outcome &&
    !confirm("進行中の対局を終了して、最初から始めますか？")
  )
    return;
  if (online.busy || history.state?.invite) {
    online.stop();
    history.replaceState(null, "", location.pathname);
  }
  clear();
  mode = m;
  screen = "game";
  hasMatch = true;
  c.restart(m);
  dialog("drawer", false);
  render();
}
$("restart").onclick = () => reset(mode === "cpu" ? "cpu" : "local");
$("local").onclick = () => reset("local");
$("cpu").onclick = () => reset("cpu");
$("view").onclick = () => {
  use3D = !use3D;
  if (screen === "game") setupBoard();
  else {
    board?.dispose();
    board = undefined;
    boardGeneration++;
    $("view").textContent = use3D ? "2Dに切替" : "3Dに切替";
  }
  render();
};
$("quality").onclick = () => {
  $("quality").setAttribute(
    "aria-pressed",
    String(document.body.classList.toggle("low-quality")),
  );
  saveDisplayPreferences();
  render();
};
$("motion").onclick = () => {
  $("motion").setAttribute(
    "aria-pressed",
    String(document.body.classList.toggle("no-motion")),
  );
  saveDisplayPreferences();
  if (document.body.classList.contains("no-motion")) board?.cancelMotion?.();
};
function allowFriendEntry() {
  return (
    mode === "online" ||
    state().ply === 0 ||
    !!state().outcome ||
    confirm("進行中の対局を終了して、フレンド対戦を始めますか？")
  );
}
function locationRoom(id: string) {
  history.replaceState(null, "", `${location.pathname}?room=${id}`);
}
$("create-room").onclick = async () => {
  if (online.busy || !allowFriendEntry()) return;
  ($("create-room") as HTMLButtonElement).disabled = true;
  try {
    const r = await online.create();
    mode = "online";
    screen = "game";
    hasMatch = true;
    c.restart("local");
    c.pause();
    locationRoom(r.id);
    dialog("friend-dialog", false);
    clear();
    render();
  } catch (e) {
    if (e instanceof NetworkError && e.code === "CANCELLED") return;
    $("friend-error").textContent = (e as Error).message;
    show("friend-error", true);
  } finally {
    ($("create-room") as HTMLButtonElement).disabled = false;
  }
};
$("ready").onclick = () => void online.ready();
$("retry").onclick = () => void online.retry();
function inviteLink() {
  const r = online.room;
  return r?.invite
    ? `${location.origin}${location.pathname}#room=${r.id}&invite=${r.invite}`
    : "";
}
$("copy").onclick = async () => {
  const link = inviteLink();
  if (!link) return;
  const attempt = ++copyAttempt;
  try {
    await navigator.clipboard.writeText(link);
    if (attempt !== copyAttempt) return;
    $("copy").textContent = "コピーしました ✓";
    setTimeout(() => {
      if (attempt === copyAttempt) $("copy").textContent = "招待リンクをコピー";
    }, 2000);
  } catch {
    if (attempt !== copyAttempt) return;
    const input = $("invite-link") as HTMLInputElement;
    input.value = link;
    input.hidden = false;
    input.focus();
    input.select();
    $("copy").textContent = "下のリンクをコピーしてください";
  }
};
$("share").onclick = async () => {
  try {
    await navigator.share({
      title: "INTERVAL フレンド対戦",
      url: inviteLink(),
    });
  } catch {}
};
$("leave").onclick = async () => {
  if (
    !confirm(
      "部屋を退出しますか？進行中の対戦は終了し、この部屋では再開できません。",
    )
  )
    return;
  const left = online.unavailable || (await online.leave());
  if (left) {
    online.stop();
    copyAttempt++;
    ($("invite-link") as HTMLInputElement).value = "";
    show("invite-link", false);
    mode = "local";
    screen = "home";
    hasMatch = false;
    history.replaceState(null, "", location.pathname);
    c.restart("local");
    c.pause();
    dialog("drawer", false);
    render();
  }
};
$("again").onclick = (event) => {
  if (mode === "online") {
    online.stop();
    copyAttempt++;
    ($("invite-link") as HTMLInputElement).value = "";
    show("invite-link", false);
    mode = "local";
    screen = "home";
    hasMatch = false;
    c.restart("local");
    c.pause();
    history.replaceState(null, "", location.pathname);
    openFriendDialog();
    render();
  } else {
    reset(mode);
    keyboardFocus(event, '#board [tabindex="0"]');
  }
};
const fragment = new URLSearchParams(location.hash.slice(1)),
  joinId = fragment.get("room"),
  joinToken = fragment.get("invite");
if (
  joinId &&
  /^[a-f0-9]{32}$/.test(joinId) &&
  joinToken &&
  /^[a-f0-9]{64}$/.test(joinToken)
) {
  history.replaceState(
    { invite: joinToken, room: joinId },
    "",
    `${location.pathname}?room=${joinId}`,
  );
}
const pendingInvite = history.state?.invite,
  pendingRoom = history.state?.room;
if (pendingInvite && pendingRoom) {
  openFriendDialog();
  $("join-room").onclick = async () => {
    if (online.busy || !allowFriendEntry()) return;
    ($("join-room") as HTMLButtonElement).disabled = true;
    try {
      await online.join(pendingRoom, pendingInvite);
      mode = "online";
      screen = "game";
      hasMatch = true;
      c.restart("local");
      c.pause();
      locationRoom(pendingRoom);
      dialog("friend-dialog", false);
      render();
    } catch (e) {
      if (e instanceof NetworkError && e.code === "CANCELLED") return;
      $("friend-error").textContent = (e as Error).message;
      show("friend-error", true);
    } finally {
      ($("join-room") as HTMLButtonElement).disabled = false;
    }
  };
} else {
  const id = new URLSearchParams(location.search).get("room");
  if (id && /^[a-f0-9]{32}$/.test(id)) {
    mode = "online";
    screen = "game";
    hasMatch = true;
    render();
    void online.resume(id);
  }
}
document.addEventListener("keydown", (e) => {
  if (
    screen === "game" &&
    e.key === "Escape" &&
    !document.querySelector("dialog[open]")
  ) {
    const active = document.activeElement;
    clear();
    render();
    if (
      active instanceof HTMLElement &&
      (!active.isConnected ||
        active.closest("[hidden]") ||
        active.matches(":disabled"))
    ) {
      document
        .querySelector<HTMLElement>(
          busy() || state().outcome ? '#board [tabindex="0"]' : "#summon",
        )
        ?.focus();
    }
  }
});
const webmcp = (
  document as unknown as {
    modelContext?: { registerTool(t: unknown): Promise<void> };
  }
).modelContext;
if (webmcp?.registerTool)
  void webmcp
    .registerTool({
      name: "read_interval_board",
      title: "Read INTERVAL board",
      description:
        "Read the current visible game state and whose turn it is. Does not play a move.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input: unknown) {
        if (!input || typeof input !== "object" || Object.keys(input).length)
          throw new Error("No arguments accepted");
        return {
          screen,
          mode: screen === "game" ? mode : null,
          state: screen === "game" ? state() : null,
          seat: online.room?.seat ?? null,
        };
      },
    })
    .catch(() => {});
