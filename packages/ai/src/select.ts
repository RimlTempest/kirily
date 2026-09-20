/**
 * Choosing where the AI runs (kirily-design.md §21, IMPLEMENTATION.md §16, §48).
 *
 * Degrading is per capability, not global: a browser without WebGPU still gets
 * WASM inference rather than being pushed to the network. And the last step —
 * sending the image to a server — is never taken on the browser's behalf. It
 * requires the user to have said yes.
 */

export type RuntimeCapabilities = {
  readonly webgpu: boolean
  readonly wasm: boolean
  readonly wasmSimd: boolean
  readonly offscreenCanvas: boolean
  readonly webgl: boolean
}

export const AiBackend = {
  /** Local inference on the GPU. */
  LocalWebGpu: 'local-webgpu',
  /** Local inference on the CPU via WASM. */
  LocalWasm: 'local-wasm',
  /** Server inference. Only ever chosen with explicit consent. */
  Remote: 'remote',
  /** Nothing can run: the UI offers the manual tools instead. */
  Unavailable: 'unavailable',
} as const

export type AiBackend = (typeof AiBackend)[keyof typeof AiBackend]

export const selectAiBackend = (
  capabilities: RuntimeCapabilities,
  consent: { readonly allowsUpload: boolean },
): AiBackend => {
  if (capabilities.webgpu) return AiBackend.LocalWebGpu
  if (capabilities.wasm) return AiBackend.LocalWasm
  if (consent.allowsUpload) return AiBackend.Remote
  return AiBackend.Unavailable
}

/**
 * Reads the capabilities off a global object. Passed in rather than read from
 * `globalThis` so this is testable and so the rest of the package stays free
 * of environment sniffing.
 */
export const detectCapabilities = (global: {
  readonly navigator?: { readonly gpu?: unknown } | undefined
  readonly WebAssembly?: unknown
  readonly OffscreenCanvas?: unknown
  readonly WebGL2RenderingContext?: unknown
}): RuntimeCapabilities => {
  const wasm = global.WebAssembly !== undefined
  return {
    webgpu: global.navigator?.gpu !== undefined,
    wasm,
    // SIMD needs a probe module to detect properly; the conservative answer
    // until that runs is "no", which only costs speed, never correctness.
    wasmSimd: false,
    offscreenCanvas: global.OffscreenCanvas !== undefined,
    webgl: global.WebGL2RenderingContext !== undefined,
  }
}
