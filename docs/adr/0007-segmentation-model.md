# ADR-0007: セグメンテーションモデルの選定と配信

- 状態: 採用
- 日付: 2026-09-21

## 背景

プレースホルダ（境界色のフラッドフィル）を本物のモデルに置き換える。
`kirily-design.md §17` の目標は「remove.bg 級」で、同 §29 は
「単純なモデル名では精度を保証できない」としている。

制約は 4 つある。

1. **ライセンス** — 商用を閉ざさない。RMBG-1.4 / 2.0 は BRIA ライセンスで
   商用に有償契約が要るため候補から外す。
2. **サイズ** — 重みはユーザーが毎回ではないにせよ一度はダウンロードする。
3. **配信** — Cloudflare は静的アセット **1ファイル 25 MiB** が上限。
4. **実行環境** — WebGPU が無い端末でも機能を落とさない（§24）。

## 決定

### モデルは 3 段、端末の能力で選ぶ

| 段  | モデル               | ライセンス | 入力  | サイズ  | 条件                                                |
| --- | -------------------- | ---------- | ----- | ------- | --------------------------------------------------- |
| 1   | BiRefNet-lite (fp16) | MIT        | 1024² | 109 MiB | WebGPU かつ `maxStorageBuffersPerShaderStage >= 11` |
| 2   | IS-Net general-use   | Apache-2.0 | 1024² | 170 MiB | WebGPU                                              |
| 3   | U²-Netp              | Apache-2.0 | 320²  | 4.4 MiB | 常時（WASM）                                        |
| —   | 境界色フラッドフィル | —          | —     | 0       | 上記すべてが動かないとき                            |

選択は `packages/ai/src/local/onnx/plan.ts` の純粋関数。
連鎖は `packages/ai/src/chain.ts` が行い、ロードでも推論でも失敗したら
次の段へ落ちる。

### 2 段目が必要な理由（実測）

BiRefNet-lite は **Apple GPU で動かない**。デコーダの `Split` ノードが
1 シェーダステージに storage buffer を 11 個バインドするのに対し、
Apple GPU は `maxStorageBuffersPerShaderStage` を **10** と報告する。

```
Non-zero status code returned while running Split node. Name:'/decoder/Split_33'
Too many storage buffers in shader. Current: 11, Max is 10
```

WebGPU 仕様の保証は 8 なので、これは Apple 固有ではなく
「そういう端末が普通にある」と考えるべき値。

**この失敗は 109 MiB をダウンロードし終えてから起きる。**
だからアダプタの limits を先に読み、条件を満たさない端末には
そもそも BiRefNet を提示しない。IS-Net は同じ 1024² で
storage buffer の要求が収まり、Apple GPU で動作することを実測で確認した。

`navigator.gpu` の存在だけでは判定しない。ヘッドレス Chromium も
実機の一部も、オブジェクトは生やしてアダプタを返さない。
`requestAdapter()` の結果で判定する。

### 重みは自前ドメインから分割配信する

`bun run models:fetch` が Hugging Face / GitHub Releases から取得し、
サイズと SHA-256 を検証し、24 MiB 未満の shard に分割して
`apps/web/static/models/<id>/` へ置く。ブラウザは manifest を読んで
shard を順に取得し、結合してから **再度 SHA-256 を検証**する。

これにより:

- `connect-src 'self'` を維持できる。ページはどこにも接続しない。
  画像が端末を出ないという約束（ADR-0004）と同じ保証が重みにも効く
- 重みが git に入らない。クローンは小さいまま、ライセンスはリンクで示す
- 途中で切れた・差し替わった重みを検出できる。壊れた重みは
  エラーにならず「それらしいが間違ったマスク」を出すので、検証は必須

### ONNX Runtime は Vite が同一オリジンで配信する

`onnxruntime-web` は既定で wasm を CDN から取りにいく。バンドラが
`new URL()` を解決して同一オリジンのアセットとして出力するので、
`wasmPaths` も `wasmBinary` も設定しない。

`env.wasm.wasmBinary` に自前の binary を渡す方式は**採らなかった**。
ランタイムは複数の wasm ビルド（plain / asyncify / jspi）から実行時に
選ぶため、こちらが渡した 1 本と食い違うと wasm はインスタンス化に成功した
まま未定義シンボルを読んで落ちる。原因が分からない形で壊れる。

WebGPU 側は **JSPI ビルド**を使う（`onnxruntime-web/jspi`）。
既定の WebGPU エントリは Asyncify ビルドを読み、その wasm は
**25.5 MiB で Cloudflare の上限を超える**。JSPI ビルドは 16 MiB で収まり、
JSPI は WebGPU が実用になる Chromium と同世代で入っている。

`tools/check-asset-sizes.ts` がビルド後に全アセットを検査し、
25 MiB を超えたら落とす。この制約はデプロイして初めて分かるには高すぎる。

### スレッドは使わない

`ort.env.wasm.numThreads = 1`。マルチスレッドは SharedArrayBuffer を要し、
全レスポンスに COOP/COEP ヘッダが必要になる。速度が要る場面は
WebGPU が担うので、埋め込み互換性を捨てるほどの利得がない。

## 結果

- 商用を閉ざさない（MIT / Apache-2.0 のみ）
- WebGPU のある端末は 1024² の高精度モデル、無い端末も 320² のモデルが動く
- 動かない組み合わせに大きなダウンロードをさせない
- デプロイ対象の静的アセットが 284 MiB 増える
- 同じ品質のモデルを 2 本持つぶん、検証対象が増える

## 未検証・今後

- BiRefNet の段は `maxStorageBuffersPerShaderStage >= 11` の GPU が要る。
  macOS の開発機では検証できない。Windows / Linux で確認すること
- WebGPU 経路の E2E はアダプタが要る。ローカルでは
  `chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu'] })`
  で実 GPU が取れる
- IS-Net の fp16 版があれば 170 MiB → 85 MiB になる。変換は未実施
- マッティング（髪の半透明）と色の除染は未配線。
  `decontaminate_edges` は Rust 側に実装済み

## 代替案

- **RMBG-1.4 / 2.0** — 品質は候補中最良だが商用に有償契約が要る
- **U²-Netp のみ** — 4.4 MiB で軽いが、境界品質が製品基準に届かない
- **実行時に Hugging Face から取得** — 実装は軽いが CSP に外部ドメインが
  必要になり、ユーザーの IP が第三者に渡る
- **R2 パブリックバケット** — 分割不要だが従量課金を止められない
