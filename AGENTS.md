# Kirily Engineering Guide

Read `CLAUDE.md` first; it points at the skills in `.agents/skills/`, which hold
the full rules. This file is the short version for agents and tools that do not
read skills.

## Principles

1. Original image data is never overwritten.
2. Preview and export are separate pipelines. Export reads the original pixels.
3. Editor state is the source of truth; the canvas is a rendering surface.
4. JPEG is never an intermediate representation.
5. Expensive image processing stays off the main UI thread.
6. Rust/WASM owns the hot pixel loops — with a TypeScript implementation of the
   same behaviour, so a browser without WASM loses speed, never a feature.
7. AI providers are replaceable behind one interface, and return a mask.
8. Browser-first processing. The image does not leave the device without
   explicit consent.

## Banned in TypeScript

`any`, `as` (except `as const`), `!`, `class`, `enum`, default exports outside
config/route/Svelte files. `throw` is banned in `packages/image-core` and
`packages/editor-core`, as are DOM globals. All of this is enforced by
`.oxlintrc.json` and `tools/oxlint-plugin-kirily/`.

## Commands

```bash
bun run dev
bun run check
bun run test
bun run e2e
bun run wasm:build
```

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Svelte 5 runes. Large buffers are not put in `$state`; a `version` counter is.
- Rust: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`.
  No `unwrap` / `expect` / `panic!` outside tests.
- Public package APIs are small, typed, and take their output buffer as a
  parameter when the result is large.
- Do not introduce server-side image processing without an ADR.
