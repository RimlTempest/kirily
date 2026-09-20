/**
 * RGBA compositing — the export path, mirroring `crates/kirily-raster`.
 *
 * Every function writes into a caller-provided buffer. A 4K frame is ~32 MB;
 * returning a fresh array per step is how a tab runs out of memory
 * (IMPLEMENTATION.md §24).
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Rect } from '@kirily/contract/geometry'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'

export type Rgb = { readonly r: number; readonly g: number; readonly b: number }

export const WHITE: Rgb = { r: 255, g: 255, b: 255 }
export const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const sizeMismatch = (expected: number, actual: number): KirilyError =>
  kirilyError(KirilyErrorCode.SizeMismatch, `expected ${expected} bytes, got ${actual}`)

/** Writes the mask into the alpha channel, leaving colour untouched. */
export const applyAlphaMask = (
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  size: { readonly width: number; readonly height: number },
): Result<void, KirilyError> => {
  const pixels = size.width * size.height
  if (rgba.length !== pixels * 4) return err(sizeMismatch(pixels * 4, rgba.length))
  if (mask.length !== pixels) return err(sizeMismatch(pixels, mask.length))

  for (let i = 0; i < pixels; i++) {
    rgba[i * 4 + 3] = mask[i] ?? 0
  }
  return ok(undefined)
}

/** Copies `rect` out of `rgba` into `out`, which must already be the crop's size. */
export const cropRgba = (
  rgba: Uint8ClampedArray,
  size: { readonly width: number; readonly height: number },
  rect: Rect,
  out: Uint8ClampedArray,
): Result<void, KirilyError> => {
  if (rgba.length !== size.width * size.height * 4) {
    return err(sizeMismatch(size.width * size.height * 4, rgba.length))
  }
  const insideImage =
    rect.width > 0
    && rect.height > 0
    && rect.x >= 0
    && rect.y >= 0
    && rect.x + rect.width <= size.width
    && rect.y + rect.height <= size.height
  if (!insideImage) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `crop ${rect.width}x${rect.height} at ${rect.x},${rect.y} leaves the image`,
      ),
    )
  }
  if (out.length !== rect.width * rect.height * 4) {
    return err(sizeMismatch(rect.width * rect.height * 4, out.length))
  }

  const rowBytes = rect.width * 4
  const stride = size.width * 4
  for (let row = 0; row < rect.height; row++) {
    const from = (rect.y + row) * stride + rect.x * 4
    out.set(rgba.subarray(from, from + rowBytes), row * rowBytes)
  }
  return ok(undefined)
}

/**
 * Composites onto an opaque background and clears alpha — the JPEG path.
 * Doing it here rather than letting the encoder guess is what makes
 * "transparent becomes white" a chosen behaviour instead of a surprise.
 */
export const flattenOnto = (
  rgba: Uint8ClampedArray,
  size: { readonly width: number; readonly height: number },
  background: Rgb,
): Result<void, KirilyError> => {
  const pixels = size.width * size.height
  if (rgba.length !== pixels * 4) return err(sizeMismatch(pixels * 4, rgba.length))

  for (let i = 0; i < pixels; i++) {
    const base = i * 4
    const alpha = rgba[base + 3] ?? 255
    if (alpha === 255) continue
    const inverse = 255 - alpha
    rgba[base] = blend(rgba[base] ?? 0, background.r, alpha, inverse)
    rgba[base + 1] = blend(rgba[base + 1] ?? 0, background.g, alpha, inverse)
    rgba[base + 2] = blend(rgba[base + 2] ?? 0, background.b, alpha, inverse)
    rgba[base + 3] = 255
  }
  return ok(undefined)
}

const blend = (foreground: number, background: number, alpha: number, inverse: number): number =>
  Math.floor((foreground * alpha + background * inverse + 127) / 255)
