/**
 * Resampling.
 *
 * A segmentation model takes a fixed, small input (320² or 1024²) while the
 * image the user opened is whatever their camera produced. Both directions of
 * that conversion happen on every run, so they live here as pure functions
 * rather than going through a canvas: `drawImage` is fast but only exists on
 * the main thread, and the AI path has to work inside a Worker.
 *
 * The filter support is scaled with the ratio when shrinking. That is the part
 * a naive bilinear resize gets wrong: it reads 2×2 source pixels no matter how
 * far it is shrinking, so reducing 4000px to 1024px throws away three quarters
 * of the image and aliases whatever detail was there. Widening the support
 * turns the same code into a proper area average.
 */

export type Size = { readonly width: number; readonly height: number }

/**
 * `triangle` is the cheap one — linear interpolation, widened when shrinking.
 * `lanczos3` keeps more detail and is what the reference implementations of
 * these models use, at roughly three times the taps.
 */
export type Kernel = 'triangle' | 'lanczos3'

/** Precomputed taps for one axis, so the second pass does no weight maths. */
type AxisWeights = {
  readonly starts: Int32Array
  readonly counts: Int32Array
  readonly weights: Float32Array
  /** Number of taps reserved per output pixel. */
  readonly stride: number
}

const triangle = (x: number): number => {
  const t = Math.abs(x)
  return t < 1 ? 1 - t : 0
}

const lanczos3 = (x: number): number => {
  const t = Math.abs(x)
  if (t < 1e-6) return 1
  if (t >= 3) return 0
  const pix = Math.PI * t
  return (3 * Math.sin(pix) * Math.sin(pix / 3)) / (pix * pix)
}

const radiusOf = (kernel: Kernel): number => (kernel === 'lanczos3' ? 3 : 1)

const weightOf = (kernel: Kernel, x: number): number =>
  kernel === 'lanczos3' ? lanczos3(x) : triangle(x)

/**
 * Builds the taps for resampling one axis from `from` to `to` samples.
 *
 * Weights are normalised per output pixel, so a flat input stays flat no
 * matter how the support lands against the edges.
 */
export const buildAxisWeights = (from: number, to: number, kernel: Kernel): AxisWeights => {
  const ratio = from / to
  // Shrinking widens the footprint; enlarging keeps the kernel's own width.
  const filterScale = Math.max(1, ratio)
  const support = radiusOf(kernel) * filterScale
  const stride = Math.max(1, Math.ceil(support * 2) + 1)

  const starts = new Int32Array(to)
  const counts = new Int32Array(to)
  const weights = new Float32Array(to * stride)

  for (let i = 0; i < to; i++) {
    const centre = (i + 0.5) * ratio - 0.5
    const first = Math.max(0, Math.ceil(centre - support))
    const last = Math.min(from - 1, Math.floor(centre + support))

    let total = 0
    let count = 0
    for (let j = first; j <= last && count < stride; j++) {
      const weight = weightOf(kernel, (j - centre) / filterScale)
      if (weight === 0 && count === 0 && j < last) continue
      weights[i * stride + count] = weight
      total += weight
      count++
    }

    // The support can miss every sample at an extreme edge; fall back to the
    // nearest one rather than emitting a transparent pixel.
    if (count === 0 || total === 0) {
      starts[i] = Math.min(from - 1, Math.max(0, Math.round(centre)))
      counts[i] = 1
      weights[i * stride] = 1
      continue
    }

    starts[i] = first
    counts[i] = count
    for (let k = 0; k < count; k++) {
      weights[i * stride + k] = (weights[i * stride + k] ?? 0) / total
    }
  }

  return { starts, counts, weights, stride }
}

const clampToByte = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

/**
 * Resamples an RGBA buffer. Separable: one horizontal pass into a scratch
 * buffer, then one vertical pass into `out`.
 */
export const resampleRgba = (
  source: Uint8ClampedArray,
  from: Size,
  to: Size,
  out: Uint8ClampedArray = new Uint8ClampedArray(to.width * to.height * 4),
  kernel: Kernel = 'triangle',
): Uint8ClampedArray => {
  if (from.width === to.width && from.height === to.height) {
    out.set(source)
    return out
  }

  const x = buildAxisWeights(from.width, to.width, kernel)
  const y = buildAxisWeights(from.height, to.height, kernel)

  // Intermediate is float: rounding between the two passes would accumulate.
  const scratch = new Float32Array(to.width * from.height * 4)

  for (let row = 0; row < from.height; row++) {
    const sourceRow = row * from.width * 4
    const targetRow = row * to.width * 4
    for (let column = 0; column < to.width; column++) {
      const start = x.starts[column] ?? 0
      const count = x.counts[column] ?? 0
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < count; k++) {
        const weight = x.weights[column * x.stride + k] ?? 0
        const at = sourceRow + (start + k) * 4
        r += (source[at] ?? 0) * weight
        g += (source[at + 1] ?? 0) * weight
        b += (source[at + 2] ?? 0) * weight
        a += (source[at + 3] ?? 0) * weight
      }
      const to4 = targetRow + column * 4
      scratch[to4] = r
      scratch[to4 + 1] = g
      scratch[to4 + 2] = b
      scratch[to4 + 3] = a
    }
  }

  for (let row = 0; row < to.height; row++) {
    const start = y.starts[row] ?? 0
    const count = y.counts[row] ?? 0
    const targetRow = row * to.width * 4
    for (let column = 0; column < to.width; column++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < count; k++) {
        const weight = y.weights[row * y.stride + k] ?? 0
        const at = ((start + k) * to.width + column) * 4
        r += (scratch[at] ?? 0) * weight
        g += (scratch[at + 1] ?? 0) * weight
        b += (scratch[at + 2] ?? 0) * weight
        a += (scratch[at + 3] ?? 0) * weight
      }
      const to4 = targetRow + column * 4
      out[to4] = clampToByte(Math.round(r))
      out[to4 + 1] = clampToByte(Math.round(g))
      out[to4 + 2] = clampToByte(Math.round(b))
      out[to4 + 3] = clampToByte(Math.round(a))
    }
  }

  return out
}

/**
 * Resamples a single-channel mask with the same machinery.
 *
 * Used for the AI result, which is produced at the model's input size and has
 * to reach the original resolution — the one place where the extra taps of
 * `lanczos3` are worth paying for, because the edge it produces is the edge
 * the user sees.
 */
export const resampleGray = (
  source: Uint8Array,
  from: Size,
  to: Size,
  // Not `ArrayBufferLike`: the mask is transferred out of the AI worker, and a
  // view onto a SharedArrayBuffer cannot be.
  out: Uint8Array<ArrayBuffer> = new Uint8Array(to.width * to.height),
  kernel: Kernel = 'lanczos3',
): Uint8Array<ArrayBuffer> => {
  if (from.width === to.width && from.height === to.height) {
    out.set(source)
    return out
  }

  const x = buildAxisWeights(from.width, to.width, kernel)
  const y = buildAxisWeights(from.height, to.height, kernel)
  const scratch = new Float32Array(to.width * from.height)

  for (let row = 0; row < from.height; row++) {
    const sourceRow = row * from.width
    const targetRow = row * to.width
    for (let column = 0; column < to.width; column++) {
      const start = x.starts[column] ?? 0
      const count = x.counts[column] ?? 0
      let value = 0
      for (let k = 0; k < count; k++) {
        value += (source[sourceRow + start + k] ?? 0) * (x.weights[column * x.stride + k] ?? 0)
      }
      scratch[targetRow + column] = value
    }
  }

  for (let row = 0; row < to.height; row++) {
    const start = y.starts[row] ?? 0
    const count = y.counts[row] ?? 0
    const targetRow = row * to.width
    for (let column = 0; column < to.width; column++) {
      let value = 0
      for (let k = 0; k < count; k++) {
        value +=
          (scratch[(start + k) * to.width + column] ?? 0) * (y.weights[row * y.stride + k] ?? 0)
      }
      out[targetRow + column] = clampToByte(Math.round(value))
    }
  }

  return out
}
