/**
 * The only module that knows Rust exists.
 *
 * The app and the editor call these functions; whether they end up in WASM or
 * in the TypeScript fallback is decided here. A browser without WASM loses
 * speed, never a feature (kirily-design.md §24).
 *
 * The generated bindings in `pkg/` are build output and are not committed —
 * run `bun run wasm:build` to produce them (IMPLEMENTATION.md §22).
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Rect } from '@kirily/contract/geometry'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { Rgb } from '@kirily/image-core/composite'
import * as fallback from '@kirily/image-core/composite'
import type { RefineOptions } from '@kirily/image-core/guided'
import { DEFAULT_REFINE, refineMask } from '@kirily/image-core/guided'

type WasmModule = {
  readonly apply_alpha_mask: (
    rgba: Uint8Array,
    mask: Uint8Array,
    width: number,
    height: number,
  ) => void
  readonly flatten_onto: (
    rgba: Uint8Array,
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
  ) => void
  readonly decontaminate_edges: (
    rgba: Uint8Array,
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
  ) => void
  readonly feather_mask: (mask: Uint8Array, width: number, height: number, radius: number) => void
  readonly refine_mask: (
    rgba: Uint8Array,
    mask: Uint8Array,
    width: number,
    height: number,
    radius: number,
    epsilon: number,
    subsample: number,
    min_variance: number,
  ) => void
}

export type ImageEngine = {
  /** 'wasm' or 'typescript' — surfaced so the UI can report what it is using. */
  readonly backend: 'wasm' | 'typescript'
  readonly applyAlphaMask: (
    rgba: Uint8ClampedArray,
    mask: Uint8Array,
    size: { readonly width: number; readonly height: number },
  ) => Result<void, KirilyError>
  readonly flattenOnto: (
    rgba: Uint8ClampedArray,
    size: { readonly width: number; readonly height: number },
    background: Rgb,
  ) => Result<void, KirilyError>
  readonly cropRgba: (
    rgba: Uint8ClampedArray,
    size: { readonly width: number; readonly height: number },
    rect: Rect,
    out: Uint8ClampedArray,
  ) => Result<void, KirilyError>
  /**
   * Pulls the mask's edges onto the image's. Mutates `mask` in place, at full
   * resolution, using the original pixels as the guide.
   */
  readonly refineMask: (
    rgba: Uint8ClampedArray,
    mask: Uint8Array,
    size: { readonly width: number; readonly height: number },
    options?: RefineOptions,
  ) => Result<void, KirilyError>
}

/**
 * WASM takes `&mut [u8]`, which wasm-bindgen maps to `Uint8Array`. A canvas
 * gives us `Uint8ClampedArray`; the two share a buffer, so this is a view, not
 * a copy.
 */
const asBytes = (rgba: Uint8ClampedArray): Uint8Array =>
  new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)

const wrap = <T>(run: () => T): Result<T, KirilyError> => {
  try {
    return ok(run())
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown'
    return err(kirilyError(KirilyErrorCode.WasmFailed, detail))
  }
}

const typescriptEngine: ImageEngine = {
  backend: 'typescript',
  applyAlphaMask: fallback.applyAlphaMask,
  flattenOnto: fallback.flattenOnto,
  cropRgba: fallback.cropRgba,
  refineMask: (rgba, mask, size, options = DEFAULT_REFINE) =>
    wrap(() => {
      refineMask(rgba, mask, size, options)
    }),
}

const wasmEngine = (module: WasmModule): ImageEngine => ({
  backend: 'wasm',
  applyAlphaMask: (rgba, mask, size) =>
    wrap(() => module.apply_alpha_mask(asBytes(rgba), mask, size.width, size.height)),
  flattenOnto: (rgba, size, background) =>
    wrap(() =>
      module.flatten_onto(
        asBytes(rgba),
        size.width,
        size.height,
        background.r,
        background.g,
        background.b,
      ),
    ),
  // Cropping is a row-wise memcpy; `Uint8ClampedArray.set` already does that
  // at native speed, and going through WASM would copy the buffer twice.
  cropRgba: fallback.cropRgba,
  refineMask: (rgba, mask, size, options = DEFAULT_REFINE) =>
    wrap(() =>
      module.refine_mask(
        asBytes(rgba),
        mask,
        size.width,
        size.height,
        options.radius,
        options.epsilon,
        options.subsample,
        options.minVariance,
      ),
    ),
})

/**
 * Loads the WASM engine, falling back to TypeScript when it is unavailable.
 *
 * The import is dynamic on purpose: the fallback path must not pull a WASM
 * binary into the bundle of a browser that cannot run it.
 */
export const loadImageEngine = async (
  load: () => Promise<unknown> = () => import('../pkg/kirily_wasm.js'),
): Promise<ImageEngine> => {
  try {
    const loaded = await load()
    if (!isWasmModule(loaded)) return typescriptEngine

    // wasm-pack's `--target web` output exports the functions immediately but
    // they throw until the default export has instantiated the module. Without
    // this await, every call fails and the engine silently reports an error
    // instead of falling back.
    const init = Reflect.get(loaded, 'default')
    if (typeof init === 'function') await init()

    return wasmEngine(loaded)
  } catch {
    return typescriptEngine
  }
}

export const createTypescriptEngine = (): ImageEngine => typescriptEngine

const isWasmModule = (value: unknown): value is WasmModule =>
  typeof value === 'object'
  && value !== null
  && typeof Reflect.get(value, 'apply_alpha_mask') === 'function'
  && typeof Reflect.get(value, 'flatten_onto') === 'function'
  && typeof Reflect.get(value, 'decontaminate_edges') === 'function'
  && typeof Reflect.get(value, 'feather_mask') === 'function'
  && typeof Reflect.get(value, 'refine_mask') === 'function'
