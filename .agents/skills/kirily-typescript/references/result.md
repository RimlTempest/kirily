# Result と境界でのパース

## 形

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

実装は `packages/contract/src/result.ts`。`ok()` / `err()` / `mapResult()` /
`andThen()` / `allOk()` / `assertNever()` がある。

## 使い方

```ts
const decoded = await decodeFile(file, budget);
if (!decoded.ok) {
  // decoded.error は KirilyError。ここで narrow されている
  return fail(decoded.error);
}
// 以降 decoded.value は DecodedImage
```

早期 return で失敗を潰していく。ネストが深くなったら `andThen` を使う。

## なぜ throw ではないのか

- `throw` はシグネチャに現れない。呼び出し側は存在を忘れる。
- 画像処理は「失敗するのが普通」の操作が多い（未対応形式、メモリ不足、
  Safari のエンコーダ差異）。これらは例外ではなく**予期された分岐**。
- `Result` なら、失敗を握り潰したコードが型検査で見つかる。

`throw` を使ってよいのは「起こってはいけないこと」だけ:

```ts
export const assertNever = (value: never): never => {
  throw new Error(`Unreachable case: ${JSON.stringify(value)}`);
};
```

## 境界でパースする

外から来る値は `unknown` で受ける。

```ts
const isWasmModule = (value: unknown): value is WasmModule =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'apply_alpha_mask') === 'function';
```

型ガードは**本当に中身を検査する**こと。`(v): v is T => true` は
`as` を関数で包んだだけで、規約違反。

## エラーコードとユーザー向け文言を分ける

```ts
kirilyError(KirilyErrorCode.ImageTooLarge, '64.2MP');
```

- `code` … ログ・分析に出す。安定した識別子。
- `detail` … 開発者向け。**画像の内容やファイル名を入れない。**
- `userMessage(error)` … 画面に出す日本語。文言を変えてもダッシュボードは壊れない。

新しい失敗を足すときは `KirilyErrorCode` にメンバーを足す。
`MESSAGES` は `Record<KirilyErrorCode, string>` なので、
**文言を書き忘れるとコンパイルエラーになる。**
