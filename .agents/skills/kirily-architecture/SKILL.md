---
name: kirily-architecture
description: Kirily の構成と拡張手順。どこに何を置くか迷ったとき、機能を追加するとき、Rust と TypeScript のどちらでやるか決めるとき、Worker / WASM / AI の境界に関わる変更をするときに読む。AI モデル・書き出し形式・ツール・Rust プリミティブの追加レシピと、越えてはいけない境界を定義する。「どのパッケージに置く」「Rust と TS どちら」「Worker に逃がすべきか」「新しいツールを足したい」で発火。
---

# Kirily の構成と拡張

全体像は [docs/architecture.md](../../../docs/architecture.md)、
決定の理由は [docs/adr/](../../../docs/adr/) にある。ここは**手を動かす手順**。

## 1. 置き場所の判断

| 書こうとしているもの                    | 置き場所                            |
| --------------------------------------- | ----------------------------------- |
| 型・エラーコード・`Result`・座標系      | `packages/contract`（実装依存ゼロ） |
| マスク操作・合成・リサンプル（純粋 TS） | `packages/image-core`               |
| 編集状態・コマンド・Undo/Redo           | `packages/editor-core`              |
| AI プロバイダとその選択                 | `packages/ai`                       |
| WASM のロードとフォールバック           | `packages/wasm`                     |
| ホットループのピクセル処理              | `crates/kirily-{image,mask,raster}` |
| JS から呼ぶ WASM の入口                 | `crates/kirily-wasm`                |
| Canvas / File / Pointer / ダウンロード  | `apps/web/src/lib/editor`           |
| 画面                                    | `apps/web/src/lib/components`       |
| ルーティング                            | `apps/web/src/routes`               |

**判断基準**: 「ピクセルを 1 枚ずつ触る計算」は Rust、
「配線と画面」は TypeScript。迷ったら計算を Rust に寄せる。

ただし **TypeScript 版も必ず残す**。WASM が使えないブラウザで
機能が消えてはいけない（`kirily-image-pipeline` の「二重実装」を読む）。

## 2. 越えてはいけない境界

- `packages/contract` は**何にも依存しない**。ここに実装を書かない。
- `packages/image-core` / `packages/editor-core` に **DOM を書かない**。
  Canvas も `document` も `fetch` も禁止（`kirily/no-dom-in-core` が落とす）。
- 同じ 2 パッケージで `throw` しない（`kirily/no-throw-in-domain`）。
- **Svelte コンポーネントから WASM / AI プロバイダを直接呼ばない。**
  必ず `editor-store.svelte.ts` を経由する（IMPLEMENTATION.md Rule 5 / Rule 6）。
- **Preview 用の Canvas を Export に使わない**（Rule 2）。
  Export は `decoded.rgba`（元解像度）から始める。
- `apps/web/wrangler.jsonc` に **R2 / KV / D1 のバインディングを足さない。**
  足すということは「画像をサーバーに置く」ということで、
  トップページの約束（[ADR-0004](../../../docs/adr/0004-browser-first.md)）が変わる。
- `crates/kirily-{image,mask,raster}` は **wasm-bindgen に依存しない。**
  `cargo test` で普通に回せなくなる。
- **静的アセットを 25 MiB 超にしない。** Cloudflare が受け付けない。
  大きいものは `tools/shard.ts` で分割する（ADR-0007）。
  `tools/check-asset-sizes.ts` がビルド後に検査する。
- **ページから外部ドメインへ接続しない。** CSP は `connect-src 'self'`。
  モデルの重みもランタイムも自前ドメインから配る。

CI の `guard` ジョブがこれらを検査する。

## 3. 拡張レシピ

### セグメンテーションモデルを足す

既存の 3 段は [ADR-0007](../../../docs/adr/0007-segmentation-model.md)。
ONNX なら**コードは書かない**。データを足すだけで入る。

1. `tools/fetch-models.ts` の `MODELS` に 1 件足す。
   **`bytes` と `sha256` を必ず固定する**（上流が差し替わると、コードを
   変えていないのに出力が変わる）。ハッシュは一度落として `shasum -a 256`
2. `packages/ai/src/local/onnx/model-spec.ts` に `ModelSpec` を足す。
   `mean` / `std` / `outputActivation` / `rescaleOutput` は
   **元の実装（rembg など）に合わせる**。勘で埋めると、
   それらしいが間違ったマスクが出る
3. `packages/ai/src/local/onnx/plan.ts` の `planModels` に、
   **どの端末で提示するか**を書く。テストも同じファイルの隣に足す
4. `apps/web/src/routes/editor/+page.svelte` の `MODEL_LABELS` に
   表示名を足す
5. `bun run models:fetch && bun run build` → `bun run e2e`

入力名・出力名・fp16 かどうかは **セッションから読む**。
同じアーキテクチャでも export によって違う。ハードコードしない。

#### 端末で動くかを先に確かめる

**失敗は 100MB 以上ダウンロードしたあとに起きる。**
だから `planModels` は能力を先に見る。BiRefNet が Apple GPU で
動かないのは、デコーダの `Split` が storage buffer を 11 個要求し、
Apple GPU の上限が 10 だから（ADR-0007）。

`navigator.gpu` の存在だけで判定しない。オブジェクトはあるのに
アダプタを返さない環境がある。`detectGpu()` を使う。

#### 別のランタイムを使う

`packages/ai/src/local/onnx/ort-session.ts` が
onnxruntime-web を import する唯一の場所。Transformers.js や
WebNN に替えるなら、`SessionFactory` を満たす関数を 1 本書くだけでよい。

`createThresholdProvider` は削除しない。何も動かない環境の最後の砦であり、
E2E がモデル無しでも回るための足場でもある。

### リモート AI を足す

1. `packages/ai/src/remote/<name>-provider.ts` を作る
2. `info.requiresUpload` を **`true`** にする。これが UI の
   「この処理では画像を AI サーバーへ送信します」の根拠になる
3. `apps/web/src/routes/api/` に Cloudflare Worker のエンドポイントを足す。
   **API キーはブラウザに出さない**（Worker の secret に置く）
4. `selectAiBackend` は `consent.allowsUpload` が `true` のときしか
   `Remote` を返さない。同意 UI を通さずに `true` を渡さない

### 書き出し形式を足す（例: AVIF）

1. `apps/web/src/lib/editor/export.ts` の `ExportFormat` にメンバーを足す
2. → `extensionFor` の分岐と、JPEG 用の背景色処理がコンパイルエラーになる
3. `convertToBlob` が実際にその MIME を返すか実行時に確認する
   （Safari は黙って PNG を返すことがある。`encode` に検査がある）

### エディタツールを足す（例: なげなわ選択）

1. `packages/contract/src/mask.ts` か `geometry.ts` に必要な型を足す
2. `packages/editor-core/src/commands.ts` の `EditorCommand` に
   メンバーを足す
3. → `targetLayer` / `affectedRect` / `applyCommand` の `switch` が
   **3 か所ともコンパイルエラーになる**。埋める
4. `affectedRect` は必ず正しく返す。ここが広すぎると Undo が重くなり、
   狭すぎると Undo で戻りきらない
5. `packages/editor-core/src/commands.test.ts` と `history.test.ts` に
   「実行 → Undo で完全に戻る」テストを足す
6. UI は `Toolbar.svelte` に 1 要素足す

### Rust のピクセル処理を足す

1. `crates/kirily-{mask,raster}` に純粋関数として実装し、`cargo test` を書く
2. `crates/kirily-wasm/src/lib.rs` に `#[wasm_bindgen]` の薄いラッパを足す
   （`BufferError` → `JsError` の変換は `to_js_error` を使う）
3. `packages/image-core` に**同じ振る舞いの TypeScript 実装**を足す
4. `packages/wasm/src/index.ts` の `ImageEngine` にメソッドを足し、
   WASM 版とフォールバック版を両方書く
5. 両方に同じ入出力のテストを書く（片方だけ直したら落ちるように）

### 重い処理を Worker へ逃がす

メインスレッドが 16ms を超えるなら Worker へ。

1. `apps/web/src/lib/workers/<name>.worker.ts` を作る
2. メッセージは判別可能ユニオンで型を付ける
3. `ArrayBuffer` は**転送する**（`postMessage(msg, [buffer])`）。
   コピーすると 32MB が往復する
4. 転送したバッファは送信側で使えなくなる。呼び出し側でそれを前提にする

## 4. 迷ったら

- 抽象を足すか迷ったら足さない（YAGNI）。2 回目の重複が出てから。
- Rust か TS か迷ったら、まず TS で書いて計測する。遅かったら Rust。
- サーバかブラウザか迷ったらブラウザ（プライバシーと無料枠の両方に効く）。
- Preview か元解像度か迷ったら: **表示は Preview、書き出しは元解像度。**
