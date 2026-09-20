# ADR-0005: pnpm + Turborepo ではなく Bun + oxc を使う

- 状態: 採用
- 日付: 2026-09-21

## 背景

`IMPLEMENTATION.md §3` は pnpm + Turborepo + Prettier + ESLint + Vitest を
想定している。一方、同じ書き手の既存プロジェクト（qrcc2 / jev_test）は
Bun workspaces + oxlint + oxfmt + lefthook + mise で揃っており、
コーディング規約を機械的に強制する lint プラグインもそちらにある。

## 決定

Bun + oxc に寄せる。

| 役割        | 採用                               | 使わないもの    |
| ----------- | ---------------------------------- | --------------- |
| パッケージ  | Bun workspaces                     | pnpm, Turborepo |
| Lint        | oxlint（`--type-aware`）           | ESLint          |
| Format (TS) | oxfmt                              | Prettier        |
| Format (他) | prettier（`.svelte` `.md` `.css`） | —               |
| Unit test   | `bun test`                         | Vitest          |
| E2E         | Playwright                         | —               |
| Hooks       | lefthook                           | husky           |
| Toolchain   | mise                               | volta, asdf     |

`.svelte` は oxlint も oxfmt も扱えないので、そこだけ prettier と
`svelte-check --fail-on-warnings` が受け持つ。

TypeScript は 5.9 を使う（qrcc2 の 7.0 ではない）。svelte-check が
まだ追いついていないため。追いついたら上げる。

## 結果

- 3 つのリポジトリでコマンド体系と規約が同じになる
- `tools/oxlint-plugin-kirily` が `any` / `as` / `class` / `enum` /
  ドメイン層の `throw` と DOM を機械的に落とす
- Turborepo のタスクキャッシュは無い。ワークスペースが小さいうちは
  `bun run --filter` の直列実行で足りる
- 設計書 §3 / §55 の記述とコマンドがずれる。CLAUDE.md が正

## 代替案

- 設計書どおり pnpm + Turborepo → SvelteKit のエコシステムには素直だが、
  規約の機械強制を別途作り直すことになる
