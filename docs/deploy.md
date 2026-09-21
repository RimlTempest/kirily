# デプロイ

Cloudflare Workers の静的アセット（ADR-0024）。ビルドしたものをそのまま配るだけで、
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

bun run --filter @kirily/web deploy
```

初回は Cloudflare のログインを訊かれる。

## 出す前に、出さずに確かめる

`wrangler dev` は**本物の workerd** と本物のアセット配信を起こす。
`vite preview` では確かめられないもの（`_headers`、`.assetsignore`、
アセットのルーティング）が、ここで確かめられる。

```bash
bun run --filter @kirily/web dev:worker    # :4320

# 別の窓で、E2E 一式をそこへ当てる
cd tests/e2e
KIRILY_E2E_URL=http://localhost:4320 bunx playwright test
```

`KIRILY_E2E_URL` は**デプロイ後の本番にもそのまま向けられる。**

## GitHub Actions から

`.github/workflows/deploy.yml` を **Actions タブから手で起こす**。
push では走らない。

要る秘密は 2 つ。

| 名前                    | 取るところ                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | ダッシュボード → My Profile → API Tokens。テンプレートは **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | ダッシュボードの Workers & Pages 画面の右側                                          |

ワークフローは出す前に `bun run check` を通し、
**3 つのモデルがビルドに入っているかを確かめて**から出す。

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

**`vite preview` は `_headers` を解釈しない。** `wrangler dev` は解釈する
（起動時に「Parsed N valid header rules」と言う）ので、確認はそちらで。

## 出した後に確かめること

1. トップが出る
2. 画像を 1 枚入れて「背景をきりり」→ 状態表示が **「簡易処理」でない**こと
   （簡易処理なら `models:fetch` を忘れている）
3. `/models/isnet-general-use/manifest.json` が 200 を返す
4. shard のレスポンスに `cache-control: no-cache` が付いている
5. 2 回目の読み込みで shard が 304 になる

## Pages から移した

ADR-0024。`wrangler dev` に E2E 一式を当てて、81 件が通ることを確かめてある。
