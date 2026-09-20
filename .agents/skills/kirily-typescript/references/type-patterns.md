# 型パターン

## 判別可能ユニオン

状態が複数あって、組み合わせに意味がないときに使う。

```ts
export type EditorStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'decoding' }
  | { readonly kind: 'ai-loading'; readonly progress: number }
  | { readonly kind: 'ai-processing' }
  | { readonly kind: 'exporting' }
  | { readonly kind: 'error'; readonly error: KirilyError };
```

`progress` は `ai-loading` のときだけ存在する。
`{ isLoading: boolean; progress?: number }` だと
「読み込んでいないのに progress がある」が表現できてしまう。

### 網羅チェックで閉じる

```ts
switch (command.kind) {
  case 'brush-stroke':
    return layerFor(layers, command.mode);
  case 'replace-base-mask':
    return layers.base;
  case 'set-crop':
    return null;
  default:
    return assertNever(command);
}
```

`default` に `assertNever` を置くと、ユニオンにメンバーを足したときに
**対応漏れの箇所が全部コンパイルエラーになる**。
これが Kirily の拡張方式。「触らなくても動く」ではなく
「触らないとビルドが通らない」を選ぶ。

## `as const` + 値のユニオン

実行時にも名前が要る有限集合。

```ts
export const BrushMode = { Keep: 'keep', Remove: 'remove' } as const;
export type BrushMode = (typeof BrushMode)[keyof typeof BrushMode];
```

型と値を同名で export してよい（TypeScript は別の名前空間で扱う）。

## Branded 型

素の `string` / `number` の取り違えを防ぐ。

```ts
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };
```

`as` が禁止なので、生成点は**型ガードを通したパース関数だけ**になる
（`packages/contract/src/brand.ts` の `makeParser`）。

## タグ付きオブジェクト（座標系）

Branded 型は実行時コストがゼロだが生成に一手間かかる。
座標のように大量に作る値は、素直に 1 フィールド足すほうがよい。

```ts
export type ImagePoint = { readonly space: 'image'; readonly x: number; readonly y: number };
export type ScreenPoint = { readonly space: 'screen'; readonly x: number; readonly y: number };
```

`toImagePoint(screenPoint, viewport)` を通さないと変換できないので、
**ズーム中に座標変換を忘れるバグが型で止まる。**

## Utility / Conditional Types

他の型から導ける型は手で書き写さない。

```ts
type ExportOptions = Pick<ExportRequest, 'format' | 'quality'>;
type EngineReturn = ReturnType<typeof loadImageEngine>;
```

手で書き写した型は、元が変わったときにコンパイラが気づけない DRY 違反。

## 判断表

| 状況                                  | 使うもの              |
| ------------------------------------- | --------------------- |
| 状態が複数、組み合わせに意味がない    | 判別可能ユニオン      |
| 有限集合、実行時にも名前が要る        | `as const` + ユニオン |
| 素の string/number を取り違えたくない | Branded 型            |
| 同じ形で意味が違う値を大量に作る      | タグ付きオブジェクト  |
| 他の型から導ける                      | Utility / Conditional |
