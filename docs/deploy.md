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

## ドメイン

`kirily.riml4i.com` は `wrangler.jsonc` の `routes` に宣言してある
（`custom_domain: true`）。DNS のレコードも証明書も Cloudflare が作る。

ダッシュボードで足さずに設定に書くのは、**このサイトがどこで応答するかを
リポジトリの一部にする**ため。ダッシュボードで足したものは diff に出ない。

`workers.dev` は**無効**。`routes` を足すと wrangler が
`workers_dev: false` と推論するためで、**何も言わずにそうなる**。
実際、ドメインを足したデプロイで `kirily-web.riml.workers.dev` は 404 になった。

推論に任せず `wrangler.jsonc` に書いてある。設定ファイルを読めば
どの住所で応答するかが分かる、という状態にしておくため。

条件は 2 つで、どちらも満たしている。

- ゾーンが Cloudflare にあること（`riml4i.com` のネームサーバーは
  `lina/newt.ns.cloudflare.com`）
- そのホスト名に CNAME が無いこと（`kirily.riml4i.com` は未使用だった）

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

## ゾーンの機能に注意する

`riml4i.com` のゾーンで **Cloudflare Web Analytics（Browser Insights）が
有効**になっていて、`static.cloudflareinsights.com/beacon.min.js` を
全ページに注入してくる。

**CSP が弾いている。** `script-src 'self'` にサードパーティは入っていない。
コンソールにエラーが出るが、**アプリは正常に動く**（ハイドレートも表示も問題ない）。

CSP に足して通すべきではない。トップページは「この画像はブラウザ内で
処理されます」と約束していて、**第三者のビーコンはその約束と両立しない。**
`svelte.config.js` が「依存が行儀悪くしても守られるように」と書いている、
まさにその働きをしている。

直すならゾーン側で切る。dash → riml4i.com → Analytics → Web Analytics を無効に。
切らない限りビーコンは弾かれ続け、**計測もされないままコンソールに
エラーだけが出る**状態になる。

## 出した後に確かめること

E2E をそのまま本番へ向けられる。これが一番早い。

```bash
cd tests/e2e
KIRILY_E2E_URL=https://kirily.riml4i.com bunx playwright test --project=desktop
```

手で見るなら:

1. トップが出る
2. 画像を 1 枚入れて「背景をきりり」→ 状態表示が **「簡易処理」でない**こと
   （簡易処理なら `models:fetch` を忘れている）
3. `/models/isnet-general-use/manifest.json` が 200 を返す
4. shard のレスポンスに `cache-control: no-cache` が付いている
5. 2 回目の読み込みで shard が 304 になる

## Pages から移した

ADR-0024。`wrangler dev` に E2E 一式を当てて、81 件が通ることを確かめてある。
