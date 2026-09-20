# Kirily（きりり）

> 画像を、きりり。

ブラウザだけで背景透過・マスク編集・トリミング・書き出しを行う Web サービス。
**元画像の解像度を保ったまま書き出すこと**と、**画像をサーバーへ送らないこと**が
製品の中身そのもの。

SvelteKit (Svelte 5 + runes) + Rust/WASM + Cloudflare。Bun workspaces の monorepo。

## 作業を始める前に読むもの

| 状況                                 | 読むスキル                       |
| ------------------------------------ | -------------------------------- |
| TS を書く・直す                      | `kirily-typescript`              |
| `.svelte` を書く・UI を直す          | `kirily-svelte-ui`               |
| マスク・座標・メモリ・書き出しに触る | `kirily-image-pipeline`          |
| 機能追加・バグ修正                   | `kirily-tdd`（必ず red → green） |
| どこに置くか迷う・機能を拡張する     | `kirily-architecture`            |
| Rust を書く                          | `rust-best-practices`            |
| Cloudflare Workers に触る            | `workers-best-practices`         |
| HTML/CSS/クライアント JS を書く      | `modern-web-guidance`            |
| UI・UX を見直す                      | `better-interface`               |
| アクセシビリティを直す               | `accessibility`                  |

設計の背景は `docs/architecture.md` と `docs/adr/`。
原典は `docs/kirily-design.md` と `docs/IMPLEMENTATION.md`。

`modern-web-guidance`（Google Chrome 公式）は、書く前に「いま標準で何ができるか」を
引きにいくスキル。**スキル本文は `npx` を指示しているが、このリポジトリでは
`bunx` を使うこと**:

```bash
bunx modern-web-guidance@latest search "<やりたいこと>"
```

> 検索語は Google に送られる。止めるなら `export DISABLE_TELEMETRY=1`。

`better-interface` は `better-accessibility` / `better-layout` / `better-writing` /
`better-typography` / `better-colors` / `better-ui` を順に当てて 1 つの表にまとめる。
個別の観点だけ見たいときはその 1 本を直接使う。

## 絶対に守ること

- **`any` / `as` / `!` / `class` / `enum` を書かない。** `.oxlintrc.json` の
  `kirily/*` ルールが落とす。回避せず設計を直す。
- **`packages/image-core` / `packages/editor-core` で `throw` しない。**
  失敗は `Result<T, KirilyError>` で返す。
- **同じ 2 パッケージに DOM を持ち込まない。** Worker と単体テストで
  動かなくなる（`kirily/no-dom-in-core` が落とす）。
- **Preview を書き出しに使わない。** Export は必ず元解像度のバッファから
  始める。これを破ると Kirily である理由がなくなる。
- **元画像バッファを書き換えない。** 編集は状態として持ち、最後に合成する。
- **AI の結果はマスクとして持つ。** RGBA を返させない。
  再実行がユーザーの手作業を消さないよう、`base` / `keep` / `remove` を分ける。
- **AI 推論をメインスレッドで動かさない。** `ai.worker.ts` 経由。
- **端末が動かせないモデルを提示しない。** 失敗は 100MB 以上
  ダウンロードしたあとに起きる。`plan.ts` で能力を先に見る（ADR-0007）。
- **モデルの重みはサイズと SHA-256 で固定する。** 上流が差し替わると、
  コードを変えていないのに出力が変わる。
- **巨大バッファを戻り値で新規確保しない。** 書き込み先を引数で受け取る。
- **Svelte コンポーネントから WASM / AI プロバイダを直接呼ばない。**
  必ず `editor-store.svelte.ts` を経由する。
- **`apps/web/wrangler.jsonc` に R2 / KV / D1 を足さない。**
  足すということは画像をサーバーに置くということ（ADR-0004）。
- **ユーザーの同意なしに画像を外部へ送らない。** `requiresUpload` が
  `true` のプロバイダは、同意 UI を通ってからしか選ばれない。
- **ログに画像の内容・ファイル名を出さない。** 出してよいのは操作名・
  所要時間・寸法・対応状況・エラーコードだけ。
- **実装より先に失敗するテストを書く。**

## コマンド

```bash
bun run dev          # vite dev（http://localhost:5173）
bun run check        # fmt + lint + typecheck + test + rust fmt/clippy/test
bun run test         # TS の Small テスト
cargo test --workspace   # Rust の Small テスト
bun run wasm:build   # Rust → packages/wasm/pkg（生成物は git 管理外）
bun run models:fetch # セグメンテーションモデルを取得して分割配信（git 管理外）
bun run e2e          # Playwright（desktop + mobile）。初回は e2e:install
                     # E2E はビルド出力を配信する。直したら build し直す
bun run e2e:webgpu   # WebGPU 段の E2E。実 GPU が要る（CI では回らない）
```

コミット前に `bun run check`。lefthook が staged ファイル単位で自動実行する。

`packages/wasm/pkg/`（wasm）と `apps/web/static/models/`（AI の重み）は
ビルド生成物で git 管理外。新しい環境では最初に
`bun run wasm:build && bun run models:fetch` を回す。
モデルが無くても動くが、背景透過は簡易処理に落ちる。

`apps/web/.svelte-kit/` も生成物で、`apps/web/tsconfig.json` がここを
extends している。**これが無いと `bun run lint` が `Invalid tsconfig` で落ちる。**
ルートの `postinstall` が `svelte-kit sync` を走らせるので、
`bun install` さえすれば揃う。bun はワークスペースの `prepare` を
実行しないので、ここに置いてある。

## MCP の使い分け

`.mcp.json` に定義がある。調べものは記憶ではなくこちらを引くこと。

| 調べたいこと                                                 | 使うもの                      |
| ------------------------------------------------------------ | ----------------------------- |
| SvelteKit / Svelte 5 / Vite / Tailwind / wasm-bindgen の API | Context7                      |
| Workers / Pages / R2 / D1 の仕様、デプロイ状態               | Cloudflare Developer Platform |
| 実際のブラウザで動かして確認する                             | claude-in-chrome              |

Context7 は「知っているつもり」でも引く。Svelte 5 の runes と
Tailwind v4 の `@theme` は、学習データが古い可能性が高い領域。

## コミット規約

Conventional Commits（lefthook の `commit-msg` が検証する）。
細かい単位で頻繁にコミットする。

```
feat(mask): add feather command
fix(export): keep the original resolution when a crop is active
docs(adr): record the browser-first decision
```

## ツールチェーン

`mise.toml` で node / bun / rust を固定している。新しい環境では:

```bash
mise install && bun install && bunx lefthook install && bun run wasm:build
```

Lint は oxlint、フォーマットは oxfmt（`.svelte` / `.md` / `.css` のみ prettier）。
ESLint と Prettier は TypeScript には使わない。
