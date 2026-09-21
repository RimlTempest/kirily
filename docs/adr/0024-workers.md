# ADR-0024: Pages ではなく Workers に出す

- 状態: 採用
- 日付: 2026-09-22

## 背景

`wrangler.jsonc` は `pages_build_output_dir` を持っていて、Cloudflare Pages の
設定だった。Pages はメンテナンスモードで、新機能は Workers の静的アセット側に入る。

前回は移さなかった。理由は「**デプロイ設定が動くかはデプロイして初めて分かる**もので、
動いている設定を確かめないまま置き換えるのは順序が逆」だった。

その前提が間違っていた。`wrangler dev` は**本物の workerd** を起動し、
本物のアセット配信を行う。**デプロイしなくても確かめられる。**

## 決定

**Workers の静的アセットに移す。**

設定の差は 2 行である。

```jsonc
"main": ".svelte-kit/cloudflare/_worker.js",
"assets": { "directory": ".svelte-kit/cloudflare", "binding": "ASSETS" }
```

`@sveltejs/adapter-cloudflare` がこのファイルを読んで、どちらの形で出すかを決める。
`.assetsignore`（`_worker.js` を静的ファイルとしても配ってしまわないための除外）は
アダプタが書く。`_routes.json` は Pages 固有なので出なくなる（42 → 41 ファイル）。

## 確かめたこと

`bunx wrangler dev` を起こして、**そこに E2E 一式を当てた。**

```
81 passed / 7 skipped
```

`playwright.config.ts` に `KIRILY_E2E_URL` を足した。これがあれば
webServer を起こさず、指定した URL を検査する。**同じ仕掛けが
デプロイ後の本番確認にも使える。**

### `_headers` が効くことも、ここで初めて確かめられた

`vite preview` は `_headers` を解釈しない。ADR で「デプロイ先でしか
確かめられない」と書いたが、`wrangler dev` なら確かめられる。

```
[wrangler:info] ✨ Parsed 3 valid header rules.

/models/u2netp/u2netp.onnx.000
  Cache-Control: no-cache
  x-robots-tag: noindex
  ETag: "365a7e4f23a3ba2cc4f9af43fcf20b85"

/_app/immutable/entry/start.*.js
  Cache-Control: public, immutable, max-age=31536000
```

条件付きリクエストも確かめた。

```
If-None-Match 付き … 304、0 バイト
付けない       … 200、4,574,861 バイト
```

## 手で起こすデプロイ

`.github/workflows/deploy.yml` は `workflow_dispatch` のみで、push では走らない。

**外向きの publish だからである。** main が緑であることと、出す用意ができていることは
別のことで、その判断は人がする。

ワークフローは出す前に 2 つ止める。

1. `bun run check`。緑でないものを外に出さない
2. **3 つのモデルがビルドに入っているか。** 取り忘れたビルドは落ちない。
   全員を「簡易処理」に落とすだけで、静かに悪くなる。だから出る前に止める

重みは `tools/fetch-models.ts` の中身をキーにキャッシュする。
URL か SHA-256 を変えたときだけ 198 MiB を取り直す。

## 置いた罠

`cloudflare/wrangler-action` の SHA を `# v3` と添えて書いた。

最初これを「推測で書いた」と報告したが、**調べたら実在するコミットだった**
（`da0e0df…`、2025-03-15）。記憶から出てきた古い SHA を、
確かめずにそれらしい注釈と並べた、というのが正確なところである。

どちらでも pin は間違っているが、**どちらかで効く検査が変わる。**
存在しない SHA なら「実在するか」で捕まる。実在するが別の版のものなら、
**タグと照合しない限り捕まらない。** 実際に起きたのは後者だった。

CI の `guard` は「SHA で固定されているか」しか見ていなかったので、
**通ってしまっていた。** ADR-0009 が「タグは可動だから commit SHA で固定する」と
書いているのは、まさにこういう取り違えを防ぐためである。
固定されていることと、**正しいものに固定されていること**は別である。

`tools/check-action-pins.ts` が両方を見るようになった。ADR-0025。
