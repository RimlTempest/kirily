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
- [x] 背景透過（本物のモデル / ONNX Runtime Web / Web Worker）
- [x] ブラシ（残す / 消す、太さ、ソフトエッジ）
- [x] Undo / Redo（領域パッチ方式）
- [x] 元解像度 PNG 書き出し
- [x] E2E（desktop + mobile）+ axe によるアクセシビリティ検査
- [ ] iOS Safari の E2E（`KIRILY_E2E_WEBKIT=1` で opt-in。既定では回っていない）
- [x] バケツ（クリックで領域をまとめて／OKLab の許容差、soft edge）
- [x] ズーム / パン（ホイール・ピンチ・ドラッグ・プリセット・キーボード）
- [x] トリミングの UI（比率プリセット・4 隅ハンドル・ドラッグで新規作成）

## M2 — 本物の AI

- [x] セグメンテーションモデルの選定（ADR-0007）
- [x] ONNX Runtime Web + WebGPU、WASM フォールバック
- [x] 端末能力に応じた 3 段のモデル選択と、失敗時の段階的な降格
- [x] 重みの分割配信と SHA-256 検証
- [ ] BiRefNet 段の実機検証（storage buffer 11 以上の GPU が要る。手元の Apple GPU は 10 で、IS-Net 段しか測れていない）
- [x] IS-Net の fp16 化（170 MiB → 84 MiB、品質は指標 20 個すべて不変、ADR-0014）
- [x] guided filter による輪郭精緻化（ADR-0008）
- [x] マスク拡大の Lanczos 化と、縮小時のエイリアス除去
- [x] モデル解像度の拡大で残るランプの解消（ADR-0013 の色差マッティングが担当）
- [x] 囲まれた小さい穴を閉じる（面積で判別、ADR-0012）
- [x] 色差マッティング（合成の式を解いて輪郭を画素から決める、ADR-0013）
- [ ] マッティング段のモデル。BEN2 は ORT Web で動かず却下（ADR-0020）。BiRefNet-matting の ONNX が出れば最有力
- [x] 色の除染（背景色を粗いグリッドで推定、プレビューと書き出しの両方、ADR-0011）
- [x] 評価データセットと回帰（IoU / Boundary F-score / MAE、ADR-0010）

## M3 — 速度とメモリ

- [x] 段ごとの計測（decode / ai*load / ai_inference / mask*\* / preview_render / export、ADR-0015）
- [x] AI Worker（`ArrayBuffer` 転送）
- [x] WebGL レンダラ（メインスレッド 55.78ms → 0.02ms/フレーム、Canvas 2D は残す、ADR-0016）
- [x] 表示領域だけを合成（コストが画像サイズではなく画面サイズで頭打ちになる）
- [ ] ~~画素演算の Worker 化~~ — `mask_refine` + `mask_matte` で 80ms。AI の 1171ms の横では優先度が低い（ADR-0015）
- [ ] ~~タイル処理（8K 以上）~~ — `decode` 3〜8ms、`export` 43ms。8K で測り直してから
- [ ] ~~WASM SIMD~~ — 効く先が計測で見つかっていない

### 計測から出た追加項目

- [x] シャードの並列取得（`ai_fetch` 2043ms → 715ms、ADR-0017）
- [ ] モデル資産のキャッシュ（2 回目の訪問でも 715ms 払っている。パスにハッシュを入れる必要あり）

### 仕上げ

- [x] 3 つの「動かす」（表示 / 背景 / 被写体。2 本指パンとパンツールを含む、ADR-0023）

- [x] 背後に敷くもの（なし / 色 / 画像。どの形式でも、ADR-0022）
- [x] クリップボード（貼り付けで開く、結果をコピー、ADR-0022）

### 手動ツール

- [x] 縁の調整（締める / ぼかす。−1px で残る縁が 84% 消える、ADR-0021）
- [x] 余白を詰める（見えているものの最小矩形を crop に、ADR-0021）

- [x] バケツの縁を画像から決める（階段 → ランプ、部分選択 0.3% → 4.2%、ADR-0019）
- [x] AI の輪郭でバケツを止める（許容差 0.08 で顔が食われるのを防ぐ、ADR-0019）

## M4 — 製品化

- [x] WebP / JPEG 書き出しの UI（背景色・品質。JPEG はプレビューの背景もその色になる、ADR-0018）
- [ ] モバイルのボトムシートとジェスチャ
- [ ] 視覚的回帰テスト
- [ ] 匿名イベントの計測（画像の内容は送らない）
- [ ] Cloudflare へのデプロイ（Workers へ移行済み・`wrangler dev` で E2E 81 件検証済み・手動ワークフローあり。実行は未、ADR-0024）
- [ ] Lighthouse / axe の CI 化
