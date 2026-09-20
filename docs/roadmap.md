# ロードマップ

`kirily-design.md §30` のフェーズを、いまのコードの状態に合わせたもの。

## M0 — 土台（完了）

- [x] Bun workspaces + mise + lefthook + CI
- [x] oxlint / oxfmt / prettier / svelte-check
- [x] `kirily/*` lint ルール（any / as / class / enum / domain throw / DOM）
- [x] Rust workspace と wasm-pack ビルド
- [x] `contract` / `image-core` / `editor-core` / `ai` / `wasm`
- [x] Cloudflare adapter + CSP
- [x] ADR と skills

## M1 — 垂直スライス（ほぼ完了）

- [x] アップロード（ドロップ + ファイル選択、MIME と寸法の検証）
- [x] Preview 生成（端末に応じた長辺予算）
- [x] マスク 3 層と合成
- [x] 背景透過（プレースホルダのプロバイダ）
- [x] ブラシ（残す / 消す、太さ、ソフトエッジ）
- [x] Undo / Redo（領域パッチ方式）
- [x] 元解像度 PNG 書き出し
- [x] E2E（desktop + mobile）+ axe によるアクセシビリティ検査
- [ ] iOS Safari の E2E（`KIRILY_E2E_WEBKIT=1` で opt-in。既定では回っていない）
- [ ] ズーム / パン
- [ ] トリミングの UI（状態と書き出し側は対応済み）

## M2 — 本物の AI

- [ ] セグメンテーションモデルの選定（精度 / サイズ / ライセンス / 速度）
- [ ] ONNX Runtime Web + WebGPU、WASM フォールバック
- [ ] confidence map を使ったエッジ精緻化
- [ ] マッティング（髪・毛）
- [ ] 色の除染（`decontaminate_edges` は Rust 側に実装済み、未配線）
- [ ] 評価データセットと回帰（IoU / Boundary F-score）

## M3 — 速度とメモリ

- [ ] AI Worker / WASM Worker（`ArrayBuffer` 転送）
- [ ] WebGL レンダラ（いまは Canvas 2D）
- [ ] 差分更新（いまは毎回プレビュー全面）
- [ ] タイル処理（8K 以上）
- [ ] WASM SIMD

## M4 — 製品化

- [ ] WebP / JPEG 書き出しの UI（背景色・品質）
- [ ] モバイルのボトムシートとジェスチャ
- [ ] 視覚的回帰テスト
- [ ] 匿名イベントの計測（画像の内容は送らない）
- [ ] Cloudflare へのデプロイ
- [ ] Lighthouse / axe の CI 化
