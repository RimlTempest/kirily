# ADR-0009: サプライチェーン攻撃への備え

- 状態: 採用
- 日付: 2026-09-21

## 背景

Kirily は npm から 278 個のパッケージを引いている。この経路は
2025〜2026 に繰り返し攻撃されており、オープンソースマルウェアの 99% 以上が
npm で観測されている。2026 年初頭だけでも Axios・LiteLLM・Trivy が侵害された。

攻撃は主に 3 つの形を取る。

1. **公開直後の悪意あるバージョン** — 正規パッケージのメンテナ権限を奪い、
   マルウェア入りの版を公開する。検知されるまでの数時間〜数日が危険窓
2. **インストールスクリプト** — `postinstall` は `bun install` しただけで
   任意コードを走らせる
3. **lockfile と CI** — lockfile を書き換える、可動タグの GitHub Action を
   差し替える、CI のトークンを盗む

## 決定

### 1. 依存は正確なバージョンで固定する

`bunfig.toml` の `exact = true`。範囲指定は「こちらが何もしていない間に
別のコードが入ってくる」経路そのもの。

CI は常に `bun install --frozen-lockfile`。lockfile と package.json が
食い違ったら失敗する。これが、開発時と本番ビルドの間で版が差し替わる
のを防ぐ唯一の仕組み。

### 2. 公開直後のバージョンを掴まない

`bunfig.toml` の `minimumReleaseAge = 604800`（7 日）。悪意ある公開が
検知・撤回されるまでの猶予を置く。

**これは依存を追加・更新するときにしか効かない。** 既に `bun.lock` に
載っている版はそのまま入る。既存の固定を守るのは `--frozen-lockfile` のほう。
両方が要る。

### 3. 依存の postinstall を実行しない

bun の既定で依存のライフサイクルスクリプトは実行されない。必要な依存だけを
`package.json` の `trustedDependencies` に挙げる方式。

**いまは 1 つも挙げていない。** `protobufjs` と `@tailwindcss/oxide` は
スクリプトを止めたまま動いている。`bun pm untrusted` で止まっているものを
確認できる。増やすときは、なぜそのスクリプトが要るのかを調べてから。

ルートの `prepare` / `postinstall` は Kirily 自身のスクリプトで、
`lefthook install` と `svelte-kit sync` を走らせる。これは依存ではない。

### 4. GitHub Actions は commit SHA で固定する

タグは可動。`actions/checkout@v5` は、その action が乗っ取られた瞬間から
CI で任意コードを走らせる。SHA で固定し、タグは末尾のコメントに残す。

```yaml
- uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
```

CI の `guard` ジョブが、タグ固定の action が混ざっていないか検査する。

### 5. CI に認証情報を残さない

`actions/checkout` は既定で `.git` にトークンを書き込み、以降の step から
使えてしまう。push しないジョブには要らないので `persist-credentials: false`。

`permissions: contents: read` でワークフロー全体を読み取りに落としている。

### 6. 既知の脆弱性を抱えたまま本番を作らない

`fmt + lint` ジョブで `bun audit --audit-level=high`。lockfile に固定した版が
あとから勧告を受けることがあるので、毎回見る。

`bun audit` は npm の勧告データベースを引くだけで、専用スキャナの代わりには
ならない。届かない範囲があることを承知で使う。

### 7. 更新を止めない

Dependabot を weekly で回す（`cooldown: 7 days` で §2 と足並みを揃える）。
**更新を止めることもリスク**で、修正済みの脆弱性を抱えたまま固定し続ける
ことになる。特に §4 で SHA 固定にした action は、放置すると古いまま残る。

## 結果

- 依存を足すときに 7 日待つ必要がある。急ぎのときは理由を添えて手で外す
- `bun audit` が落ちたら、直すか勧告を評価するまでマージできない
- action の更新が Dependabot 経由になり、手で書き換えなくなる
- 残っている既知の脆弱性は 1 件（low）。SvelteKit の推移的依存 `cookie@0.6.0`
  で、こちらからは上げられない。SvelteKit の更新を待つ

## 代替案

- **lockfile を固定しない** — 検討に値しない
- **Socket / Snyk などの専用スキャナ** — `bun audit` より広く見えるが、
  外部サービスへの依存が増える。必要になったら足す
- **依存を減らす** — 最も効く対策。ONNX Runtime と Svelte 以外は
  ツールチェーンなので、本番バンドルに入る依存は既に少ない
