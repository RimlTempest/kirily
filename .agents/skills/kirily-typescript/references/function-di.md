# 関数 DI とポート/アダプタ

## クラスを使わずに依存を注入する

```ts
export type BackgroundRemovalProvider = {
  readonly info: ProviderInfo;
  readonly initialize: (onProgress?: (value: number) => void) => Promise<Result<void, KirilyError>>;
  readonly removeBackground: (
    input: ImageInput,
  ) => Promise<Result<SegmentationResult, KirilyError>>;
};
```

これが**ポート**。高水準の側（エディタ）が「自分に必要なもの」を宣言している。
実装はこれに合わせる（依存性逆転の原則）。

**アダプタ**はファクトリ関数で作る。

```ts
export const createThresholdProvider = (
  options: ThresholdOptions = DEFAULT_THRESHOLD,
): BackgroundRemovalProvider => ({
  info: { id: 'local-threshold', label: '…', requiresUpload: false },
  initialize: async (onProgress) => {
    onProgress?.(1);
    return ok(undefined);
  },
  removeBackground: async (input) => ok(segmentByBorderColour(input, options)),
});
```

クラスではなく、クロージャを持つオブジェクトを返す。状態が要るなら
ファクトリの中に `let` を置けばよい。継承は使わない（合成する）。

## 使う側

```ts
export const createEditorStore = (
  provider: BackgroundRemovalProvider = createThresholdProvider(),
) => { ... };
```

既定値を置いてよい。ただし**既定値があることと、差し替えられることは両立する**。
テストは差し替える。

```ts
const provider: BackgroundRemovalProvider = {
  info: { id: 'test', label: '', requiresUpload: false },
  initialize: async () => ok(undefined),
  removeBackground: async () => ok({ width: 2, height: 2, alpha: new Uint8Array(4) }),
};
```

モックライブラリは要らない。素のオブジェクトリテラルで済む。

## Deps は狭く保つ

```ts
// ✗ マスクしか触らないのに全部受け取っている
type Deps = { provider: Provider; engine: ImageEngine; now: () => Date };

// ○ 必要なものだけ
type Deps = { readonly now: () => Date };
```

型が「この関数が何に触るか」を正直に語るようにする（インターフェース分離）。

## 副作用は端に寄せる

`fetch` / Canvas / File / `postMessage` は、それを行う層でだけ呼ぶ。
「取ってきて判断する」関数は、テストも再利用もしづらい。分割する。

```text
apps/web/src/lib/editor/decode.ts   … createImageBitmap する（端）
packages/image-core                  … 受け取ったバッファを処理する（純粋）
```

## Kirily での境界一覧

| ポート                      | 定義場所                      | アダプタ例                         |
| --------------------------- | ----------------------------- | ---------------------------------- |
| `BackgroundRemovalProvider` | `packages/ai/src/provider.ts` | ローカル閾値 / ONNX / リモート API |
| `ImageEngine`               | `packages/wasm/src/index.ts`  | WASM / TypeScript フォールバック   |

どちらも「差し替えたらファイルが 1 本増えるだけ」になっていること。
エディタ側を触らないと差し替えられないなら、境界の切り方が間違っている。
