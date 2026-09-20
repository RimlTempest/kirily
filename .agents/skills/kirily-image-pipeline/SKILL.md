---
name: kirily-image-pipeline
description: Kirily の画像処理規約。マスク・座標系・メモリ・Preview/Export 分離・WASM 境界に関わるコードを書く前に読む。元画像を壊さない、Preview を書き出しに使わない、AI 結果と手動編集を分ける、巨大バッファをコピーしない、という Kirily の品質を決める規約を定義する。「マスクをどう持つ」「なぜ重い」「ズームすると座標がずれる」「書き出しが荒い」「メモリが足りない」で発火。
---

# 画像パイプライン規約

Kirily の製品品質は「切り抜き品質」「操作感」「元画像品質」の 3 つで決まる
（kirily-design.md §37）。この 3 つはすべてこのファイルの規約に依存している。

## 1. Preview と Export は別のパイプライン

```text
Original Image (4000×3000)
    ├── Preview Pipeline  → 縮小 → Canvas → 画面
    └── Export Pipeline   → 元解像度のまま → Crop → Mask → Encoder
```

**Preview Canvas を書き出しに使わない。** これは規約の中でいちばん重い。
`canvas.toDataURL()` をエディタの Canvas に対して呼んだ時点で、
ユーザーが Kirily を選んだ理由（元解像度を保つこと）が消える。

Export は必ず `decoded.rgba`（`decodeFile` が元解像度で読んだバッファ）から
始める。`apps/web/src/lib/editor/export.ts` がその唯一の入口。

## 2. 元画像を壊さない

`decoded.rgba` は**読み取り専用として扱う**。マスクを適用するときは
crop 後のコピーに対して行う。元バッファを書き換えると、
2 回目の書き出しで前回のアルファが残る。

編集は状態（マスク・crop・transform）として持ち、
最終的に Renderer / Exporter が合成する。

## 3. マスクは 3 層

```text
base   … AI が出した結果。AI を再実行すると丸ごと置き換わる
keep   … ユーザーが「ここは残す」と塗った場所
remove … ユーザーが「ここは消す」と塗った場所
         ↓ composeMask
final  … max(base, keep) - remove
```

**AI の再実行がユーザーの手作業を消してはいけない**（kirily-design.md §8）。
だから `base` だけを置き換える。`composeMask` の式を変えるときは、
この性質が保たれているか `mask.test.ts` で確認する。

値は 0 = 透明、255 = 不透明。解像度は**元画像と同じ**。
Preview 解像度でマスクを持つと、書き出しで拡大されて輪郭が荒れる。

## 4. 座標系を混ぜない

```text
Screen (CSS px) → Viewport → Canvas → Image (元画像 px)
```

保存する値は**必ず Image 座標**。`ImagePoint` と `ScreenPoint` は
`space` タグで型が違うので、変換を忘れるとコンパイルエラーになる。

Preview 座標から Image 座標への変換を忘れると、
「ズームすると塗る位置がずれる」という症状になる。
`EditorCanvas.svelte` の `pointAt()` が唯一の変換点。

## 5. メモリ

| バッファ              | 4K (3840×2160) での大きさ |
| --------------------- | ------------------------- |
| 元画像 RGBA           | 約 32 MB                  |
| Preview RGBA (1600px) | 約 5 MB                   |
| マスク 3 層 + 合成    | 約 33 MB                  |
| Export 用コピー       | 約 32 MB                  |

同時に持つと簡単に 100MB を超える。守ること:

- **書き込み先を引数で受け取る。** 戻り値で新規確保しない
  （`composeMask(layers, out)`, `cropRgba(..., out)`）
- 使い終わった `ImageBitmap` は `close()` する
- Worker との受け渡しは `ArrayBuffer` を**転送**する（コピーしない）
- AI のテンソルは推論後すぐ捨てる

`Uint8ClampedArray` と `Uint8Array` は同じバッファを共有できる
（`new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)`）。
これはビューであってコピーではない。

## 6. JPEG を中間フォーマットにしない

内部では常に RGBA のピクセルバッファ。
編集のたびに JPEG 化すると世代劣化する。エンコードは**最後に一度だけ**。

JPEG で書き出す場合、アルファがないので背景色に合成してから渡す
（`flattenOnto`）。エンコーダに任せると、透明が黒になるか白になるかが
ブラウザ依存になる。

## 7. Undo はマスク全体をコピーしない

`HistoryEntry` は「コマンドが書き換える領域の、書き換える前のバイト」だけ
持つ。4000×3000 でストローク 1 本が 12MB ではなく数十 KB で済む。

`affectedRect()` が要。

- 広すぎる → Undo が重い
- 狭すぎる → Undo で戻りきらない（見た目のバグ）

新しいコマンドを足したら、`affectedRect` と
「実行 → Undo で完全に元に戻る」テストを必ず書く。

## 8. Rust と TypeScript の二重実装

`kirily-mask` / `kirily-raster`（Rust）と `image-core`（TypeScript）は
**同じ振る舞い**を持つ。WASM が使えない環境で機能を落とさないため。

片方だけ直すと、ブラウザによって結果が変わるという最悪のバグになる。
両方に同じ入出力のテストを置くこと。たとえば
「alpha=128 の黒を白に合成すると 127」は Rust 側と TS 側の両方にある。

## 9. 段階的な劣化

```text
Renderer:  WebGPU → WebGL → Canvas2D
AI:        BiRefNet-lite → IS-Net → U²-Netp → 境界色フォールバック
Pixel ops: WASM → TypeScript
```

フォールバックは**機能単位**で持つ。「WebGPU がないから全部遅い経路」では
なく、使えるものだけ使う。`loadImageEngine()` と `planModels()` が
それぞれの判断点。

AI の段は **提示する前に端末の能力を見る**（`detectGpu()`）。
落ちてから次へ行く設計だけだと、ユーザーは 100MB 以上を無駄に
ダウンロードしてから失敗を見ることになる。詳細は ADR-0007。

### 前処理・後処理は仕様の一部

モデルごとの `mean` / `std` / sigmoid の有無 / min-max 再スケールは
`ModelSpec` に書く。間違えても**クラッシュしない**。
「それらしいが間違ったマスク」が出るだけなので、元実装（rembg など）に
合わせ、`tensor.test.ts` で値を固定する。

推論は **Preview 解像度**で行い、出力の alpha を `resampleMask` で
元解像度へ上げる。モデルの入力は 320² か 1024² であって、
ユーザーの画像サイズではない。

### 出力が怪しいときは参照実装と突き合わせる

前処理を間違えても落ちない。「それらしいが少し違うマスク」が出るだけ。
モデルの癖なのか実装のバグなのかは、**Python + onnxruntime で
rembg と同じ前処理を書いて同じ画像を通し、マスクを並べれば**分かる。
推測で正規化パラメータをいじらない。

### 内部が抜けるのはモデルの癖

背景と被写体の色が近いと、モデルは内部の確信度を落とす。
`solidifyInterior()` が、縁から辿った背景からの距離を見て
輪郭の帯だけ残しつつ内部を閉じる。閾値で潰すと髪の輪郭まで固くなる。
詳細は ADR-0007。

## 10. 計測してから速くする

計測対象（IMPLEMENTATION.md §59）:

```text
decode_ms / ai_load_ms / ai_inference_ms / mask_refine_ms
preview_render_ms / export_ms / memory_peak
```

「WASM にすれば速い」は仮説。TypeScript で書いて計測し、
ホットスポットが出てから Rust へ移す。

**ログに画像の内容やファイル名を出さない。** 出してよいのは
操作名・所要時間・画像の寸法・ブラウザの対応状況・エラーコードだけ。
