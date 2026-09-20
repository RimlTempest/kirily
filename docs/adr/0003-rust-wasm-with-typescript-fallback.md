# ADR-0003: ピクセル処理は Rust/WASM と TypeScript の両方で実装する

- 状態: 採用
- 日付: 2026-09-21

## 背景

`kirily-design.md §11` はホットループを Rust/WASM へ移すとしている。
一方 §24 は、WASM が使えない環境へ段階的に劣化することを求めている。

WASM だけで実装すると、WASM が読めない環境で
「背景は消せるがブラシが効かない」のような中途半端な状態になる。

## 決定

`kirily-mask` / `kirily-raster`（Rust）と `packages/image-core`（TypeScript）に
**同じ振る舞いを実装する**。`packages/wasm` の `loadImageEngine()` が、
WASM が読めれば WASM を、駄目なら TypeScript を返す。

同じ入出力のテストを両方に置き、片方だけ直したら落ちるようにする。

crop は例外で、WASM 版を用意しない。行単位の memcpy であり
`Uint8ClampedArray.set` がすでに native 速度で行う。WASM を経由すると
バッファを 2 回コピーすることになる。

`crates/kirily-{image,mask,raster}` は wasm-bindgen に依存しない。
普通の `cargo test` で回るようにするため。wasm-bindgen は
`crates/kirily-wasm` だけが持つ。

## 結果

- 同じロジックを 2 回書く（明示的なコスト）
- どのブラウザでも機能が欠けない
- Rust 側のテストが速い（wasm ランナー不要）
- CI の `guard` が依存の混入を検査する

## 代替案

- WASM のみ → 対応ブラウザが狭まる。iOS の古い Safari が落ちる
- TypeScript のみ → 4K のフェザーやモルフォロジで詰まる
