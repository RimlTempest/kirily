import { describe, expect, test } from 'bun:test'
import { createTypescriptEngine, loadImageEngine } from './index.ts'

const noop = (): void => {}

describe('loadImageEngine', () => {
  test('falls back to TypeScript when the WASM module fails to load', async () => {
    const engine = await loadImageEngine(async () => {
      throw new Error('no WebAssembly here')
    })
    expect(engine.backend).toBe('typescript')
  })

  test('falls back when the module loads but is not the engine we expect', async () => {
    const engine = await loadImageEngine(async () => ({ somethingElse: true }))
    expect(engine.backend).toBe('typescript')
  })

  test('uses WASM when every expected export is present', async () => {
    const engine = await loadImageEngine(async () => ({
      apply_alpha_mask: noop,
      flatten_onto: noop,
      decontaminate_edges: noop,
      feather_mask: noop,
    }))
    expect(engine.backend).toBe('wasm')
  })

  test('the fallback engine produces the same result as the pure functions', () => {
    const engine = createTypescriptEngine()
    const rgba = new Uint8ClampedArray([1, 2, 3, 255])
    const result = engine.applyAlphaMask(rgba, new Uint8Array([64]), { width: 1, height: 1 })
    expect(result.ok).toBe(true)
    expect(rgba[3]).toBe(64)
  })
})
