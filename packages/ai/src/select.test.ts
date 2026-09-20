import { describe, expect, test } from 'bun:test'
import { AiBackend, detectCapabilities, selectAiBackend } from './select.ts'

const none = {
  webgpu: false,
  wasm: false,
  wasmSimd: false,
  offscreenCanvas: false,
  webgl: false,
}

describe('selectAiBackend', () => {
  test('prefers the GPU when it is there', () => {
    expect(selectAiBackend({ ...none, webgpu: true, wasm: true }, { allowsUpload: true })).toBe(
      AiBackend.LocalWebGpu,
    )
  })

  test('falls back to WASM rather than to the network', () => {
    expect(selectAiBackend({ ...none, wasm: true }, { allowsUpload: true })).toBe(
      AiBackend.LocalWasm,
    )
  })

  test('never uploads without consent, even with nothing else available', () => {
    expect(selectAiBackend(none, { allowsUpload: false })).toBe(AiBackend.Unavailable)
  })

  test('uses the server only when the user agreed to it', () => {
    expect(selectAiBackend(none, { allowsUpload: true })).toBe(AiBackend.Remote)
  })
})

describe('detectCapabilities', () => {
  test('reports nothing on a bare object', () => {
    expect(detectCapabilities({})).toEqual(none)
  })

  test('sees WebGPU through navigator.gpu', () => {
    expect(detectCapabilities({ navigator: { gpu: {} } }).webgpu).toBe(true)
  })
})
