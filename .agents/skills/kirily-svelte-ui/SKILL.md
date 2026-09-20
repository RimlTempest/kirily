---
name: kirily-svelte-ui
description: Kirily の Svelte 5 / UI 規約。.svelte を書く・直す前に読む。runes の使い方、コンポーネントに置いてよいものといけないもの、PC とモバイルで別の操作体系にする方針、Canvas とポインタの扱い、日本語 UI のアクセシビリティ（ロールとアクセシブル名、キーボード、reduced motion、ダークモード）を定義する。「コンポーネントをどう分ける」「state と derived のどちら」「タッチで動かない」「a11y 警告が出た」で発火。
---

# Svelte 5 / UI 規約

`.svelte` の中の TypeScript は oxlint が読めない。つまり
**規約を機械的に守れないのがコンポーネント**。だからここに書く。

## 1. コンポーネントに置いてよいもの

| 置いてよい                         | 置いてはいけない                     |
| ---------------------------------- | ------------------------------------ |
| マークアップとクラス               | マスクのビット演算                   |
| イベントを受けて store を呼ぶこと  | `import { ... } from '@kirily/wasm'` |
| 表示用の `$derived`                | AI プロバイダの直接呼び出し          |
| Canvas の mount / resize / pointer | 座標変換以外の画像処理               |

**判断基準**: そのコードを単体テストしたくなったら、
コンポーネントの外（`$lib/editor/` か `packages/`）に出す。

```text
Toolbar.svelte → editor-store.svelte.ts → editor-core → image-core / wasm
```

この順序を飛ばさない（IMPLEMENTATION.md Rule 5 / Rule 6）。

## 2. runes

```ts
let tool = $state<EditorTool>(EditorTool.BrushRemove);
const busy = $derived(store.status.kind !== 'idle');
const { onfile, disabled = false }: Props = $props();
```

- `$state` は**書き換える値**にだけ。導出値は `$derived`
- 複数行の導出は `$derived.by(() => { ... })`
- `$effect` は「外の世界と同期する」ときだけ（Canvas への描画、
  `ResizeObserver` の登録）。状態の計算に使わない
- `$effect` の戻り値でクリーンアップする（observer の解除）

### ストアはモジュール直下に置かない

`.svelte.ts` のモジュールスコープに `$state` を置くと、
アプリ全体で 1 つになる。Kirily では画像 1 枚ぶんの状態なので、
**ファクトリ関数の中**に置いて、ページがインスタンスを作る。

```ts
export const createEditorStore = (provider = createThresholdProvider()) => {
  let editor = $state<EditorState | null>(null);
  return { get state() { return editor; }, ... };
};
```

### 巨大なバッファは `$state.raw`

`$state` はオブジェクトと配列を深くプロキシする。数 MB のピクセルバッファを
抱えた状態を包むと、読むたびに costs がかかって何も得られない。
**まるごと置き換える値は `$state.raw`。**

```ts
let decoded = $state.raw<DecodedImage | null>(null)
let previewMask = $state.raw(new Uint8Array(0))
let previewVersion = $state(0) // 再描画のトリガはこちら
```

マスクは in-place で書き換え、`version` を上げて再描画させる。
数 MB を毎回比較させない。

### `.svelte.ts` にロジックを置かない

`bun test` は runes を解釈できない。**テストしたいものは runes の外**
（素の `.ts`）へ出し、`.svelte.ts` はそれを繋ぐだけにする。

```
remove-background.ts        AI の手順（引数で依存を受け取る、テストがある）
editor-store.svelte.ts      それを $state に繋ぐだけ
```

プラグインを足せば `.svelte.ts` もテストできるが、そのために
0.0.x のパッケージを依存に足すのは割に合わない（ADR-0009）。

## 3. PC とモバイルは別の操作体系

モバイルは PC の縮小版ではない（kirily-design.md §15、原則 8）。

| PC                          | モバイル                      |
| --------------------------- | ----------------------------- |
| 左ツールバー / 右プロパティ | 下部ツールバー / ボトムシート |
| ホイールでズーム            | ピンチでズーム                |
| ホバーでブラシ位置          | ホバーがない → 常時表示       |
| キーボードショートカット    | Undo/Redo を常に画面に出す    |

同じコンポーネントを Tailwind の `md:` で組み替えてよいが、
**操作の設計は別々に考える**。実装が同じでも、確認は両方で行う。

### タッチで必ずやること

- Canvas に `touch-action: none`（`touch-none`）。付け忘れると
  ブラシを引いた瞬間にページがスクロールする
- Pointer Events を使う（`pointerdown/move/up/cancel`）。
  `mouse*` と `touch*` を別々に書かない
- `setPointerCapture()` で、Canvas の外に出てもストロークが続くようにする
- `pointercancel` を必ず処理する（着信・ジェスチャで飛んでくる）

## 4. アクセシビリティ

`svelte-check --fail-on-warnings` が CI で落ちるので、a11y 警告は残せない。

- **ロールとアクセシブル名で操作できること。** E2E がそれで要素を取る
- アイコンだけのボタンには `<span class="sr-only">` でラベルを付ける
- 装飾の絵文字には `aria-hidden="true"`
- ドロップゾーンは**それ自体を操作手段にしない**。キーボードで押せる
  ボタンを必ず併置する（`<div ondrop>` だけでは到達できない）
- 状態の変化は `aria-live="polite"` で伝える（「きりり中…」）
- トグルは `aria-pressed`
- `:focus-visible` のアウトラインを消さない
- `prefers-reduced-motion` を尊重する（`app.css` に実装済み）
- `prefers-color-scheme: dark` を尊重する。色は `app.css` の
  `@theme` トークン経由で使い、コンポーネントに生の色を書かない

### 日本語 UI の文言

アイコンだけにしない。**アイコン + 補助テキスト**を基本にする
（kirily-design.md §25）。「きりり」は Kirily の言葉だが、
それだけでは何が起きるか分からない。

```text
✨ 背景をきりり     ← 何が起きるか分かる
🪄 きりり           ← 分からない
```

処理中「きりり中…」、完了「きりりっと完成！」。
エラーはふざけない（`userMessage()` の文言を使う）。

## 5. スタイル

Tailwind v4。色・角丸・フォントは `app.css` の `@theme` で定義したトークンを
使う。`text-ink` / `bg-surface-raised` / `border-line` のように名前で使い、
`#171717` のような生の値をコンポーネントに書かない。
ダークモード対応が 1 か所で済まなくなる。

透過の表現は `checkerboard` ユーティリティ。
CSS ピクセル基準にしてあるので、画像のズームに追従しない（意図的）。

## 6. 確認

```bash
bun run --filter '@kirily/web' check   # svelte-check（型 + a11y）
bun run e2e                            # desktop + mobile
bun run dev                            # 実機で触る
```

**実機で触ること。** 特に iOS Safari。
`OffscreenCanvas`・`convertToBlob`・Pointer Events の挙動が他と違う。
E2E の `mobile` プロジェクトは Chromium なので、Safari は自動では回っていない
（`kirily-tdd` の「iOS Safari」節）。
