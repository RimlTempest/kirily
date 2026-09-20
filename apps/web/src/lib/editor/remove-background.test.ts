import { describe, expect, test } from 'bun:test'
import type { BackgroundRemovalProvider } from '@kirily/ai/provider'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import { err, ok } from '@kirily/contract/result'
import type { ImageEngine } from '@kirily/wasm'
import type { DecodedImage } from './decode.ts'
import type { RemoveBackgroundDeps } from './remove-background.ts'
import { removeBackground } from './remove-background.ts'

const SIZE = 8

const image = (): DecodedImage => ({
  source: {
    width: SIZE,
    height: SIZE,
    mimeType: 'image/png',
    fileName: 'cat.png',
    fileSize: 1,
  },
  rgba: new Uint8ClampedArray(SIZE * SIZE * 4).fill(255),
  preview: {
    width: SIZE / 2,
    height: SIZE / 2,
    rgba: new Uint8ClampedArray((SIZE / 2) * (SIZE / 2) * 4).fill(255),
  },
})

const provider = (
  overrides: Partial<BackgroundRemovalProvider> = {},
  id = 'test-model',
): BackgroundRemovalProvider => ({
  info: { id, label: 'test', requiresUpload: false },
  initialize: async (onProgress) => {
    onProgress?.(0.5)
    onProgress?.(1)
    return ok(undefined)
  },
  removeBackground: async () =>
    ok({ width: SIZE, height: SIZE, alpha: new Uint8Array(SIZE * SIZE).fill(200) }),
  ...overrides,
})

const engine = (refine: ImageEngine['refineMask']): ImageEngine => ({
  backend: 'typescript',
  applyAlphaMask: () => ok(undefined),
  flattenOnto: () => ok(undefined),
  cropRgba: () => ok(undefined),
  refineMask: refine,
})

const deps = (overrides: Partial<RemoveBackgroundDeps> = {}): RemoveBackgroundDeps => ({
  provider: provider(),
  engine: async () => engine(() => ok(undefined)),
  onLoadProgress: () => {},
  onInferenceStart: () => {},
  ...overrides,
})

describe('removeBackground', () => {
  test('returns the mask the provider produced', async () => {
    const result = await removeBackground(deps(), image())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.alpha.length).toBe(SIZE * SIZE)
    expect(result.value.refined).toBe(true)
  })

  test('reports load progress before inference starts', async () => {
    const order: string[] = []
    await removeBackground(
      deps({
        onLoadProgress: (value) => order.push(`load:${value}`),
        onInferenceStart: () => order.push('inference'),
      }),
      image(),
    )

    expect(order).toEqual(['load:0.5', 'load:1', 'inference'])
  })

  test('feeds the model the original pixels, not the preview', async () => {
    // A list, not a nullable: TypeScript cannot see that the callback runs,
    // so a `let x = null` would narrow to `null` and make the assertion moot.
    const seen: { width: number; height: number }[] = []
    await removeBackground(
      deps({
        provider: provider({
          removeBackground: async (input) => {
            seen.push({ width: input.width, height: input.height })
            return ok({ width: SIZE, height: SIZE, alpha: new Uint8Array(SIZE * SIZE) })
          },
        }),
      }),
      image(),
    )

    expect(seen).toEqual([{ width: SIZE, height: SIZE }])
  })

  test('refines the mask against the original image', async () => {
    const guided: { mask: number; width: number }[] = []
    await removeBackground(
      deps({
        engine: async () =>
          engine((_rgba, mask, size) => {
            guided.push({ mask: mask.length, width: size.width })
            return ok(undefined)
          }),
      }),
      image(),
    )

    expect(guided).toEqual([{ mask: SIZE * SIZE, width: SIZE }])
  })

  test('keeps the mask when refinement fails', async () => {
    const skipped: string[] = []
    const result = await removeBackground(
      deps({
        engine: async () => engine(() => err(kirilyError(KirilyErrorCode.WasmFailed, 'no wasm'))),
        onRefineSkipped: (error) => skipped.push(error.code),
      }),
      image(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.refined).toBe(false)
    expect(result.value.alpha.length).toBe(SIZE * SIZE)
    expect(skipped).toEqual([KirilyErrorCode.WasmFailed])
  })

  test('fails when the model cannot load', async () => {
    const result = await removeBackground(
      deps({
        provider: provider({
          initialize: async () => err(kirilyError(KirilyErrorCode.AiInitializationFailed, '404')),
        }),
      }),
      image(),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(KirilyErrorCode.AiInitializationFailed)
  })

  test('does not start inference when loading failed', async () => {
    let started = false
    await removeBackground(
      deps({
        provider: provider({
          initialize: async () => err(kirilyError(KirilyErrorCode.AiInitializationFailed)),
        }),
        onInferenceStart: () => {
          started = true
        },
      }),
      image(),
    )

    expect(started).toBe(false)
  })

  test('fails when inference fails', async () => {
    const result = await removeBackground(
      deps({
        provider: provider({
          removeBackground: async () =>
            err(kirilyError(KirilyErrorCode.AiInferenceFailed, 'out of memory')),
        }),
      }),
      image(),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(KirilyErrorCode.AiInferenceFailed)
  })

  test('reports which provider actually ran, so a step-down is visible', async () => {
    const result = await removeBackground(deps({ provider: provider({}, 'u2netp') }), image())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.providerId).toBe('u2netp')
  })

  test('does not load the WASM engine before a mask exists', async () => {
    let loaded = 0
    await removeBackground(
      deps({
        provider: provider({
          initialize: async () => err(kirilyError(KirilyErrorCode.AiInitializationFailed)),
        }),
        engine: async () => {
          loaded += 1
          return engine(() => ok(undefined))
        },
      }),
      image(),
    )

    expect(loaded).toBe(0)
  })
})
