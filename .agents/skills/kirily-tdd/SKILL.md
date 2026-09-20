---
name: kirily-tdd
description: Kirily のテスト規約。機能追加・バグ修正の実装を書き始める前に読む。必ず失敗するテストから始め(red→green→refactor)、テストサイズ(Small/Medium/Large)で置き場所とツールを選ぶ。画像処理のゴールデンテスト、Rust と TypeScript の二重実装の整合、視覚的回帰、AI 精度評価の扱いを定義する。「テストをどこに置くか」「Canvas をどうテストするか」「AI の精度をどう測るか」「遅い・不安定なテスト」で発火。
---

# Kirily テスト規約

## 1. red → green → refactor を飛ばさない

1. **red**: 失敗するテストを書く。実行して**期待どおりに失敗すること**を確認する。
   通ってしまうテストは何も検証していない。
2. **green**: 通す最小の実装。ここで設計を凝らない。
3. **refactor**: テストが緑のまま構造を直す。

バグ修正も同じ。**再現するテストを先に書く**。修正前に落ちること、
修正後に通ることの両方を確認する。

## 2. テストサイズ

サイズは「速さ」ではなく **何に依存してよいか** で決まる。

| サイズ     | 依存してよいもの                                   | 目標    | ツール                    | 置き場所                              |
| ---------- | -------------------------------------------------- | ------- | ------------------------- | ------------------------------------- |
| **Small**  | 自プロセスのメモリのみ。DOM・I/O・時計・乱数は禁止 | < 100ms | `bun test` / `cargo test` | 実装の隣 `*.test.ts` / `#[cfg(test)]` |
| **Medium** | jsdom / OffscreenCanvas / 実際の WASM ロード       | < 5s    | `bun test` + happy-dom    | `apps/web/**/*.test.ts`               |
| **Large**  | 実ブラウザ、実描画、複数コンポーネント結合         | < 60s   | Playwright                | `tests/e2e/`                          |

**比率の目安 70 : 20 : 10。** Medium/Large が増えてきたら、
依存が注入されていないサイン。設計を直す。

`packages/*` は DOM を持たないので**全部 Small で書ける**。
書けないなら、それは DOM が漏れている。

## 3. テストは What を書く

テスト名は**振る舞いの主張**にする。実装の手順ではない。
落ちたときに、テスト名だけで「何が壊れたか」が分かること。

```ts
// ○ 保証されている振る舞い
test('keeps a genuine hole, because the model is confident about it')
test('manual edits win over the AI mask')
// ✗ 手順しか書いていない
test('calls solidifyInterior with backgroundBelow 24')
test('works')
```

書く場所ごとの役割分担は `kirily-typescript` の「どこに何を書くか」。
コードに How、テストに What、コミットログに Why、コメントに Why not。

## 4. 画像処理のテストの書き方

### 値で検証する。画像で検証しない

```ts
// ○ 何が期待値で、なぜそうなのかが読める
expect(rgba[8]).toBe(127); // alpha=128 の黒を白に合成 = 127

// ✗ 落ちたときに何が起きたか分からない
expect(canvasDataUrl).toBe(EXPECTED_DATA_URL);
```

### 小さい画像を手で組む

3×3 や 9×9 のバッファを手で作れば、期待値を頭で計算できる。
フィクスチャ画像が要るのは E2E と視覚的回帰だけ。

### フィクスチャは「何を落とすための画像か」で選ぶ

`tests/fixtures/README.md` に 1 枚ずつ用途と出自を書く。
用途が言えない画像は置かない。

`pale-subject-on-white.png` は背景と肌の明度がほぼ同じイラストで、
モデルが内部の確信度を落とすケース（ADR-0007）。**プローブの座標は
実測で決める。** 見た目で「このあたり」と置くと、回帰が起きても
テストが通ってしまう（実際に一度そうなった）。マスクをグリッドで
サンプリングして、壊れている座標を特定してから書く。

新しいアサーションを足したら、**直した修正を一時的に戻して
落ちることを確認する**。落ちないテストは回帰を捕まえない。

```ts
const layer = new Uint8Array(81);
stampBrush(layer, { width: 9, height: 9 }, imagePoint(4.5, 4.5), brush);
expect(layer[4 * 9 + 4]).toBe(255);
expect(layer[0]).toBe(0);
```

### 必ず入れる境界値

- 画像の端（ブラシが左端で右端に回り込まないこと）
- 0 / 255（完全透明 / 完全不透明は特別扱いしていることが多い）
- サイズ不一致（マスクと画像の長さが違う → `Result` のエラー枝）
- 半径 0 / 不透明度 0（何も起きないこと）
- 幅か高さが 1 の画像

### Rust と TypeScript の整合

同じ振る舞いを 2 回実装しているので、**同じ入出力のテストを両方に置く**。
片方だけ直したら落ちるようにしておく。

```rust
// crates/kirily-raster/src/lib.rs
assert_eq!(rgba[8], 127, "half-transparent black over white is mid grey");
```

```ts
// packages/image-core/src/composite.test.ts
expect(rgba[8]).toBe(127);
```

## 5. Undo は「完全に戻る」ことをテストする

```ts
const before = new Uint8Array(layers.remove);
const executed = execute(emptyHistory, stroke, layers);
undo(executed.value, layers);
expect([...layers.remove]).toEqual([...before]);
```

バイト単位で一致すること。「だいたい戻る」は戻っていない。

## 6. AI プロバイダのテスト

プロバイダは差し替え可能なので、**素のオブジェクトで代替する**。

```ts
const provider: BackgroundRemovalProvider = {
  info: { id: 'test', label: '', requiresUpload: false },
  initialize: async () => ok(undefined),
  removeBackground: async () =>
    ok({ width: 2, height: 2, alpha: new Uint8Array([0, 255, 0, 255]) }),
};
```

モデルそのものの精度は単体テストでは測らない。§7 を読む。

## 7. E2E

`tests/e2e/`。**desktop と mobile の両方で同じフローを回す**
（モバイルは PC の縮小版ではないので、片方だけ通っても意味がない）。

必須フロー:

```text
Upload → AI 透過 → ブラシ補正 → Undo → 元解像度 PNG 書き出し
```

書き出しの検証は「ダウンロードされたこと」で終わらせない。
**PNG ヘッダを読んで幅・高さが元画像と一致すること**まで見る。
Preview を書き出してしまうバグは、これでしか捕まらない。

```ts
expect(bytes.readUInt32BE(16)).toBe(120); // width
expect(bytes.readUInt32BE(20)).toBe(120); // height
```

要素はロールとアクセシブル名で取る。取れないならマークアップのバグ。

```ts
page.getByRole('button', { name: '背景をきりり' }); // ○
page.getByTestId('auto-button'); // × 最後の手段
```

## 8. AI 精度の評価は本番コードから分離する

「remove.bg くらい」を感覚で判断しない。評価は別ディレクトリで行う
（kirily-design.md §28）。

```text
evaluation/
├── dataset/   人物 / 髪 / 動物 / 商品 / 透明物 / 逆光 …
├── metrics/   IoU, F1, Boundary F-score, Alpha error
└── reports/
```

モデルを差し替えるときは、この回帰テストを通してから入れる。
特に**境界品質**（髪・指・商品の細部）を重視する。

## 9. 不安定なテストを作らない

- `sleep` を書かない。状態が変わるのを待つ（`expect(...).toBeEnabled()`）
- 現在時刻・乱数を直接呼ばない（注入する）
- テスト間で状態を共有しない
- 並列実行前提で書く

flaky を見つけたら **skip せずその日のうちに直す**。

## 10. コマンド

```bash
bun test packages/                 # Small（TS）
bun test packages/image-core       # 1 パッケージだけ高速に
cargo test --workspace             # Small（Rust）
bun run e2e                        # Large（Playwright, desktop + mobile）
bun run e2e:install                # 初回のみ: Chromium を取得
bun run check                      # 全部
```

E2E は `bun run build` の出力を `vite preview` が配信する。
**ソースを直したら必ずビルドし直してから走らせる**（直したつもりで
古いバンドルを見ていた、という失敗が起きやすい）。

### iOS Safari

`mobile` プロジェクトは Pixel 7（Chromium）。iOS Safari は
**自動では回っていない**。Playwright の WebKit ビルドは一部の Apple Silicon 環境で
起動時にクラッシュするため、明示的な opt-in にしてある。

```bash
bun run --filter '@kirily/e2e' install-browsers:webkit
KIRILY_E2E_WEBKIT=1 bun run e2e
```

`OffscreenCanvas` / `convertToBlob` / Pointer Events は Safari の差異が大きい。
リリース前には実機か、この opt-in で必ず確認する。
