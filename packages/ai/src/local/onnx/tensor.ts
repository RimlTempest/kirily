/**
 * Turning pixels into a tensor and back.
 *
 * Both directions are pure and unit-tested, because a mistake here does not
 * crash — it produces a plausible-looking but wrong mask, which is the most
 * expensive kind of bug to find by staring at output images.
 */
import { solidifyInterior } from '@kirily/image-core/mask'
import { resampleRgba } from '@kirily/image-core/resize'
import type { ModelSpec } from './model-spec.ts'

export type Size = { readonly width: number; readonly height: number }

/**
 * RGBA at any size → NCHW Float32, normalised, at the model's input size.
 *
 * Channels end up planar (all R, then all G, then all B), which is what every
 * vision model in this family expects and is not what an image buffer looks
 * like — hence the transpose rather than a straight copy.
 */
export const toInputTensor = (
  rgba: Uint8ClampedArray,
  from: Size,
  spec: ModelSpec,
  out: Float32Array = new Float32Array(3 * spec.inputSize * spec.inputSize),
): Float32Array => {
  const size = spec.inputSize
  const resized = resampleRgba(rgba, from, { width: size, height: size })
  const plane = size * size
  const [meanR, meanG, meanB] = spec.mean
  const [stdR, stdG, stdB] = spec.std

  for (let i = 0; i < plane; i++) {
    const at = i * 4
    out[i] = ((resized[at] ?? 0) / 255 - meanR) / stdR
    out[plane + i] = ((resized[at + 1] ?? 0) / 255 - meanG) / stdG
    out[plane * 2 + i] = ((resized[at + 2] ?? 0) / 255 - meanB) / stdB
  }
  return out
}

/**
 * Model output → an 8-bit alpha mask at the requested size.
 *
 * The output is a single-channel saliency map at the model's input size, so it
 * is turned into probabilities, stretched if the model needs it, and then
 * resampled up to the image the user actually opened.
 */
export const toAlphaMask = (
  output: Float32Array,
  spec: ModelSpec,
  to: Size,
  // Not `ArrayBufferLike`: the mask is transferred out of the worker, and a
  // view onto a SharedArrayBuffer cannot be.
  out: Uint8Array<ArrayBuffer> = new Uint8Array(to.width * to.height),
): Uint8Array<ArrayBuffer> => {
  const size = spec.inputSize
  const plane = size * size
  const probabilities = new Float32Array(plane)

  for (let i = 0; i < plane; i++) {
    const value = output[i] ?? 0
    probabilities[i] = spec.outputActivation === 'sigmoid' ? sigmoid(value) : value
  }

  if (spec.rescaleOutput) rescaleInPlace(probabilities)

  // Go to 8-bit first, then resample: the mask resampler is shared with the
  // rest of the editor, so an edge softened here behaves like every other
  // edge in the pipeline.
  const small = new Uint8Array(plane)
  for (let i = 0; i < plane; i++) {
    small[i] = clampToByte(Math.round((probabilities[i] ?? 0) * 255))
  }

  // Closing the interior happens at the model's own resolution: it is cheaper
  // there, and the edge band it protects is then measured in the same pixels
  // the model reasoned about, whatever the user's image size.
  if (spec.solidifyInterior) solidifyInterior(small, { width: size, height: size })

  return resampleMaskTo(small, size, to, out)
}

const resampleMaskTo = <T extends ArrayBufferLike>(
  source: Uint8Array,
  sourceSize: number,
  to: Size,
  out: Uint8Array<T>,
): Uint8Array<T> => {
  const xRatio = sourceSize / to.width
  const yRatio = sourceSize / to.height

  for (let y = 0; y < to.height; y++) {
    const sourceY = Math.min(sourceSize - 1, Math.max(0, (y + 0.5) * yRatio - 0.5))
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(sourceSize - 1, y0 + 1)
    const wy = sourceY - y0

    for (let x = 0; x < to.width; x++) {
      const sourceX = Math.min(sourceSize - 1, Math.max(0, (x + 0.5) * xRatio - 0.5))
      const x0 = Math.floor(sourceX)
      const x1 = Math.min(sourceSize - 1, x0 + 1)
      const wx = sourceX - x0

      const topLeft = source[y0 * sourceSize + x0] ?? 0
      const topRight = source[y0 * sourceSize + x1] ?? 0
      const bottomLeft = source[y1 * sourceSize + x0] ?? 0
      const bottomRight = source[y1 * sourceSize + x1] ?? 0

      const top = topLeft + (topRight - topLeft) * wx
      const bottom = bottomLeft + (bottomRight - bottomLeft) * wx
      out[y * to.width + x] = clampToByte(Math.round(top + (bottom - top) * wy))
    }
  }
  return out
}

/**
 * Stretches the map to the full 0..1 range. A model that only ever outputs
 * 0.2..0.6 on a low-contrast photo would otherwise produce a subject that is
 * uniformly semi-transparent.
 */
const rescaleInPlace = (values: Float32Array): void => {
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const range = max - min
  // A completely flat output carries no information; leaving it alone keeps
  // "everything is foreground" rather than amplifying rounding noise.
  if (!(range > 1e-6)) return

  for (let i = 0; i < values.length; i++) {
    values[i] = ((values[i] ?? 0) - min) / range
  }
}

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value))

const clampToByte = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)
