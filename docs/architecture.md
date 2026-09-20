# Kirily アーキテクチャ

原典は [kirily-design.md](kirily-design.md) と [IMPLEMENTATION.md](IMPLEMENTATION.md)。
このファイルは**いま動いているコードの地図**で、決定の理由は [adr/](adr/) にある。

## 1. 依存の向き

```text
apps/web (Svelte / Canvas / File / Pointer)
        │
        ▼
  editor-store.svelte.ts        ← Svelte と編集ロジックの唯一の接点
        │
        ├──────────────┬──────────────┬─────────────┐
        ▼              ▼              ▼             ▼
  editor-core      image-core         ai           wasm
  (状態/コマンド)   (純粋ピクセル)   (プロバイダ)  (WASM ロード)
        │              │                             │
        └──────┬───────┘                             ▼
               ▼                            crates/kirily-wasm
           contract                                  │
        (型 / Result / 座標)         ┌───────────────┼───────────────┐
                                     ▼               ▼               ▼
                              kirily-image     kirily-mask    kirily-raster
```

矢印は一方向。`contract` は何にも依存しない。
`image-core` と `editor-core` は DOM を知らない（lint と CI が守る）。

## 2. 画像の流れ

```text
File
 │  decodeFile()           apps/web/src/lib/editor/decode.ts
 ▼
DecodedImage
 ├── rgba      元解像度。書き出しだけが読む。書き換えない
 └── preview   縮小コピー。画面と AI 推論が読む
 │
 ▼
MaskLayers (元解像度 × 3層)
 │  base   ← AI
 │  keep   ← ブラシ「残す」
 │  remove ← ブラシ「消す」
 ▼
composeMask() → fullMask (元解像度)
 │                    │
 │                    └── resampleMask() → previewMask → Canvas
 ▼
exportImage()   crop → mask → (JPEG なら背景合成) → encode 1 回
 ▼
Blob → download
```

**Preview は画面のためだけにある。** 書き出しは常に `rgba` から始まる。

## 3. マスクの合成規則

```text
final = max(base, keep) - remove
```

手動編集が AI に勝つ。AI を再実行しても `base` しか置き換わらないので、
ユーザーが塗った `keep` / `remove` は残る。

## 4. Undo / Redo

コマンドパターン。履歴エントリは「コマンドが書き換える領域の、
書き換える前のバイト」だけを持つ。マスク全体はコピーしない。

```text
execute()  → affectedRect() で領域を決め、その分だけ退避して適用
undo()     → 退避したバイトを書き戻し、いまの値を redo 用に退避
```

深さは `MAX_HISTORY_DEPTH = 50` で頭打ちにしてある。

## 5. 差し替え可能な 2 つの境界

| 境界                        | いまの実装                             | 差し替え先の想定                |
| --------------------------- | -------------------------------------- | ------------------------------- |
| `BackgroundRemovalProvider` | 境界色フラッドフィル（プレースホルダ） | ONNX Runtime Web / リモート API |
| `ImageEngine`               | WASM、無ければ TypeScript              | WebGPU 実装                     |

どちらも**新しいファイルを 1 本足すだけ**で差し替わること。
エディタ側を触らないと入らないなら、境界の切り方が間違っている。

## 6. AI の経路

```text
Editor Store
    │  preview RGBA（コピーして転送）
    ▼
ai.worker.ts ─ detectGpu() ─→ planModels()
    │                             │
    │                   ┌─────────┼─────────┐
    │                   ▼         ▼         ▼
    │            BiRefNet-lite  IS-Net    U²-Netp
    │              (webgpu)    (webgpu)   (wasm)
    │                   └─────────┼─────────┘
    │                             ▼
    │                     createProviderChain
    │                （ロード失敗も推論失敗も次の段へ）
    ▼
alpha mask（転送して戻す）→ resampleMask → MaskLayers.base
```

重みは `/models/<id>/manifest.json` + shard。
ONNX Runtime の wasm は Vite が同一オリジンのアセットとして出力する。
どちらも外部ドメインへは行かない。

## 7. まだ無いもの

`docs/roadmap.md` を参照。特に以下は設計にだけ存在する。

- Crop の UI（`CropState` と Export 側の対応は入っている）
- WebGL / WebGPU レンダラ（いまは Canvas 2D）
- マッティングと色の除染（`decontaminate_edges` は Rust 側に実装済み、未配線）
- 視覚的回帰テストと AI 精度評価
