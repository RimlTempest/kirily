# Kirily 設計書

> **Kirily（きりり）** — 画像を、きりり。
>
> ブラウザを中心に動作し、元画像の解像度を維持したまま背景透過・手動補正・トリミング・画像変換を行える、レスポンシブな画像編集Webサービス。

## 1. プロジェクト概要

### 1.1 目的

Kirilyは、画像の背景透過を中心とした軽量なWeb画像編集サービス。

主要な価値は以下。

- AIによる高精度な自動背景透過
- 自動透過結果をユーザーが手動で修正可能
- 元画像の解像度を維持したフル解像度書き出し
- 可能な限りブラウザ内で画像処理を完結
- PC / タブレット / モバイルで快適に操作可能
- Cloudflareへデプロイ可能
- 重い画像処理・ピクセル処理はRust/WASMへ分離
- 将来的にAIモデルを差し替え・高度化できるアーキテクチャ

### 1.2 MVPで対応する機能

- PNG / JPEG / WebPの読み込み
- ドラッグ&ドロップ
- AI自動背景透過
- 手動ブラシによるマスク編集
- 消しゴム
- AIマスク補正
- Undo / Redo
- トリミング
- PNG / JPEG / WebP書き出し
- 元画像サイズを維持した書き出し
- PC / モバイル対応

### 1.3 Phase 2以降

- GIF / アニメーションGIF
- AVIF
- 高度なAIエッジ補正
- 髪・毛の専用補正
- バッチ処理
- 画像履歴
- プリセット
- 背景差し替え
- AIによる不要物除去
- アカウント / クラウド保存
- 有料プラン

---

# 2. 基本方針

## 2.1 「プレビュー」と「書き出し」を分離する

Kirilyで最重要となる設計方針。

元画像が4000×3000の場合でも、編集画面では必要に応じて1200px程度へ縮小したプレビューを利用する。

一方、書き出し時には元画像4000×3000を使用する。

```text
Original Image
    │
    ├── Preview Pipeline
    │      └── Resize → Canvas/WebGL → UI
    │
    └── Export Pipeline
           └── Original Resolution
                   │
                   ├── Mask
                   ├── Crop
                   └── Transform
                         │
                         ▼
                  PNG / WebP / JPEG
```

これにより、

- UIを軽くする
- 元画像の解像度を維持する
- 編集途中で画像を何度もJPEG化しない
- 最終書き出し時だけエンコードする

という設計を実現する。

## 2.2 非破壊編集

編集操作で元画像そのものを書き換えない。

画像と編集状態を分離する。

```text
OriginalImage
Mask
Crop
Transform
ColorAdjustments
```

を独立して保持し、最終的にRendererが合成する。

## 2.3 JPEGを中間フォーマットにしない

JPEGは非可逆圧縮のため、内部処理では使用しない。

基本的に以下を利用する。

- RGBA pixel buffer
- ImageBitmap
- OffscreenCanvas
- WebGL / WebGPU
- Rust/WASM memory buffer

---

# 3. 技術スタック

## Frontend

- SvelteKit
- TypeScript
- Vite
- Tailwind CSS
- shadcn-svelte
- Lucide
- Svelte stores / runes
- Canvas API
- OffscreenCanvas
- Web Worker

## Image Processing

- Rust
- wasm-bindgen
- WebAssembly
- Web Worker
- SIMDを利用可能な環境ではWASM SIMDを利用

## Rendering

MVP:

- Canvas 2D
- OffscreenCanvas
- WebGL

将来的:

- WebGPU

## AI

第一候補:

- ブラウザ側で実行可能なセグメンテーションモデル
- ONNX Runtime Web / WebGPU
- WASM fallback

サーバーAIを導入する場合:

- Cloudflare WorkersをAPI Gatewayとして利用
- 実際の推論基盤は別のGPU推論サービスへ分離可能

## Infrastructure

- Cloudflare Pages / Workers
- Cloudflare R2
- Cloudflare KV / D1（必要になった場合）
- Cloudflare Imagesは用途に応じて検討

---

# 4. モノレポ構成

pnpm workspace + Turborepoを基本とする。

```text
kirily/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── routes/
│       │   ├── lib/
│       │   │   ├── components/
│       │   │   ├── editor/
│       │   │   ├── image/
│       │   │   ├── ai/
│       │   │   └── stores/
│       │   └── workers/
│       ├── static/
│       └── package.json
│
├── packages/
│   ├── ui/
│   ├── image-core/
│   ├── editor-core/
│   ├── ai/
│   └── wasm/
│
├── crates/
│   ├── kirily-image/
│   ├── kirily-mask/
│   ├── kirily-raster/
│   └── kirily-wasm/
│
├── models/
│   └── segmentation/
│
├── docs/
│   └── architecture/
│
├── Cargo.toml
├── Cargo.lock
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

## Rust Workspace

```text
crates/
├── kirily-image
│   └── 画像処理の基本型
│
├── kirily-mask
│   └── Alpha Mask操作
│
├── kirily-raster
│   └── ピクセル処理・合成
│
└── kirily-wasm
    └── JavaScript/WASM bridge
```

Rust側の責務を細かく分離する。

---

# 5. Frontend Architecture

```text
SvelteKit
    │
    ├── UI
    │
    ├── Editor State
    │
    ├── Preview Renderer
    │
    ├── AI Controller
    │
    ├── Export Controller
    │
    └── Worker Manager
             │
             ├── AI Worker
             └── WASM Worker
```

UIコンポーネントから直接CanvasやWASMを操作しない。

例えば、

```text
Toolbar
   ↓
EditorCommand
   ↓
EditorStore
   ↓
Renderer / Worker
```

という構造にする。

これによりUndo/Redoや将来的なコマンド履歴が実装しやすい。

---

# 6. Editor State

状態は概念的に以下。

```ts
type EditorState = {
  source: SourceImage;
  mask: MaskState;
  crop: CropState;
  transform: TransformState;
  viewport: ViewportState;
  tool: EditorTool;
  history: HistoryState;
};
```

## SourceImage

```ts
type SourceImage = {
  width: number;
  height: number;
  mimeType: string;
  bitmap: ImageBitmap | null;
};
```

重要なのは、元画像のwidth/heightを必ず保持すること。

## MaskState

```ts
type MaskState = {
  width: number;
  height: number;
  data: Uint8Array | Float32Array;
  version: number;
};
```

MVPでは8bit alpha maskを基本とする。

AIモデルが確率値を返す場合はFloat32で保持してから8bit化する方式も検討。

---

# 7. AI背景透過

## 7.1 最重要要件

「remove.bg級」を目標とする。

ただしモデル精度は単純なモデル名では保証できないため、Kirilyでは**AI推論部分を交換可能なAdapter設計**にする。

```ts
interface BackgroundRemovalModel {
  load(): Promise<void>;

  segment(image: ImageInput): Promise<SegmentationResult>;
}
```

これにより、

```text
Model A
Model B
Model C
Cloud AI
Local AI
```

を差し替え可能にする。

## 7.2 出力

AIは直接RGBA画像を返すのではなく、可能ならAlpha Maskを返す。

```text
Input
 ↓
Segmentation Model
 ↓
Probability / Alpha Mask
 ↓
Post Processing
 ↓
Edge Refinement
 ↓
Final Mask
```

## 7.3 AI精度向上パイプライン

単純な二値化だけにしない。

```text
Segmentation
    ↓
Confidence Map
    ↓
Foreground / Background Classification
    ↓
Edge Detection
    ↓
Matting / Alpha Refinement
    ↓
Decontamination
    ↓
Final Alpha
```

特に人物・髪・動物の毛などは、単純なsemantic segmentationよりmattingが重要。

---

# 8. AI補正

AI補正はMaskに対して行う。

```text
Current Mask
    ↓
AI Refinement
    ↓
Refined Mask
    ↓
User Review
```

ユーザーの手動編集結果をAI処理で上書きしない。

例えば、

```text
AI Mask
    +
Manual Keep Mask
    +
Manual Remove Mask
    ↓
Final Mask
```

という構造にする。

これによりユーザーの操作を尊重できる。

---

# 9. 手動透過

基本ツール:

- Brush / Keep
- Eraser / Remove
- Restore
- Edge refinement

ブラシ操作は元画像に直接描画せず、Maskへ描画する。

```text
Pointer Event
   ↓
Canvas Coordinates
   ↓
Image Coordinates
   ↓
Brush Operation
   ↓
Mask Buffer
   ↓
Renderer Update
```

## ブラシ

```ts
type BrushSettings = {
  size: number;
  hardness: number;
  opacity: number;
  feather: number;
};
```

---

# 10. Undo / Redo

画像そのものを毎回コピーしない。

Command Patternを採用する。

```text
Command
 ├── BrushStroke
 ├── Crop
 ├── Transform
 ├── AIRefinement
 └── MaskOperation
```

Mask全体のコピーが巨大になる場合は、

- command log
- tile diff
- snapshot

を組み合わせる。

MVPでは一定回数ごとにsnapshotを作成する方式でもよい。

---

# 11. Rust / WASM

## WASMに向いている処理

- RGBA → Alpha合成
- Mask apply
- Mask blur
- Feather
- Edge refinement
- Morphology
- Pixel-level operations
- Crop
- Resize
- 色変換
- 高解像度Export用のピクセル処理

## JavaScript側

- UI
- Pointer Event
- State
- File API
- Canvas orchestration
- AI model orchestration

Rustにすべてを移すのではなく、**CPU負荷の高いピクセル処理だけRustへ移す**。

---

# 12. WASM API

JavaScriptからは細かいRust実装を見せない。

例えば、

```ts
const result = await imageEngine.applyMask({
  image,
  mask,
});
```

のようなAPIにする。

Rust:

```rust
#[wasm_bindgen]
pub fn apply_alpha_mask(
    rgba: &[u8],
    mask: &[u8],
    width: u32,
    height: u32,
) -> Vec<u8> {
    // ...
}
```

実際のAPIでは巨大なVecコピーを避けるため、SharedArrayBufferやWASM linear memoryの再利用も検討する。

---

# 13. Worker Architecture

メインスレッドで重い処理をしない。

```text
Main Thread
    │
    ├── UI
    ├── Input
    └── Viewport
         │
         ├─────────────┐
         ▼             ▼
    AI Worker      WASM Worker
         │             │
         ▼             ▼
      Model          Rust
```

特に4K以上の画像ではWorker利用を基本とする。

---

# 14. Rendering Architecture

## Preview

Canvas / WebGLを利用。

画像全体を毎回再描画せず、可能な限り差分更新する。

```text
Original Image
     +
Mask Texture
     ↓
GPU Composition
     ↓
Preview
```

チェッカーボード背景を表示して透過を視覚化。

## Zoom

最低限:

- 25%
- 50%
- 100%
- 200%
- Fit

を用意。

ピンチズームにも対応する。

---

# 15. モバイルUI

PCとモバイルでUI構造を変える。

## Desktop

```text
Left Toolbar
Center Canvas
Right Properties
Bottom Status
```

## Mobile

```text
Top Header
Canvas
Bottom Tool Bar
Bottom Sheet
```

モバイルではサイドバーを使わない。

操作は、

- Tap
- Drag
- Pinch
- Long press

を前提に設計する。

---

# 16. トリミング

Crop State:

```ts
type CropState = {
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number | null;
};
```

プリセット:

- Free
- 1:1
- 4:3
- 3:4
- 16:9
- 9:16

将来的にSNSプリセットを追加。

---

# 17. Export Pipeline

最重要。

```text
Original Image
      │
      ├── Crop
      │
      ├── Transform
      │
      ├── Alpha Mask
      │
      └── Adjustments
             │
             ▼
       Full Resolution
             │
             ▼
          Encoder
             │
       ┌─────┼─────┐
       ▼     ▼     ▼
      PNG   WebP  JPEG
```

内部では一度もJPEG化しない。

## PNG

透明度を保持。

## WebP

Losslessを選択可能にする。

## JPEG

Alpha channelを持たないため、透明部分については背景色を指定する。

```text
Background:
Transparent
White
Black
Custom
```

JPEGを選択した場合はUI上で透明を保持できないことを明示する。

---

# 18. 画像形式変換

形式変換も元画像を直接変換する。

```text
Decoded Pixel Buffer
       ↓
Encoder
       ↓
Target Format
```

JPEG → PNGの場合も、JPEGを何度も再圧縮しない。

ただし、JPEGをデコードした時点で元JPEGの圧縮による情報損失は既に存在するため、「JPEG→PNGで元JPEG以上の画質にはならない」。

---

# 19. GIF

GIFは通常の静止画像と分離する。

```text
Static Image Pipeline
Animated Image Pipeline
```

MVPではGIFを静止画として扱うか、入力対応を後回しにする。

アニメーションGIFの背景透過はフレーム単位で処理する必要があるため、Phase 2以降とする。

---

# 20. Cloudflare構成

基本構成:

```text
Browser
   │
   ▼
Cloudflare
   │
   ├── Pages / Workers
   │      └── SvelteKit
   │
   ├── R2
   │      └── 必要に応じた一時ファイル
   │
   └── API
          └── AI Gateway
```

可能な処理はブラウザ内で完結させる。

特に通常の画像透過では、サーバーへ画像をアップロードしなくても動作できる構成を目標にする。

---

# 21. AIサーバー設計

AIモデルがブラウザで十分な性能を出せない場合に備え、サーバーAIをAdapterとして追加できるようにする。

```text
AI Service
├── LocalAI
└── RemoteAI
```

```ts
interface BackgroundRemovalProvider {
  removeBackground(input: ImageInput): Promise<Mask>;
}
```

実行戦略:

```text
if (browser supports local model) {
    Local AI
} else {
    Remote AI
}
```

ユーザーの同意なしに画像を外部へ送信しない。

---

# 22. セキュリティ・プライバシー

基本方針:

- デフォルトで画像を永続保存しない
- ブラウザ処理を優先
- 外部AIへ送信する場合は明示
- EXIF情報の扱いを明示
- Export時に不要なメタデータを除去できるようにする
- R2へ保存する場合はTTL付き一時ファイルを基本とする

---

# 23. パフォーマンス目標

目標値の例。

## UI

- 60fpsを目標
- ブラシ操作で入力遅延を感じにくいこと
- メインスレッドを長時間ブロックしない

## 画像

- 1920px程度は快適に編集
- 4K画像も編集可能
- 8K以上は段階的処理を検討

## AI

AIモデルのロード中は、

```text
AIを準備しています…
```

を表示。

推論中はUIを操作可能な状態に保つ。

---

# 24. エラー処理

対応例:

```text
画像サイズが大きすぎます
対応していない画像形式です
メモリが不足しています
AIモデルを読み込めませんでした
ブラウザがこの処理に対応していません
```

フォールバック:

```text
WebGPU
  ↓
WASM SIMD
  ↓
Canvas / CPU
  ↓
Remote AI
```

のように段階的に性能を落とす。

---

# 25. UX

ブランドコピー:

```text
Kirily
画像を、きりり。
```

操作名:

```text
✨ 背景をきりり
✂️ 手動で切り抜く
🪄 AIで整える
📐 トリミング
⬇️ ダウンロード
```

処理中:

```text
きりり中…
```

完了:

```text
きりりっと完成！
```

ただし、可愛さを優先しすぎて操作内容が分からなくならないよう、アイコン＋補助テキストを基本とする。

---

# 26. コンポーネント設計

```text
components/
├── upload/
│   ├── Dropzone.svelte
│   └── FilePicker.svelte
│
├── editor/
│   ├── Editor.svelte
│   ├── Canvas.svelte
│   ├── Toolbar.svelte
│   ├── MobileToolbar.svelte
│   ├── PropertiesPanel.svelte
│   └── ZoomControls.svelte
│
├── mask/
│   ├── BrushTool.svelte
│   ├── EraserTool.svelte
│   └── EdgeRefineTool.svelte
│
├── crop/
│   └── CropTool.svelte
│
├── export/
│   ├── ExportDialog.svelte
│   └── FormatSelector.svelte
│
└── common/
```

---

# 27. テスト

## Unit Test

- Mask
- Crop
- Transform
- Color
- Export
- WASM functions

## Visual Regression

同じ画像＋同じMaskから生成した結果を比較する。

## E2E

Playwrightを利用。

主要フロー:

```text
Upload
 ↓
AI Remove
 ↓
Manual Correction
 ↓
Crop
 ↓
Export PNG
```

モバイル:

```text
Upload
 ↓
Pinch Zoom
 ↓
Brush
 ↓
Export
```

---

# 28. AI精度評価

「remove.bgくらい」を感覚だけで判断しない。

評価用データセットを用意する。

カテゴリ:

- 人物
- 髪
- 動物
- 商品
- 車
- 食べ物
- ロゴ
- 複雑な背景
- 透明・半透明物体
- 低コントラスト
- 逆光

評価指標:

- IoU
- F1
- Boundary F-score
- Alpha matte quality
- 人間による目視評価

特にKirilyでは**境界品質**を重視する。

---

# 29. AIモデルの考え方

remove.bg相当の精度を狙う場合、単純な背景セグメンテーションだけでは不十分。

必要に応じて、

```text
Segmentation
+
Matting
+
Edge Refinement
+
Post Processing
```

の複数段構成にする。

モデル候補は実際のライセンス、ブラウザサイズ、推論速度、精度を比較して決定する。

AIモデルはアプリケーションコードから分離し、

```text
packages/ai
models/
```

で管理する。

---

# 30. 開発フェーズ

## Phase 0 — Foundation

- Monorepo
- SvelteKit
- Cloudflare
- Rust workspace
- WASM build
- CI/CD
- lint / format / test

## Phase 1 — Editor Core

- Upload
- Canvas
- Zoom
- Pan
- Image state
- Mask state
- Undo / Redo

## Phase 2 — AI

- AI model adapter
- Background removal
- Mask generation
- AI refinement

## Phase 3 — Manual Editing

- Brush
- Eraser
- Feather
- Edge refinement

## Phase 4 — Export

- PNG
- WebP
- JPEG
- Full-resolution rendering

## Phase 5 — Crop

- Free crop
- Aspect ratio
- Mobile gestures

## Phase 6 — Optimization

- Worker
- WASM
- SIMD
- WebGPU
- Memory optimization

## Phase 7 — Production

- Analytics
- Error monitoring
- Rate limit
- Privacy
- R2 lifecycle
- AI cost control

---

# 31. 最初に作るべきVertical Slice

最初から全機能を作らない。

まず以下を完成させる。

```text
Upload
 ↓
AI Background Removal
 ↓
Mask Preview
 ↓
Manual Brush
 ↓
Undo
 ↓
Full Resolution PNG Export
```

この一連の体験をPC / スマホ両方で完成させる。

このVertical SliceがKirilyのコア。

---

# 32. 非機能要件

- TypeScript strict
- Rust clippy / rustfmt
- ESLint
- Prettier
- Vitest
- Playwright
- CI
- Lighthouse
- Accessibility
- Keyboard navigation
- Reduced motion対応
- Dark mode
- iOS Safari対応
- Android Chrome対応
- Chrome / Edge / Safari / Firefox対応

---

# 33. 重要な設計原則

### 原則1

**元画像を壊さない。**

### 原則2

**PreviewとExportを分離する。**

### 原則3

**AIの結果をMaskとして保持する。**

### 原則4

**手動編集はAI結果を直接破壊せず、編集レイヤーとして扱える構造にする。**

### 原則5

**重い処理はWorker/WASMへ逃がす。**

### 原則6

**AI Providerを交換可能にする。**

### 原則7

**サーバーへ画像を送らなくても基本機能が動くことを目指す。**

### 原則8

**モバイルはPCの縮小版ではなく、別の操作体系として設計する。**

---

# 34. 将来の拡張

Kirilyは最終的に、

```text
Background Removal
      +
Image Editor
      +
AI Image Tools
```

へ拡張可能な構造にする。

例えば、

- 背景生成
- 背景ぼかし
- 不要物除去
- AI消しゴム
- 商品写真化
- SNS用リサイズ
- AIアップスケール
- 画像圧縮
- バッチ透過
- API提供

などを追加できる。

---

# 35. 最終アーキテクチャ

```text
                         ┌───────────────────┐
                         │     SvelteKit     │
                         │       Web UI      │
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │    Editor Core    │
                         │  State / Command  │
                         └──────┬─────┬──────┘
                                │     │
                    ┌───────────┘     └───────────┐
                    ▼                             ▼
              Preview Renderer              Worker Layer
                    │                       ┌─────┴─────┐
              Canvas/WebGL                 │           │
                    │                    AI Worker  WASM Worker
                    │                       │           │
                    │                       ▼           ▼
                    │                    AI Model     Rust
                    │                                   │
                    └──────────────┬────────────────────┘
                                   ▼
                            Full Resolution
                              Export Engine
                                   │
                       ┌───────────┼───────────┐
                       ▼           ▼           ▼
                      PNG         WebP        JPEG

                     Cloudflare
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           Workers     R2       AI Gateway
```

# 36. MVP完成条件

- [ ] PNG/JPEG/WebPを読み込める
- [ ] ドラッグ&ドロップできる
- [ ] AI自動背景透過できる
- [ ] 透過結果をリアルタイム表示できる
- [ ] ブラシでMaskを修正できる
- [ ] Undo / Redoできる
- [ ] トリミングできる
- [ ] PNGとして元画像解像度で書き出せる
- [ ] モバイルで操作できる
- [ ] PCで操作できる
- [ ] 重い処理でUIがフリーズしない
- [ ] Rust/WASMの画像処理基盤が動作する
- [ ] Cloudflareへデプロイできる
- [ ] 基本的な画像処理をサーバーへ送らず実行できる

---

# 37. MVPで特に重視する3点

Kirilyでは機能数よりも、以下を優先する。

**1. 切り抜き品質**

特に髪・毛・商品輪郭などの境界品質。

**2. 操作感**

AIで一発切り抜き → 少しブラシで修正 → 即書き出し、という流れを極端に短くする。

**3. 元画像品質**

編集画面が軽量でも、最終出力は元画像の解像度を維持する。

この3点をKirilyのプロダクト品質基準とする。
