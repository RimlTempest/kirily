# ADR-0028: 手で起こす workflow は、必要になるまで壊れていても分からない

- 状態: 採用
- 日付: 2026-09-22

## 起きたこと

`deploy` workflow を初めて最後まで回したら、`bun run wasm:build` が
**exit 127** で落ちた。

```
/usr/bin/bash: line 1: wasm-pack: command not found
```

`mise.toml` が固定しているのは rust 本体までで、**`wasm-pack` は入らない。**
`cargo install wasm-pack --locked` が別に要る。CI の `typecheck-test` と
`e2e` にはその行がある。`deploy` には無かった。

## なぜ今まで気付かなかったのか

**`deploy` は `workflow_dispatch` だけで起きる。** push でも PR でも走らない。
意図的にそうしてある（外向きの publish を自動でやらない、ADR-0024）。

そして `kirily.riml4i.com` への最初のデプロイは**手元の wrangler で**行った。
だから今日まで、この job が通しで走ったことが一度も無かった。

> 必要になるまで誰も回さない workflow は、
> **必要になった瞬間に壊れている workflow** である。

回してみるまで分からない、では遅い。回すのはデプロイしたいときだけで、
そのときには既にデプロイしたいのだから。

## 決定

直接の修正は 1 行（`cargo install wasm-pack --locked` を `deploy` に足す）。
ADR にするのは**そこではない**。

`tools/check-workflow-tools.ts` を足して、`guard` job から呼ぶ。
**push のたびに走る検査が、手で起こす workflow を見る。**

### job 単位で見る

```ts
const NEEDS = [['bun run wasm:build', 'cargo install wasm-pack']]
```

ファイル単位ではなく job 単位。**job はそれぞれ別のランナーで動く**ので、
隣の job の `cargo install` はここでは何も入れていない。同じファイルに
両方の文字列があることを確認しても、この失敗は通ってしまう。

順序も見る。要るものを**使ったあとに**入れるのは、ログが長いだけで
同じ失敗だから。

### YAML パーサを足さない

依存を 1 つ増やすということは、入口を 1 つ増やすということ（ADR-0009）。
2 ファイルのためにそれは割に合わない。

代わりにインデントで job を切っている。頼っているのは
「トップレベルの `jobs:` の下に 2 スペースで job 名が並ぶ」という、
GitHub が要求している構造そのもの。

## 検査が本当に効くことを確かめた

落ちたコミットの `deploy.yml` をそのまま食わせた:

```
job "deploy" runs `bun run wasm:build` without `cargo install wasm-pack`.
It will exit 127.
```

**実際に出た失敗を、修正前のファイルで再現できる**ことまで見ている。
「書いたけれど何も捕まえない検査」は、無いよりたちが悪い。

単体テスト 8 件。job の切り出し 3 件と、検査 5 件
（通る / 入れていない / 遅すぎる / **隣の job のものを借りようとする** /
そもそも wasm を作らない）。

## 残っている似たもの

`mise.toml` の `LEFTHOOK_BIN` が `lefthook-darwin-arm64` を指している。
Linux のランナーでもこの環境変数が入るが、CI は git hook を入れないので
参照されない。**いま壊れていないだけで、同じ形の穴**ではある。
踏んだら直す。
