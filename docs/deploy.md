# デプロイ

Cloudflare Pages。ビルドしたものをそのまま配るだけで、
サーバー側の状態も秘密も無い（ADR-0004）。

## 出す前に知っておくこと

### モデルの重みは git に入っていない

`apps/web/static/models` は `.gitignore` にある。ビルド生成物であり、
198 MiB あり、こちらのものではないからである。

**これを取らずにデプロイすると、サイトは動くが全員が「簡易処理」に落ちる。**
エラーにはならない。静かに品質だけが落ちる。

だからデプロイの手順は必ず `models:fetch` から始まる。

### 出るもの

```
42 ファイル / 最大 24.0 MiB / 合計 227.6 MiB
```

Cloudflare の上限は **1 ファイル 25 MiB**、ファイル数は無料枠で 20,000。
`bun run build` の最後に `tools/check-asset-sizes.ts` が走って
25 MiB を超えたら落とすので、気づかずに超えることは無い。

## 手順

```bash
mise install
bun install
bun run wasm:build      # packages/wasm/pkg（git 管理外）
bun run models:fetch    # apps/web/static/models（git 管理外、198 MiB）
bun run check           # 出す前に一度
bun run build

cd apps/web
bunx wrangler pages deploy .svelte-kit/cloudflare --project-name kirily-web
```

初回は Cloudflare のログインと、プロジェクトの作成を訊かれる。

### 設定するものは何も無い

環境変数も秘密もバインディングも無い。`wrangler.jsonc` に
R2 / KV / D1 が**無いこと**自体が設計であり、CI が検査している。
足すということは画像をサーバーに置くということで、
そのときはトップページの約束も書き換わる。

## ヘッダ

`apps/web/_headers` が `/models/*` に `Cache-Control: no-cache` を付ける。

「保存するな」ではなく「毎回確認してから使い回せ」である。
2 回目以降の訪問は shard ごとに条件付きリクエストを出して 304 を受け取り、
実測で 715ms が 208ms になる。

`immutable` にはしない。モデルを差し替えてもファイル名が変わらないので
（ADR-0017）、1 年間古い重みを配り続けることになる。
しかもマニフェストの SHA-256 と合わなくなるので、
その段は**動かなくなる**。安全だが壊れている。
パスにハッシュを入れれば `immutable` が正直になるが、それは別の変更。

**`vite preview` は `_headers` を解釈しない。** このファイルが効いているかは
デプロイ先でしか確かめられない。出したら一度、shard のレスポンスヘッダを見ること。

## 出した後に確かめること

1. トップが出る
2. 画像を 1 枚入れて「背景をきりり」→ 状態表示が **「簡易処理」でない**こと
   （簡易処理なら `models:fetch` を忘れている）
3. `/models/isnet-general-use/manifest.json` が 200 を返す
4. shard のレスポンスに `cache-control: no-cache` が付いている
5. 2 回目の読み込みで shard が 304 になる

## Workers へ移すかどうか

いまの `wrangler.jsonc` は `pages_build_output_dir` を持つ **Pages** の設定。
Cloudflare は新規には Workers の静的アセットを勧めており、Pages は
メンテナンスモードに入っている。

移行自体は小さい（`pages_build_output_dir` を `assets` に変え、
`_worker.js` を `main` にして `.assetsignore` に入れる）。

**まだやっていない。** 移行の可否はデプロイして初めて分かるもので、
動いている設定を、確かめられないまま置き換える理由が無い。
先に Pages で出して、動く状態を持ってから移すのが順序として正しい。
