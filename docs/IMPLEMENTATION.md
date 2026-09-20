# Kirily Implementation Specification

> Kirily（きりり）を実装開始できる状態まで落とし込むための実装仕様書。
>
> 本書は `kirily-design.md` の具体化版であり、リポジトリ初期化・アプリ構築・Rust/WASM・AI・Cloudflare・テスト・CI/CDまでを対象とする。

---

# 1. Implementation Goals

## 1.1 最初の完成形

最初のVertical Sliceを以下とする。

```text
画像を選択
   ↓
AI背景透過
   ↓
透過プレビュー
   ↓
ブラシで補正
   ↓
Undo / Redo
   ↓
トリミング
   ↓
元解像度PNG書き出し
```

PCとモバイルの両方で同じ編集状態を共有し、UIだけを最適化する。

## 1.2 非目標

MVPでは以下を後回しにする。

- ユーザーアカウント
- 永続的なクラウドプロジェクト
- ソーシャル機能
- 高度なレイヤー編集
- アニメーションGIF編集
- サーバー側画像ストレージを前提としたワークフロー
- 独自AIモデルの学習基盤

---

# 2. Repository

推奨モノレポ:

```text
kirily/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── lib/
│       │   │   ├── components/
│       │   │   ├── editor/
│       │   │   ├── image/
│       │   │   ├── ai/
│       │   │   ├── export/
│       │   │   ├── workers/
│       │   │   └── stores/
│       │   ├── routes/
│       │   │   ├── +page.svelte
│       │   │   └── editor/
│       │   │       └── +page.svelte
│       │   └── app.html
│       ├── static/
│       ├── package.json
│       ├── svelte.config.js
│       ├── vite.config.ts
│       └── wrangler.toml
│
├── packages/
│   ├── editor-core/
│   ├── image-core/
│   ├── ai/
│   ├── ui/
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
├── tests/
│   ├── fixtures/
│   ├── visual/
│   └── e2e/
│
├── docs/
│   ├── architecture/
│   └── decisions/
│
├── Cargo.toml
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── rust-toolchain.toml
├── .gitignore
└── README.md
```

---

# 3. Package Manager

pnpmを使用する。

```text
Node.js
pnpm
Turborepo
```

初期化:

```bash
corepack enable
pnpm init
```

`package.json`:

```json
{
  "name": "kirily",
  "private": true,
  "packageManager": "pnpm@latest",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "check": "turbo check",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "prettier": "^3",
    "turbo": "^2"
  }
}
```

---

# 4. SvelteKit

SvelteKitをWebアプリの基盤とする。

```bash
pnpm create svelte@latest apps/web
```

選択:

```text
SvelteKit
TypeScript
ESLint
Prettier
Vitest
Playwright
```

Svelte 5を前提とする。

---

# 5. UI Stack

使用:

- Tailwind CSS
- shadcn-svelte
- Lucide

役割:

```text
Tailwind
  → layout / responsive / styling

shadcn-svelte
  → Dialog / Button / Sheet / Slider / Tooltip

Lucide
  → icons
```

Kirily独自のeditor UIはshadcn-svelteに依存しすぎない。

特にCanvas周辺は独自実装する。

---

# 6. Route Design

## `/`

アップロード画面。

```text
/
└── +page.svelte
```

## `/editor`

編集画面。

```text
/editor
└── +page.svelte
```

MVPでは画像データをURLパラメータに入れない。

ブラウザメモリまたはIndexedDBなどを利用する。

将来的にプロジェクト保存を追加する場合のみ永続URLを導入する。

---

# 7. Upload Flow

```text
Dropzone
   ↓
File validation
   ↓
Image decode
   ↓
SourceImage
   ↓
Editor initialization
```

対応:

```text
image/png
image/jpeg
image/webp
```

Phase 2:

```text
image/gif
image/avif
```

検証項目:

- MIME type
- ファイルサイズ
- width
- height
- decode可能性

拡張子だけを信用しない。

---

# 8. Image Model

TypeScript:

```ts
export interface SourceImage {
  id: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
  fileSize: number;
  bitmap: ImageBitmap | null;
}
```

元画像Blob/Fileは、必要な間は保持する。

ただし巨大画像を複数コピーしない。

---

# 9. Editor State

```ts
export interface EditorState {
  source: SourceImage | null;
  mask: MaskState | null;
  crop: CropState;
  transform: TransformState;
  viewport: ViewportState;
  activeTool: EditorTool;
  isProcessing: boolean;
}
```

状態管理はSvelte 5 runesを基本とする。

Editor Core自体はSvelteコンポーネントから独立させる。

---

# 10. Editor Core

`packages/editor-core`:

```text
packages/editor-core/
├── src/
│   ├── commands/
│   │   ├── brush.ts
│   │   ├── crop.ts
│   │   ├── transform.ts
│   │   └── ai-refine.ts
│   ├── history/
│   ├── state/
│   ├── geometry/
│   └── index.ts
└── package.json
```

UIではなく「画像編集操作そのもの」を担当する。

---

# 11. Coordinate System

座標系を明確に分離する。

```text
Screen Coordinates
       ↓
Viewport Coordinates
       ↓
Canvas Coordinates
       ↓
Image Coordinates
```

Image Coordinatesは常に元画像基準。

例:

```text
Original: 4000 × 3000
Preview: 1200 × 900
```

ブラシ操作は最終的に、

```text
preview pixel
→ normalized coordinate
→ original image coordinate
```

へ変換する。

これにより低解像度Previewでも元解像度Maskを編集できる。

---

# 12. Preview Resolution

Previewの長辺を目安として制限する。

例:

```ts
const MAX_PREVIEW_EDGE = 1600;
```

ただし端末性能に応じて変更できるようにする。

```text
High-end desktop → 2048
Mobile → 1200〜1600
Low-memory → 1024
```

PreviewはExport用データではない。

---

# 13. Mask Architecture

Maskは元画像と同じ解像度を基本とする。

```ts
interface MaskState {
  width: number;
  height: number;
  data: Uint8Array;
  version: number;
}
```

値:

```text
0   = transparent
255 = opaque
```

将来的に高品質mattingを扱う場合はFloat32を利用可能にする。

---

# 14. Mask Layers

AI結果とユーザー編集を分離する。

```text
Base AI Mask
      +
Keep Override
      +
Remove Override
      ↓
Final Mask
```

概念:

```ts
interface MaskState {
  base: Uint8Array;
  keep?: Uint8Array;
  remove?: Uint8Array;
  final?: Uint8Array;
}
```

MVPではメモリ使用量を考慮して最適化してよいが、API上はこの概念を維持する。

---

# 15. AI Provider

`packages/ai`:

```text
packages/ai/
├── src/
│   ├── types.ts
│   ├── provider.ts
│   ├── local/
│   │   └── local-provider.ts
│   ├── remote/
│   │   └── remote-provider.ts
│   └── index.ts
```

Interface:

```ts
export interface BackgroundRemovalProvider {
  initialize(): Promise<void>;

  removeBackground(input: ImageInput, options?: RemovalOptions): Promise<SegmentationResult>;
}
```

結果:

```ts
export interface SegmentationResult {
  width: number;
  height: number;
  alpha: Uint8Array;
  confidence?: Float32Array;
}
```

---

# 16. AI Execution Strategy

初期設計:

```text
Browser
  │
  ├── WebGPU supported?
  │       ↓
  │    Local AI
  │
  ├── WASM supported?
  │       ↓
  │    Local fallback
  │
  └── Remote AI
```

ただし、AIモデルを無条件にサーバーへ送信しない。

Remote AIを使う場合はUI上で明示する。

---

# 17. AI Model Selection

「remove.bg級」の品質を目標にするが、特定モデルの採用を固定しない。

評価軸:

1. 髪・毛の境界
2. 人物輪郭
3. 商品輪郭
4. 複雑背景
5. 半透明物
6. 推論速度
7. モデルサイズ
8. ブラウザ互換性
9. ライセンス

モデルはAdapterの背後に置く。

---

# 18. AI Pipeline

```text
Decoded Image
     ↓
Resize / Normalize
     ↓
Segmentation Model
     ↓
Raw Alpha
     ↓
Confidence Analysis
     ↓
Edge Refinement
     ↓
Matting / Alpha Refinement
     ↓
Color Decontamination
     ↓
Final Mask
```

MVPではまず、

```text
Segmentation
→ Basic refinement
→ Final mask
```

を実装し、mattingを段階的に追加する。

---

# 19. AI Worker

AI推論をMain Threadで実行しない。

```text
src/lib/workers/ai.worker.ts
```

Message:

```ts
type AIWorkerRequest =
  | {
      type: 'initialize';
    }
  | {
      type: 'remove-background';
      image: ImageData;
    };
```

Response:

```ts
type AIWorkerResponse =
  | {
      type: 'ready';
    }
  | {
      type: 'progress';
      value: number;
    }
  | {
      type: 'result';
      mask: ArrayBuffer;
      width: number;
      height: number;
    }
  | {
      type: 'error';
      message: string;
    };
```

Transferable Objectsを利用し、巨大配列をコピーしない。

---

# 20. Rust Workspace

Root `Cargo.toml`:

```toml
[workspace]
members = [
    "crates/kirily-image",
    "crates/kirily-mask",
    "crates/kirily-raster",
    "crates/kirily-wasm"
]
resolver = "2"
```

Rust toolchainは固定する。

`rust-toolchain.toml`:

```toml
[toolchain]
channel = "stable"
targets = ["wasm32-unknown-unknown"]
components = ["rustfmt", "clippy"]
```

---

# 21. Rust Crates

## `kirily-image`

画像バッファ・基本型。

```text
Pixel
RgbaImage
ImageSize
Rect
```

## `kirily-mask`

Mask操作。

```text
Mask
MaskRegion
Brush
Feather
```

## `kirily-raster`

ピクセル処理。

```text
AlphaComposite
Resize
Crop
Blend
Color
```

## `kirily-wasm`

JS/WASM bridge。

---

# 22. WASM Build

wasm-bindgenを使用する。

開発環境ではwasm-pack等を利用してよい。

生成物:

```text
packages/wasm/
├── pkg/
│   ├── kirily_wasm.js
│   ├── kirily_wasm_bg.wasm
│   └── ...
└── src/
```

生成物をGit管理するかはCI/CD方針に合わせる。

基本は生成物をGit管理せず、build pipelineで生成する。

---

# 23. WASM API

例:

```rust
#[wasm_bindgen]
pub fn apply_alpha_mask(
    rgba: &[u8],
    mask: &[u8],
    width: u32,
    height: u32,
) -> Vec<u8>
```

その他:

```rust
#[wasm_bindgen]
pub fn feather_mask(
    mask: &[u8],
    width: u32,
    height: u32,
    radius: f32,
) -> Vec<u8>
```

```rust
#[wasm_bindgen]
pub fn crop_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    crop_width: u32,
    crop_height: u32,
) -> Vec<u8>
```

---

# 24. WASM Memory Optimization

4K RGBA:

```text
3840 × 2160 × 4
≈ 31.6 MB
```

Mask:

```text
3840 × 2160
≈ 8.3 MB
```

中間バッファを複数持つと簡単に100MBを超える。

そのため、

- Buffer reuse
- Transferable ArrayBuffer
- Worker
- Tile processing
- 不要なRGBAコピーを避ける

を徹底する。

---

# 25. Tile Processing

超高解像度画像ではタイル処理を導入できる設計にする。

```text
Image
┌────┬────┬────┐
│Tile│Tile│Tile│
├────┼────┼────┤
│Tile│Tile│Tile│
├────┼────┼────┤
│Tile│Tile│Tile│
└────┴────┴────┘
```

MVPでは必須ではないが、APIは将来的なTile処理を阻害しない設計にする。

---

# 26. WASM Worker

```text
src/lib/workers/wasm.worker.ts
```

処理:

- Mask apply
- Brush rasterization
- Feather
- Crop
- Resize
- Export preprocessing

UIスレッドではWASM Workerとの通信だけを行う。

---

# 27. Rendering

MVP:

```text
Canvas 2D
```

最適化段階:

```text
Canvas 2D
   ↓
WebGL
   ↓
WebGPU
```

PreviewではGPU合成を優先し、元画像データを毎回CPU側で合成しない。

概念:

```text
Image Texture
+
Mask Texture
+
Checkerboard
=
Preview
```

---

# 28. Editor Canvas

```text
EditorCanvas.svelte
```

責務:

- Canvas mount
- ResizeObserver
- Pointer events
- wheel
- pinch
- pan
- zoom

Canvas内部の画像処理ロジックは持たない。

```text
EditorCanvas
   ↓
ViewportController
   ↓
EditorCore
```

---

# 29. Pointer Handling

Desktop:

```text
pointerdown
pointermove
pointerup
wheel
```

Mobile:

```text
pointerdown
pointermove
pointerup
touch/pointer multi-touch
```

Pointer Events APIを基本とする。

ブラシの座標計算はImage Coordinatesへ変換してから実行。

---

# 30. Brush

Brush command:

```ts
interface BrushStroke {
  points: Point[];
  size: number;
  hardness: number;
  opacity: number;
  mode: 'keep' | 'remove';
}
```

Strokeを履歴単位とする。

毎pointermoveをUndo単位にしない。

---

# 31. Undo / Redo

History:

```ts
interface HistoryEntry {
  command: EditorCommand;
  inverse?: EditorCommand;
}
```

基本:

```text
Undo
  ↓
pop history
  ↓
apply inverse

Redo
  ↓
pop redo stack
  ↓
apply command
```

AI処理も1回の操作として扱う。

---

# 32. Crop

Crop UIはPreview座標で動作する。

保存する値はImage Coordinates。

```ts
interface CropState {
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number | null;
}
```

Export時に元画像へ適用する。

---

# 33. Export

Exportは必ず元画像を起点にする。

```text
Source Image
  ↓
Crop
  ↓
Transform
  ↓
Mask
  ↓
Composite
  ↓
Encoder
  ↓
Blob
```

Preview Canvasをそのままexportしない。

---

# 34. PNG Export

PNGはalphaを維持する。

```text
RGBA
 ↓
PNG Encoder
 ↓
Blob
 ↓
download
```

可能な限りRust/WASMまたはブラウザ標準Encoderを比較し、品質・速度・メモリ使用量で決定する。

---

# 35. WebP Export

選択肢:

```text
Lossless
Lossy
```

UI:

```text
品質
──────────●
```

Losslessの場合は品質設定を無効化する。

---

# 36. JPEG Export

JPEGはalpha非対応。

そのため、

```text
Transparent
White
Black
Custom
```

から背景色を選択する。

元JPEGを再JPEG化する場合は、避けられない再圧縮であることを理解した上で品質設定を提供する。

---

# 37. Download

MVPではブラウザダウンロード。

```ts
const url = URL.createObjectURL(blob);

const anchor = document.createElement('a');
anchor.href = url;
anchor.download = fileName;
anchor.click();

URL.revokeObjectURL(url);
```

将来的にFile System Access APIを検討。

---

# 38. Responsive UI

## Desktop

```text
┌─────────────────────────────────────────┐
│ Header                                  │
├──────────┬──────────────────┬───────────┤
│ Toolbar  │      Canvas      │ Properties│
│          │                  │           │
├──────────┴──────────────────┴───────────┤
│ Status / Zoom                            │
└─────────────────────────────────────────┘
```

## Mobile

```text
┌──────────────────────┐
│ Header               │
├──────────────────────┤
│                      │
│       Canvas         │
│                      │
├──────────────────────┤
│ Tool bar             │
├──────────────────────┤
│ Bottom Sheet         │
└──────────────────────┘
```

---

# 39. Mobile Interaction

必須:

- pinch zoom
- two-finger pan
- one-finger brush
- double tap reset zoom
- bottom sheet tool settings

誤操作防止:

- UI領域ではCanvas操作を受けない
- brush中のスクロールを防止
- undo/redoを常時アクセス可能にする

---

# 40. Accessibility

- キーボード操作
- aria-label
- focus-visible
- color contrast
- reduced motion
- screen reader向け操作説明

ショートカット:

```text
Cmd/Ctrl + Z → Undo
Cmd/Ctrl + Shift + Z → Redo
Space → Pan
[ / ] → Brush size
```

---

# 41. Cloudflare

SvelteKitのCloudflare adapterを使用。

概念:

```text
SvelteKit
   ↓
@sveltejs/adapter-cloudflare
   ↓
Cloudflare Workers
```

静的アセットとSSR/Worker処理をCloudflareへ配置する。

---

# 42. Wrangler

`wrangler.toml`またはプロジェクトのCloudflare推奨設定に従う。

環境:

```text
development
preview
production
```

Secret:

```text
AI_API_KEY
REMOTE_AI_URL
```

などはCloudflare Secretsで管理。

Gitへ書かない。

---

# 43. R2

MVPでは必須ではない。

利用する場合:

```text
R2
└── temporary/
```

一時ファイルはTTLで削除する。

基本方針:

```text
Browser processing
    ↓
No R2
```

Remote AIなどでサーバー処理が必要な場合のみ利用。

---

# 44. Remote AI API

Cloudflare WorkerをGatewayにする。

```text
Browser
  ↓
Cloudflare Worker
  ↓
AI Provider
```

APIキーをブラウザに露出しない。

Request:

```json
{
  "operation": "background-removal",
  "format": "png"
}
```

画像送信方式はmultipart/form-dataなどを採用する。

---

# 45. Privacy

UI上で明示:

```text
この画像はブラウザ内で処理されます。
```

Remote AIを使う場合:

```text
この処理では画像をAIサーバーへ送信します。
```

ユーザーが意図しないアップロードを行わない設計にする。

---

# 46. Error Handling

共通エラー型:

```ts
type KirilyErrorCode =
  | 'INVALID_FILE'
  | 'UNSUPPORTED_FORMAT'
  | 'IMAGE_DECODE_FAILED'
  | 'IMAGE_TOO_LARGE'
  | 'OUT_OF_MEMORY'
  | 'AI_INITIALIZATION_FAILED'
  | 'AI_INFERENCE_FAILED'
  | 'WASM_FAILED'
  | 'EXPORT_FAILED';
```

ユーザー向けメッセージと内部エラーを分離する。

---

# 47. Feature Detection

起動時:

```text
WebGPU?
WebAssembly?
WASM SIMD?
OffscreenCanvas?
createImageBitmap?
WebGL?
```

を検出。

結果から処理Backendを決定する。

```ts
interface RuntimeCapabilities {
  webgpu: boolean;
  wasm: boolean;
  wasmSimd: boolean;
  offscreenCanvas: boolean;
  webgl: boolean;
}
```

---

# 48. Backend Selection

```text
Renderer:
WebGPU → WebGL → Canvas2D

AI:
WebGPU → WASM → Remote

Image Processing:
WASM → Canvas2D
```

このFallbackは個別機能単位で持つ。

---

# 49. Testing

## Unit

Vitest:

```text
packages/editor-core
packages/image-core
packages/ai
```

## Rust

```bash
cargo test
cargo clippy
cargo fmt --check
```

## WASM

JS側から実際のWASM APIを呼ぶIntegration Testを作る。

---

# 50. Visual Regression

Fixtures:

```text
tests/fixtures/
├── person.jpg
├── hair.jpg
├── product.jpg
├── animal.jpg
├── complex-background.jpg
└── transparent-object.png
```

結果画像を保存し、境界差分を比較する。

特に、

- 髪
- 指
- 商品の細部
- 半透明部分

を重点評価する。

---

# 51. AI Evaluation

評価用データセットは本番コードから分離する。

```text
evaluation/
├── dataset/
├── scripts/
├── metrics/
└── reports/
```

測定:

- IoU
- F1
- Boundary F-score
- Alpha error
- inference latency
- memory usage

モデル更新時にRegression Testを行う。

---

# 52. E2E

Playwright。

主要ケース:

```text
1. Upload
2. AI remove
3. Brush keep
4. Brush remove
5. Undo
6. Redo
7. Crop
8. Export PNG
```

Mobile viewport:

```text
iPhone相当
Android相当
```

Desktop:

```text
1280×800
1440×900
1920×1080
```

---

# 53. CI/CD

GitHub Actions想定。

```text
Push
 ↓
Install
 ↓
Lint
 ↓
Type Check
 ↓
Unit Test
 ↓
Rust Test
 ↓
WASM Build
 ↓
E2E
 ↓
Build
 ↓
Deploy
```

PRではDeploy前のValidationを必須にする。

---

# 54. GitHub Actions

概念:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest

    steps:
      - checkout

      - setup-node
      - setup-pnpm
      - install

      - lint
      - typecheck
      - test

      - setup-rust
      - cargo fmt --check
      - cargo clippy
      - cargo test

      - wasm build
      - playwright
```

本番Deployはmain branch merge後。

---

# 55. Development Commands

ルート:

```bash
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm check
pnpm format
```

Rust:

```bash
cargo test
cargo clippy
cargo fmt
```

WASM:

```bash
pnpm wasm:build
```

---

# 56. Environment Variables

ローカル:

```text
.env.local
```

例:

```text
PUBLIC_APP_ENV=development
PUBLIC_AI_MODE=local
REMOTE_AI_URL=
```

SecretはPublic prefixを付けない。

```text
AI_API_KEY=
```

ブラウザへ公開してはいけない値は`PUBLIC_`を付けない。

---

# 57. Logging

Productionでは画像データそのものをログに出さない。

ログ:

```text
operation
duration
image dimensions
browser capability
success/failure
error code
```

個人画像の内容は記録しない。

---

# 58. Analytics

MVPでは匿名イベントのみ。

例:

```text
upload_started
background_removal_started
background_removal_completed
manual_edit_started
export_started
export_completed
```

画像そのものやファイル名は送信しない。

---

# 59. Performance Instrumentation

計測対象:

```text
decode_ms
ai_load_ms
ai_inference_ms
mask_refine_ms
preview_render_ms
export_ms
memory_peak
```

これにより、

```text
AIが遅い
WASMが遅い
Canvasが遅い
Encoderが遅い
```

を切り分けられる。

---

# 60. Memory Budget

目安:

```text
Preview Image
Mask
AI Tensor
Export Buffer
WASM Buffer
```

を同時保持すると大きなメモリを使用する。

そのため、

- Previewは必要時のみ生成
- AI Tensorは処理後に解放
- Export Bufferは使い回す
- Worker終了時に巨大メモリを破棄
- 画像サイズに応じて処理方式を切り替える

---

# 61. Large Image Strategy

画像が一定サイズを超えた場合:

```text
Small
→ Full-resolution processing

Large
→ Preview / tiled processing

Very Large
→ Warning + optimized processing
```

例:

```text
< 20 MP
通常

20–50 MP
最適化処理

> 50 MP
警告・段階処理
```

数値は実機ベンチマーク後に決定する。

---

# 62. Browser Compatibility

優先:

1. Chrome / Chromium
2. Safari
3. Firefox

特にSafariで、

- WebGPU
- OffscreenCanvas
- WASM
- File API
- Pointer Events

の差異をテストする。

---

# 63. Security

- CSP
- XSS対策
- Upload size limit
- MIME validation
- Decode validation
- Remote AI rate limit
- CORS制限
- R2 signed URL
- Secret管理

画像ファイル名をHTMLへ直接挿入しない。

---

# 64. File Naming

Export:

```text
original-name-kirily.png
```

例:

```text
cat-kirily.png
```

形式変更:

```text
cat-kirily.webp
```

ファイル名はサニタイズする。

---

# 65. UX States

Editorは以下の状態を持つ。

```text
idle
loading
decoding
ai-loading
ai-processing
editing
exporting
success
error
```

処理中でも可能な範囲でCanvas表示を維持する。

---

# 66. Upload UX

Dropzone:

```text
画像を、きりり。

ここに画像をドロップ
または

[画像を選択]
```

対応形式を表示:

```text
PNG / JPEG / WebP
```

ドラッグ中:

```text
ここにドロップ ✨
```

---

# 67. Editor Toolbar

Desktop:

```text
✨ 自動透過
🖌 残す
🧹 消す
🪄 AI補正
✂ トリミング
↶ Undo
↷ Redo
```

Mobile:

```text
自動
手動
AI
切抜き
```

詳細設定はBottom Sheet。

---

# 68. Export Dialog

```text
書き出し

形式
[ PNG ▼ ]

サイズ
○ 元画像
○ カスタム

品質
──────────●

[ダウンロード]
```

PNGでは品質UIを隠す。

JPEGでは背景色を表示。

---

# 69. AI Refinement UX

AI補正を押すと:

```text
どこをきれいにしますか？

○ 全体
○ 髪・毛
○ 輪郭
○ 背景の取り残し
```

MVPでは「全体」だけでもよい。

---

# 70. Definition of Done

機能がDoneになる条件:

- TypeScript compile success
- Unit test success
- Mobile test success
- Desktop test success
- Accessibility check
- No obvious memory leak
- Undo/Redo behavior verified
- Full-resolution export verified
- Error state verified

---

# 71. 実装順序

## Step 1

Monorepo。

```text
pnpm
SvelteKit
Turborepo
Rust workspace
```

## Step 2

アップロード。

```text
Dropzone
File validation
Image decode
```

## Step 3

Editor Canvas。

```text
Canvas
Pan
Zoom
Responsive
```

## Step 4

Mask。

```text
Mask buffer
Preview
Checkerboard
```

## Step 5

Rust/WASM。

```text
wasm-bindgen
Mask apply
Brush
Export preprocessing
```

## Step 6

AI。

```text
AI adapter
AI worker
Model integration
Mask generation
```

## Step 7

Manual editing。

```text
Keep
Remove
Feather
Undo
Redo
```

## Step 8

Crop。

## Step 9

Export。

## Step 10

Performance optimization。

## Step 11

Cloudflare production deployment。

---

# 72. 最初のPull Request単位

最初から巨大なPRにしない。

### PR #1

```text
Monorepo foundation
SvelteKit
Cloudflare
Rust workspace
CI
```

### PR #2

```text
Upload
Image decode
Editor route
```

### PR #3

```text
Canvas
Viewport
Zoom
Pan
```

### PR #4

```text
Mask
Checkerboard
Basic brush
```

### PR #5

```text
WASM
Rust raster
Worker
```

### PR #6

```text
AI adapter
AI worker
Background removal
```

### PR #7

```text
Undo/Redo
Crop
Export
```

### PR #8

```text
Mobile UX
Performance
Accessibility
```

---

# 73. ADR候補

設計判断は以下をADRとして残す。

```text
docs/decisions/
├── 001-sveltekit.md
├── 002-rust-wasm.md
├── 003-preview-export-separation.md
├── 004-mask-architecture.md
├── 005-ai-provider.md
├── 006-cloudflare.md
└── 007-browser-first-processing.md
```

---

# 74. 重要なImplementation Rules

### Rule 1

CanvasをEditorのSource of Truthにしない。

Source of TruthはEditor State。

### Rule 2

Preview画像をExportに使用しない。

### Rule 3

AI結果はRGBAではなくMask中心で扱う。

### Rule 4

巨大なArrayBufferをMain Threadで頻繁にコピーしない。

### Rule 5

Rust/WASMはUIから直接呼ばず、Worker/Service Layerを経由する。

### Rule 6

AI ProviderをSvelte componentから直接呼ばない。

### Rule 7

Cloudflareへのアップロードを画像処理の必須条件にしない。

### Rule 8

モバイルではDesktop UIをそのまま縮小しない。

### Rule 9

JPEGを中間データとして保存しない。

### Rule 10

AIモデルをアプリケーションコードにハードコードしない。

---

# 75. Initial File List

最初に作るファイル:

```text
apps/web/src/routes/+page.svelte
apps/web/src/routes/editor/+page.svelte

apps/web/src/lib/components/upload/Dropzone.svelte
apps/web/src/lib/components/editor/Editor.svelte
apps/web/src/lib/components/editor/EditorCanvas.svelte
apps/web/src/lib/components/editor/Toolbar.svelte
apps/web/src/lib/components/editor/MobileToolbar.svelte

apps/web/src/lib/editor/editor-store.svelte.ts
apps/web/src/lib/editor/viewport.ts
apps/web/src/lib/editor/coordinates.ts

apps/web/src/lib/workers/ai.worker.ts
apps/web/src/lib/workers/wasm.worker.ts

packages/editor-core/src/index.ts
packages/image-core/src/index.ts
packages/ai/src/index.ts
packages/wasm/src/index.ts

crates/kirily-image/src/lib.rs
crates/kirily-mask/src/lib.rs
crates/kirily-raster/src/lib.rs
crates/kirily-wasm/src/lib.rs

tests/e2e/editor.spec.ts
```

---

# 76. 最初の実装Target

最初のTargetは以下。

```text
┌─────────────────────────────────────────┐
│                  Kirily                  │
│                                         │
│         ┌───────────────────┐           │
│         │                   │           │
│         │      IMAGE        │           │
│         │                   │           │
│         │   transparent     │           │
│         │                   │           │
│         └───────────────────┘           │
│                                         │
│   [✨ 自動] [🖌 残す] [🧹 消す]          │
│                                         │
│              [Download]                 │
└─────────────────────────────────────────┘
```

この最小UIで、

```text
Upload
→ AI
→ Mask
→ Brush
→ Export
```

が通れば、Kirilyの技術的な基盤は成立したと判断する。

---

# 77. 最終Target Architecture

```text
                          ┌─────────────────────┐
                          │      SvelteKit      │
                          │        Web UI       │
                          └──────────┬──────────┘
                                     │
                              Editor Core
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
                  ▼                  ▼                  ▼
              Viewport            Mask             Commands
                  │                  │                  │
                  └──────────────────┼──────────────────┘
                                     │
                              Worker Layer
                       ┌─────────────┴─────────────┐
                       │                           │
                       ▼                           ▼
                   AI Worker                  WASM Worker
                       │                           │
                 Local / Remote                   Rust
                       │                           │
                       └─────────────┬─────────────┘
                                     │
                              Render / Export
                                     │
                       ┌─────────────┼─────────────┐
                       ▼             ▼             ▼
                      PNG           WebP          JPEG

                             Cloudflare
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
                 Workers         R2        AI Gateway
```

Kirilyの実装上の最重要ポイントは、**「AI」「Mask」「Editor State」「Renderer」「Export」を疎結合にすること**。

この構造を維持することで、将来的にAIモデルや画像処理エンジンを変更しても、SvelteKitのUIを大きく作り直さずに済む。
