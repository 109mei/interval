# 期限付きチェス型ゲーム Implementation Plan

> 実装担当者へ: 書面レビュー後、以下のチェック項目を順に実行する。各機能は失敗するテスト、最小実装、成功確認の順で進める。

**Goal:** 上限なしの糧と期限付きの独自4駒を使い、3D表示でCPU戦とローカル2人戦を最後まで遊べるブラウザーゲームを作る。
**Architecture:** UI・CPU・3D/2D表示で純粋なルールエンジンを共有。状態更新は1か所に集約する。
**Tech Stack:** TypeScript、Vite、Three.js、HTML/CSS、Vitest、Playwright。形状は手続き生成。
**Spec:** `docs/superpowers/specs/2026-10-07-timed-chess-design.md`。同梱の最新版を参照する。
**Status:** 計画レビューと実行方法の確認待ち。製品コード、インストール、ビルド、公開は未実施。

## Global Constraints

- 7×7盤、白先手、コアd1/d7、初期バスティオンd2/d6・残り3。敵コア捕獲で即勝利。
- 開始12糧、自分の手番開始に4糧。保有上限なし。最初に使える糧は各16。単価はバスティオン1・カーヴァー3・リーパー2・リンク1。
- 召喚期間1〜5、費用は単価×期間。捕獲報酬は敵の単価×捕獲時の残りターン数。収入・報酬の切り捨てなし。
- 自陣2列に召喚。1手番1行動。召喚手番の新駒は寿命減算なし。以後、自手番末に自軍全駒を減算・0を同時除去。コア捕獲は消滅より優先。
- 連続6パスまたは合計200手で引き分け。勝利を優先し、パス以外で連続パス数をリセット。
- 白黒の形状で4種を識別し、駒面に漢字を載せない。数字は残りターン。390×844とデスクトップ、タップ・キーボード・2D切替に対応。
- ローカル2人戦と基本CPU戦。保存、ネット対戦、アカウント、課金、解析送信なし。リロードで対局終了。
- この新規プロジェクト内だけを変更する。既存の別プロジェクト、有料契約、購入、公開・外部送信、破壊的変更は対象外。

## Review Focus

1. 連打・古い画面からの確定: 同じ行動で2手進まない。Task 2で検証。
2. CPU思考待ち中の再戦・モード変更: 前の対局の結果を新しい盤に適用しない。Task 4で検証。
3. WebGL初期化失敗・実行中のコンテキスト喪失: 盤面を維持して2Dで続行できる。Task 3で検証。
4. 非整数・盤外・不正ID・重複占有: 不正入力で残高や手番を変更しない。Task 1で検証。
5. 画面縮小・大きな残高・フォーカス移動: 数字と確定ボタンを隠さず、同じ操作をキーボードで完了できる。Task 2・5で検証。

## ファイル構成と共通契約

- `src/game/types.ts`: 下記の型。`rules.ts`: 定数と合法手。`engine.ts`: 初期状態・状態遷移・予告。DOM非依存。
- `src/app/controller.ts`: 対局・入力確定・演出待ち・CPU予約。`src/ui/hud.ts`、`input.ts`、`styles.css`: HTML表示と入力。
- `src/render/board-view.ts`: 表示契約。`board2d.ts`: HTML盤。`board3d.ts`、`pieces.ts`: Three.js盤と4形状。
- `src/cpu/choose-action.ts`: 合法手の評価。`src/main.ts`: モード・表示を組み立てる。
- `tests/game.test.ts`、`controller.test.ts`、`renderer.test.ts`、`cpu.test.ts`、`fixtures.ts`: 単体・結合検証。`e2e/game.spec.ts`: ブラウザー検証。
- ルートには`package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`playwright.config.ts`、`index.html`、`README.md`を作る。

共通型。状態は読取専用とし、更新時に新状態を返す。
- `Side = 'white' | 'black'`、`Kind = 'bastion' | 'carver' | 'leaper' | 'link'`、`Square = number`（a1=0、g7=48）。
- `Piece = { id:string; side:Side; kind:Kind; square:Square; remaining:number; summonedPly:number }`。
- `Outcome = {kind:'win'; winner:Side} | {kind:'draw'; reason:'passes'|'limit'} | null`。
- `GameState = { pieces:readonly Piece[]; cores:Record<Side,Square>; grain:Record<Side,number>; turn:Side; ply:number; consecutivePasses:number; outcome:Outcome }`。
- `Action = {type:'summon'; kind:Kind; duration:number; to:Square} | {type:'move'; pieceId:string; to:Square} | {type:'swap'; pieceId:string; allyId:string} | {type:'pass'}`。
- `GameEvent = {type:'summon'|'move'|'swap'|'capture'|'income'|'expire'|'finish'; side:Side; pieceIds:readonly string[]; squares:readonly Square[]; amount:number}`。該当しない配列は空、金額は0。
- `Transition = {ok:true; state:GameState; events:readonly GameEvent[]} | {ok:false; state:GameState; error:string}`。
- `Preview = {cost:number; reward:number; grainAfter:number; expires:readonly string[]; targets:readonly Square[]; paths:readonly (readonly Square[])[]}`。金額は現在の手番側の行動分で、次の手番収入を含めない。
- `Selection = {pieceId:string|null; candidate:Action|null}`。`BoardView = {render(state:GameState, selection:Selection, preview:Preview|null):void; dispose():void}`。

### Task 1: ルール・経済・寿命を確定する

**Files:** ルートの開発設定、`src/game/{types,rules,engine}.ts`、`tests/{game.test,fixtures}.ts`。
**Interfaces:** `createGame():GameState`、`legalActions(state:GameState):readonly Action[]`、`applyAction(state:GameState, action:Action):Transition`、`previewAction(state:GameState, action:Action):Preview|null`。
初期`grain={white:16,black:12}`。遷移は寿命処理後に次の手番収入を1度だけ加算。終局後は加算しない。

- [ ] Step 1: 実装承認後に開発設定を作る。`test=vitest run`、`build=tsc --noEmit && vite build`、`test:e2e=playwright test`を定義。
- [ ] Step 2: 失敗するテストを記述する。`first_income_once`は白16/黒12→白パス後黒16。`capture_weighted_unlimited`は保有20・単価3残り4の敵を取った直後32。`income_unlimited`は24→28。攻撃側の単価を変えても同じ報酬。
- [ ] Step 3: `duration_one`は召喚直後1→次の自手番末消滅、期間5も同じ基準。`all_owned_age`は未移動と交換相手も減算、相手駒は不変。`capture_before_expiry`は残り1でコアを取れば勝利。パス6・200手・勝利優先・パス数リセットも検証。
- [ ] Step 4: 全方向と盤端で4駒の合法手を列挙検証。カーヴァーの全途中マス、リーパーの味方/敵踏み台と着地点のみ捕獲、リンクのコア除外を確認。不正期間0/6/1.5、盤外、未知ID、占有先への召喚・移動は`ok:false`かつ入力状態不変。
- [ ] Step 5: `npm test -- tests/game.test.ts`を実行し、未実装による失敗を確認してから共通契約を最小実装。`npm test -- tests/game.test.ts`と`npm run build`の成功、各マス最大1体・糧非負・駒ID一意を確認。
- [ ] Step 6: 対象ファイルだけをコミットする。メッセージ: `feat: implement timed chess rules and economy`。

### Task 2: 操作できる2D盤とHUDを作る

**Files:** `src/app/controller.ts`、`src/ui/hud.ts`、`src/ui/input.ts`、`src/ui/styles.css`、`src/render/{board-view,board2d}.ts`、`src/main.ts`、`index.html`、`tests/controller.test.ts`。
**Interfaces:** Task 1を利用。`createController(onChange:(state:GameState)=>void):Controller`。`Controller`は`getState():GameState`、`getToken():{session:number;revision:number}`、`submit(action:Action, token:{session:number;revision:number}):Promise<boolean>`、`restart(mode:'local'|'cpu'):void`、`dispose():void`。成功した確定でrevisionを増やし、再戦でsessionを増やす。
`createBoard2D(host:HTMLElement,onSquare:(square:Square)=>void):BoardView`、`mountHud(host:HTMLElement,controller:Controller):{render(state:GameState,selection:Selection,preview:Preview|null):void;dispose():void}`。

- [ ] Step 1: 失敗するテスト`duplicate_confirmation`で同じtokenの2回確定は1回だけ成功。`stale_selection`は古いtokenを拒否。`cancel_free`は取消で糧・寿命・手番不変。`finished_locked`は終局後の入力を拒否する。
- [ ] Step 2: `npm test -- tests/controller.test.ts`で未実装の失敗を確認。確認・取消、パス、再戦、モード選択と2D盤を実装し、同コマンドを成功させる。
- [ ] Step 3: 召喚・移動・交換の選択、確定、取消と仕様の全予告表示を実装。処理中ロックとtokenで連打を遮断。
- [ ] Step 4: 仕様のキーボード操作、読み上げ、フォーカス維持を実装。スマホは盤の下、PCは横に操作欄。残高9999でも隠れない検証を追加。
- [ ] Step 5: `npm test -- tests/controller.test.ts`と`npm run build`を成功させ、`feat: add playable board and turn controls`で対象ファイルをコミット。

### Task 3: 立体駒と安全な表示切替を作る

**Files:** `src/render/{board3d,pieces}.ts`、`tests/renderer.test.ts`。`src/main.ts`と`src/ui/styles.css`を更新。
**Interfaces:** `createPieceModel(kind:Kind,side:Side):THREE.Group`、`createBoard3D(host:HTMLElement,onSquare:(square:Square)=>void,onFailure:()=>void):BoardView`。初期化失敗時は例外を捕捉し、実行中の喪失時は`onFailure`で既存状態の2D表示を作る。

- [ ] Step 1: 失敗するテスト`renderer_does_not_mutate`、`fallback_preserves_state`、`dispose_releases_resources`を記述。例外・コンテキスト喪失後も盤・残高・手番が同じで、次の1手が操作できることを検証。
- [ ] Step 2: `npm test -- tests/renderer.test.ts`で失敗確認。仕様の固定視点・白黒4形状・数字表示をThree.js基本形状とHTMLで実装。
- [ ] Step 3: 光線判定をSquareへ変換し、共通の盤入力へ渡す。3D/2D切替、残高と残存数の同期、影・解像度・動きの軽減、描画リソースの破棄を実装。
- [ ] Step 4: 単体テストと`npm run build`を成功させ、同じアクション列の3D/2Dの最終GameState一致を確認。`feat: add sculpted 3d pieces and 2d fallback`でコミット。

### Task 4: 基本CPUと対局の中断対策を作る

**Files:** `src/cpu/choose-action.ts`、`tests/cpu.test.ts`。`src/app/controller.ts`と`tests/controller.test.ts`を更新。
**Interfaces:** `chooseCpuAction(state:GameState):Action|null`。終局時のみnull。Task 1の候補と遷移を利用し、CPUは黒、人間は白。ローカル2人戦では両側を人間が操作する。

- [ ] Step 1: 失敗するテスト`cpu_legal`、`cpu_takes_core`、`cpu_blocks_immediate_loss`、`cpu_accounts_for_expiry`を記述。同一状態は同じ候補を返す。試験局面では寿命処理後に防衛が残る候補を優先させる。
- [ ] Step 2: `cpu_restart_stale`でCPU予約後の再戦・モード変更・disposeは予約を取消し、遅れて来た結果もsession/revision不一致で拒否することを検証。人間がCPU手番に入力しても拒否する。
- [ ] Step 3: `npm test -- tests/cpu.test.ts tests/controller.test.ts`の失敗を確認後、即勝利→相手の即勝利回避→コアへの圧力→残る戦力と糧の順で辞書式評価。相手の返しは即勝利の有無だけ確認し、同点は合法手の固定順序を使う。深い探索はしない。
- [ ] Step 4: 取消可能なCPU予約と待ち表示を追加。最大候補局面で応答時間を測定し、必要なら評価を分割。テスト成功後`feat: add deterministic cpu opponent`でコミット。

### Task 5: 通し検証と遊べる成果物を整える

**Files:** `e2e/game.spec.ts`、`playwright.config.ts`、`README.md`。不具合があれば該当機能と回帰テストだけを更新。
**Interfaces:** `npm test`、`npm run build`、`npm run test:e2e`。READMEに実行方法、全ルール、保存なし、確認環境、未解決事項を記載。

- [ ] Step 1: 390×844と1280×800で開始から全4行動・消滅・終局・再戦までのブラウザーテスト。タッチ・キーボード・残高32超・予告・2D切替を含める。
- [ ] Step 2: WebGL無効で同じ対局を続行できること、CPU待ち中再戦、画面サイズ変更、外部通信なしをブラウザーで確認。CPU自己対戦と異なる初期テスト局面で違法状態がなく200手以内に終局することを確認。
- [ ] Step 3: `npm test && npm run build && npm run test:e2e`を成功させる。未実行は明記。実画面で4形状・文字・タップ対象を点検。
- [ ] Step 4: 独立した最終レビューで仕様差分・ルール・表示・入力を確認し、指摘修正を回帰テストで再検証。READMEと検証結果を整え、`test: verify complete timed chess matches`でコミット。
- [ ] Step 5: 利用可能な非公開プレビューまたは実行手順付き成果物を渡す。新しい外部公開は承認を得てから行う。

## 自己レビューと実行方法

設計全節の実装・検証先、共通型の整合を確認した。状態を「手番収入加算済み」に統一し、二重収入と二重確定を防ぐ。

推奨はクラウド環境での順次実装＋最後の独立レビュー。共通ルールへの依存が強く、実装の連続性を保てる。各段階にも独立レビューを挟む方法も選べる。計画と進め方の承認後に開始する。
