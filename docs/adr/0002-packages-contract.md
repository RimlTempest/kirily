# ADR-0002: 型と Result を `packages/contract` に置く

- 状態: 採用
- 日付: 2026-09-21

## 背景

`kirily-design.md §4` のパッケージ構成には `ui` / `image-core` /
`editor-core` / `ai` / `wasm` があるが、それら全部が使う
`Result` / `KirilyError` / 座標系の型の置き場がない。

`image-core` に置くと `ai` が `image-core` に依存することになり、
「ピクセル処理」と「型」が同じ箱に入る。各パッケージで定義すると
DRY 違反になり、`Result` が 4 種類できる。

## 決定

`packages/contract` を追加する。ここには**実装を書かない**。

- `result.ts` — `Result<T, E>`, `ok`, `err`, `assertNever`
- `error.ts` — `KirilyErrorCode` とユーザー向け文言
- `geometry.ts` — `ImagePoint` / `ScreenPoint` / `Viewport` / `Rect`
- `image.ts` — `SourceImage` と入力検証
- `mask.ts` — `MaskLayers` / `BrushMode` / `BrushSettings`
- `brand.ts` — Branded 型のパーサ組み立て

`contract` は何にも依存しない。他の全パッケージがこれに依存する。

## 結果

- 設計書のパッケージ一覧と 1 つずれる（`contract` が増える）
- 代わりに、型を変えたときに壊れる場所がコンパイラで全部わかる
- `packages/ui` は作っていない。Svelte コンポーネントは
  `apps/web/src/lib/components` にある。2 つ目のアプリができるまで
  切り出さない（YAGNI）

## 代替案

- 各パッケージで定義 → `Result` が増殖する
- `image-core` に同居 → 依存の向きが濁る
