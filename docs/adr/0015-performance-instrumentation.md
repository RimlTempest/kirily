# ADR-0015: どこに時間が行っているかを測る

- 状態: 採用
- 日付: 2026-09-21

## 背景

M3 は「速度とメモリ」だが、ロードマップの項目
（Worker 化 / WebGL レンダラ / タイル処理 / SIMD）はどれも
**仮説**である。`kirily-image-pipeline` はこう書いている:

> 「WASM にすれば速い」は仮説。TypeScript で書いて計測し、
> ホットスポットが出てから Rust へ移す。

M2 で品質に対して同じことをした（ADR-0010）。速度にも同じ物差しが要る。

外から見ると「AI が遅い」も「エンコーダが遅い」も同じスピナーに見えるが、
必要な作業は正反対である（IMPLEMENTATION.md §59）。

## 決定

**設計書 §59 の段を、実際に走る場所で測る。**

```
decode · preview · ai_load · ai_inference
mask_refine · mask_matte · preview_render · export
```

`mask_matte` は §59 に無い。ADR-0013 で足した段なので、ここにも足した。

### 記録してよいもの

**所要時間・段の名前・寸法だけ。** ファイル名も画素も入らない。
エラーコードが従っている規則と同じで、
この数字を画面に出しても外へ送っても安全である理由でもある。

### 時計は注入する

`createStopwatch(now)` は `performance.now` を既定値にしない。
`contract` は DOM に触れない規約であり、Worker とメインスレッドは
**別の時計**であり、時間を操作できないテストは時間について何も主張できない。

### Worker の段は Worker で測る

`ai_load` と `ai_inference` は `ai.worker.ts` で測り、
`AiResponse` に載せて返す。メインスレッドで往復を測ると、
ダウンロードとコンパイルと推論が 1 つの数字に潰れる。
この 3 つは必要な対策がまったく違う。

### 表示は `?timings=1` のときだけ

利用者に `ai_inference 812ms` を見せても、その人にできることは無い。
画像を覆うものが 1 つ増えるだけである。開発者の計器として扱う。

## 最初に測って分かったこと

`pale-subject-on-white.png`（1254²）、ローカル配信。

### 軽量段（U²-Netp, CPU）

```
ai_inference 1171ms · preview_render 330ms · ai_load 322ms
mask_refine 50ms · export 43ms · mask_matte 37ms · preview 3ms · decode 3ms
```

### 高精度段（IS-Net fp16, WebGPU）

```
ai_load 2475ms · preview_render 431ms · ai_inference 306ms
mask_refine 51ms · export 44ms · mask_matte 28ms · decode 8ms · preview 3ms
```

**1. ロードマップが挙げていた項目のうち 2 つは、直す理由が無い。**
`decode` は 3〜8ms、`export` は 43ms。タイル処理も SIMD も、
ここには効く先が無い。8K 以上でどうなるかは別に測る必要がある。

**2. 画素演算の Worker 化も、いまは効かない。**
`mask_refine` + `mask_matte` で 80ms。メインスレッドを 80ms 止めるのは
褒められないが、AI の 1171ms の横では優先度が低い。

**3. 本当のボトルネックはレンダラだった。**
`preview_render` は 1 回のセッションで 330〜431ms 積み上がる。
1 フレームを切り出して測ると:

| キャンバス                 | 1 フレーム | fps    |
| -------------------------- | ---------- | ------ |
| 800×600                    | 12.1ms     | 83     |
| 1440×900                   | 26.9ms     | 37     |
| 2560×1600（Retina 全画面） | **84.6ms** | **12** |

画素あたり約 20ns で、**キャンバスの画素数に比例する**。
Retina のノート PC を全画面にすると 12fps で、
ブラシで塗っている最中にそれを体験することになる。

これは `kirily-design.md §37` の 3 本柱のうち「操作感」そのものである。
除染の上乗せは 10% 程度で、原因ではない。

**4. 高精度段の初回は `ai_load` が支配する。** 84 MiB の取得とコンパイルで
2475ms、しかもこれは localhost の数字である。実ネットワークではもっと悪い。

## 次にやること

計測が名指ししたのは **WebGL レンダラ**（ロードマップ M3）である。
`renderViewport` は 1 画素ごとに色とマスクをバイリニアで読み、
必要なら混色を解いている。GPU のフラグメントシェーダが
まさにそのために作られた形の処理である。

段階的な劣化は既定の方針なので、Canvas 2D の経路は残す
（`kirily-image-pipeline` §9）。
