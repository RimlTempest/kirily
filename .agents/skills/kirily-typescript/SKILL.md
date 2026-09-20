---
name: kirily-typescript
description: Kirily の TypeScript コーディング規約。TS / Svelte の script を書く・直す・レビューする前に必ず読む。any/as/class/enum/! を禁止し、失敗は Result 値で返し、判別可能ユニオンと as const で「起こりえない状態」を型から消し、依存は関数引数で注入する。「型が決まらない」「as で通した」「クラスにするか迷う」「エラーをどう返すか」「テストでモックできない」ときに発火。
---

# Kirily TypeScript 規約

型でユースケースを表現し、実行時に「起こりえない状態」をコンパイル時に消す。
ここに書かれた禁止事項は `.oxlintrc.json` の `kirily/*` ルールで機械的に強制される。
lint が落ちたら回避するのではなく、設計を直す。

## 0. まずこれだけ

| やること                                  | やらないこと                     |
| ----------------------------------------- | -------------------------------- |
| `Result<T, E>` を返す                     | ドメイン層で `throw` する        |
| 型ガード / 判別可能ユニオンで絞る         | `as` でねじ伏せる                |
| ファクトリ関数 + クロージャ               | `class`                          |
| `const X = {...} as const` + 値のユニオン | `enum`                           |
| 引数で依存を受け取る                      | モジュール直下の実体を直接呼ぶ   |
| `unknown` + パース関数                    | `any`                            |
| バッファを引数で受け取り書き込む          | 巨大な配列を戻り値で毎回新規確保 |

最後の 1 行が Kirily 固有。4K の RGBA は約 32MB ある。
詳細は `kirily-image-pipeline` を読む。

## 1. 禁止事項と代替

### `any` 禁止

外部入力（File、`postMessage` のデータ、wasm の戻り）は `unknown` で受け、
**パース関数**で境界を越えさせる。パース関数は
`(input: unknown) => Result<T, KirilyError>` を返す。

### `as` 禁止（`as const` のみ許可）

- 絞り込みは型ガード（`value is T`）か判別可能ユニオンの `switch`。
- オブジェクトリテラルの型検査は `satisfies`。
- `!`（non-null assertion）も禁止。`undefined` の場合を必ず書く。

`noUncheckedIndexedAccess` が有効なので `array[i]` は `T | undefined` になる。
ピクセルループでは `?? 0` で既定値を与える。境界は関数の入口で一度だけ
検証し、内側では検証済みを前提にする。

### `class` 禁止

状態と振る舞いはファクトリ関数 + クロージャで表す。継承ではなく合成。
`interface` ではなく `type` を使う（宣言マージによる暗黙拡張を避ける）。
詳細は [references/function-di.md](references/function-di.md)。

### `enum` 禁止

```ts
const ExportFormat = { Png: 'image/png', WebP: 'image/webp' } as const;
type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];
```

`erasableSyntaxOnly` が有効なので `enum` は型検査でも落ちる。

### `default export` 禁止（設定ファイル・ルートファイル・Svelte コンポーネントを除く）

名前付き export のみ。リネーム時の追跡性とツリーシェイクのため。

## 2. 型でユースケースを表現する

4 つの道具を使い分ける。判断表とコード例は
[references/type-patterns.md](references/type-patterns.md)。

| 道具                      | いつ使うか                                   | Kirily の例                       |
| ------------------------- | -------------------------------------------- | --------------------------------- |
| 判別可能ユニオン          | 状態が複数あり、組み合わせに意味がないとき   | `EditorStatus`, `EditorCommand`   |
| `as const` + 値のユニオン | 取りうる値が有限で、実行時にも名前が要るとき | `KirilyErrorCode`, `ExportFormat` |
| Branded 型                | 素の string/number を取り違えたくないとき    | `ImageId`（`contract/brand.ts`）  |
| タグ付きオブジェクト      | 同じ形で意味が違う値を混ぜたくないとき       | `ImagePoint` / `ScreenPoint`      |

最後のものは Kirily で特に効く。座標系の取り違えは
「ズーム中だけブラシがずれる」という再現しづらいバグになる。
`ImagePoint` と `ScreenPoint` は `space` タグで区別されているので、
混ぜた時点でコンパイルエラーになる。

### `EditorStatus` が boolean ではない理由

```ts
// ✗ これだと「読み込み中かつ書き出し中」が表現できてしまう
type Bad = { isLoading: boolean; isExporting: boolean };

// ○ 同時にひとつしか成立しない
type EditorStatus =
  | { kind: 'idle' }
  | { kind: 'ai-loading'; progress: number }
  | { kind: 'exporting' };
```

`switch` は必ず `assertNever` で閉じる。メンバーを足したとき、
対応漏れが**コンパイルエラーになる**ようにするため。

## 3. 失敗は値で返す

ユーザーに見せる失敗は `Result<T, KirilyError>`。`throw` は
「起こってはいけないこと（不変条件の破れ）」にだけ使う。

```ts
const decoded = await decodeFile(file, budget);
if (!decoded.ok) return fail(decoded.error);
```

`KirilyErrorCode` とユーザー向け文言は
`packages/contract/src/error.ts` で分離されている。**ログに出すのはコードだけ。**
画像の内容・ファイル名は絶対にログへ出さない（IMPLEMENTATION.md §57）。

`packages/editor-core` と `packages/image-core` では `throw` が lint で落ちる
（`kirily/no-throw-in-domain`）。

## 4. 依存は引数で受け取る

DI コンテナもクラスのコンストラクタもない。時計・乱数・`fetch`・
WASM エンジン・AI プロバイダはすべて引数で渡す。

```ts
export const createEditorStore = (
  provider: BackgroundRemovalProvider = createThresholdProvider(),
) => { ... };
```

**`Deps` は自分が所有する型であって、使っているライブラリの形ではない。**
これにより、テストは素のオブジェクトリテラルを渡すだけで済む。
モックライブラリもモジュール差し替えも要らない。

`Deps` は狭く保つ。マスクしか触らない関数に AI プロバイダを渡さない。

## 5. DOM に触ってよい場所

| 置き場所                   | DOM      | 理由                                    |
| -------------------------- | -------- | --------------------------------------- |
| `packages/contract`        | ✗        | 型と純粋関数だけ                        |
| `packages/image-core`      | ✗ (lint) | Worker でも単体テストでも動く必要がある |
| `packages/editor-core`     | ✗ (lint) | 同上                                    |
| `packages/ai`              | △        | アダプタは `fetch` してよい             |
| `packages/wasm`            | △        | wasm のロードのみ                       |
| `apps/web/src/lib`         | ○        | Canvas / File / Pointer はここ          |
| `apps/web/src/**/*.svelte` | ○        | ただしロジックは置かない                |

`kirily/no-dom-in-core` が最初の 2 つを機械的に守る。

## 6. コメントの書き方

**「何をしているか」ではなく「なぜそうなっているか」を書く。**
コードを読めば分かることは書かない。以下は書く価値がある。

- 数値の根拠（なぜ 1600px なのか、なぜ 50MP なのか）
- 採らなかった選択肢とその理由（なぜ WASM を経由しないのか）
- 仕様書への参照（`kirily-design.md §17`）
- ブラウザ固有の落とし穴（Safari の `convertToBlob` の挙動など）

## 7. 終わったら

```bash
bun run fmt        # oxfmt + prettier(.svelte)
bun run lint       # oxlint --type-aware（kirily/* ルール込み）
bun run typecheck  # tsc --build + svelte-check
bun test           # Small/Medium
```

`bun run check` が全部まとめて走る。lefthook が staged ファイルに対して
コミット時に走るので、規約違反はコミットできない。

最後に自分の diff を読み返して問うこと:
**型だけを見て、その値が何を意味し、何が失敗しうるか分かるか。**
分からないなら型がまだ終わっていない。

## リファレンス

- [references/result.md](references/result.md) — `Result` の使い方と境界でのパース
- [references/type-patterns.md](references/type-patterns.md) — 判別可能ユニオン・Branded 型・網羅チェック
- [references/function-di.md](references/function-di.md) — 関数 DI と、クラスを使わないポート/アダプタ
- [references/checklist.md](references/checklist.md) — 書き終えたあとの確認項目
