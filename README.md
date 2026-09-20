# Kirily（きりり）

> 画像を、きりり。

ブラウザだけで背景透過・マスク編集・トリミング・書き出しを行う Web サービス。
**元画像の解像度を保ったまま書き出す**こと、**画像をサーバーへ送らない**ことが
この製品の中身です。

## Stack

- SvelteKit + Svelte 5 (runes) + TypeScript
- Bun workspaces（pnpm / Turborepo ではない — ADR-0005）
- Tailwind CSS v4
- Rust + WebAssembly（TypeScript フォールバック付き — ADR-0003）
- Cloudflare Workers / Pages
- oxlint + oxfmt + lefthook + mise

## はじめかた

```bash
mise install
bun install
bunx lefthook install
bun run wasm:build   # Rust → packages/wasm/pkg（git 管理外）
bun run dev          # http://localhost:5173
```

## コマンド

```bash
bun run check        # fmt + lint + typecheck + test + cargo fmt/clippy/test
bun run test         # TypeScript の単体テスト
cargo test --workspace
bun run e2e          # Playwright（desktop + mobile）。初回は bun run e2e:install
bun run build        # wasm → SvelteKit（Cloudflare 向け）
```

## 構成

```text
kirily/
├── apps/web/                SvelteKit。Canvas / File / Pointer はここだけ
├── packages/
│   ├── contract/            型・Result・エラー・座標系（依存ゼロ）
│   ├── image-core/          純粋なピクセル処理（DOM なし）
│   ├── editor-core/         編集状態・コマンド・Undo/Redo（DOM なし）
│   ├── ai/                  背景除去プロバイダと実行先の選択
│   └── wasm/                WASM のロードとフォールバック
├── crates/
│   ├── kirily-image/        画像バッファの基本型
│   ├── kirily-mask/         マスク操作（ブラシ・feather・合成）
│   ├── kirily-raster/       ピクセル処理（合成・crop・除染）
│   └── kirily-wasm/         JS との境界（wasm-bindgen はここだけ）
├── tests/e2e/               Playwright
├── docs/                    設計書・アーキテクチャ・ADR
└── .agents/skills/          エージェント向けの規約（.claude/skills から symlink）
```

## 設計の要点

1. **元画像を壊さない。** 編集は状態として持ち、最後に合成する。
2. **Preview と Export は別のパイプライン。** 書き出しは常に元解像度から。
3. **AI の結果はマスクとして持つ。** 手動編集を上書きしない（base / keep / remove）。
4. **重い処理は Rust/WASM へ。** ただし TypeScript 実装も必ず残す。
5. **AI プロバイダは差し替え可能。** 新しいモデルはファイル 1 本の追加で入る。
6. **サーバーへ画像を送らなくても基本機能が動く。**

詳しくは [docs/architecture.md](docs/architecture.md) と [docs/adr/](docs/adr/)。

## 現状

垂直スライス（アップロード → 自動透過 → ブラシ補正 → Undo → 元解像度 PNG 書き出し）が
PC とモバイルの両方で通ります。背景透過はまだ**プレースホルダ**（境界色の
フラッドフィル）で、本物のセグメンテーションモデルは M2 で入れます。
差し替え先の境界（`BackgroundRemovalProvider`）はすでに定義済みです。

進捗は [docs/roadmap.md](docs/roadmap.md)。
