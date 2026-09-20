/**
 * Guided-filter mask refinement — the TypeScript mirror of
 * `crates/kirily-raster/src/guided.rs`.
 *
 * A segmentation model works at a fixed small input and its mask has to be
 * blown up to whatever the user opened. However good the resampling, the edge
 * it produces is the model's edge at the model's resolution: near the
 * subject's outline rather than on it.
 *
 * The guided filter (He, Sun & Tang, 2010) filters the mask *under the
 * guidance of the original image*, so the output is a local linear function of
 * the guide and snaps to whatever edges the guide has. The paper calls this
 * "guided feathering". This is the fast variant (He & Sun, 2015): the window
 * statistics are computed on a subsampled pair, which costs O(n / s²) with no
 * visible difference.
 *
 * It is a local linear model, not a second segmentation: it sharpens an edge
 * and pulls it onto the image's, but will not move a mask that is wrong by
 * more than its window.
 *
 * Two guard rails matter more than any parameter, because without them the
 * filter *will* re-segment. On an image whose subject contains something as
 * bright as the background — a white highlight in dark hair on a white
 * backdrop — "bright" locally means "background", and a confident foreground
 * region gets dragged to transparent:
 *
 *   - the window only reaches as far as an edge correction needs
 *     (`refineRadiusFor`), so it cannot see from the outline into the interior;
 *   - and it only applies where the mask is already undecided, so a region the
 *     model called flatly opaque keeps its value.
 */

export type RefineOptions = {
  /** Window radius, in pixels of the full-resolution image. */
  readonly radius: number
  /**
   * Regularisation. Small values follow the guide closely and also follow its
   * noise; large values smooth the mask and ignore weak edges.
   */
  readonly epsilon: number
  /** Statistics are computed at 1/subsample resolution. 1 disables it. */
  readonly subsample: number
  /**
   * How much the mask must vary locally before the filter may touch it, as a
   * variance of alpha in 0..1. Flat regions keep their value: the model was
   * sure, and the guide is not evidence about what the subject is.
   */
  readonly minVariance: number
}

/**
 * The filter's reach, in pixels, for an image of this size.
 *
 * This is the parameter that decides whether the result is an edge correction
 * or a re-segmentation. It has to span the gap between the model's edge and
 * the real one — which grows with the image, since the model always works at
 * 1024² — and stay small enough that it cannot reach from the outline into the
 * subject. Half a percent of the long edge holds both: 6 px on a 1254 px
 * image, 20 px on a 4000 px one.
 */
export const refineRadiusFor = (size: {
  readonly width: number
  readonly height: number
}): number => Math.max(4, Math.round(Math.max(size.width, size.height) / 200))

/** A baseline for a ~1600 px image. Callers that know the size should scale it. */
export const DEFAULT_REFINE: RefineOptions = {
  radius: 8,
  epsilon: 1e-4,
  // A standard deviation of 2% of full alpha — about 5 levels: enough to
  // exclude a region the model called flatly opaque while still covering every
  // real transition.
  minVariance: 4e-4,
  subsample: 4,
}

export const refineMask = (
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  size: { readonly width: number; readonly height: number },
  options: RefineOptions = DEFAULT_REFINE,
): Uint8Array => {
  const { width, height } = size
  const pixels = width * height
  if (mask.length !== pixels || rgba.length !== pixels * 4 || options.radius <= 0) return mask

  const step = Math.max(1, Math.round(options.subsample))
  const smallWidth = Math.ceil(width / step)
  const smallHeight = Math.ceil(height / step)
  const small = smallWidth * smallHeight

  const guide = new Float32Array(small)
  const source = new Float32Array(small)
  for (let y = 0; y < smallHeight; y++) {
    for (let x = 0; x < smallWidth; x++) {
      const at = Math.min(height - 1, y * step) * width + Math.min(width - 1, x * step)
      guide[y * smallWidth + x] = luminance(rgba, at)
      source[y * smallWidth + x] = (mask[at] ?? 0) / 255
    }
  }

  const radius = Math.max(1, Math.floor(options.radius / step))
  const meanGuide = boxBlur(guide, smallWidth, smallHeight, radius)
  const meanSource = boxBlur(source, smallWidth, smallHeight, radius)

  const squares = new Float32Array(small)
  const cross = new Float32Array(small)
  const sourceSquares = new Float32Array(small)
  for (let i = 0; i < small; i++) {
    const g = guide[i] ?? 0
    const p = source[i] ?? 0
    squares[i] = g * g
    cross[i] = g * p
    sourceSquares[i] = p * p
  }
  const meanSquares = boxBlur(squares, smallWidth, smallHeight, radius)
  const meanCross = boxBlur(cross, smallWidth, smallHeight, radius)
  const meanSourceSquares = boxBlur(sourceSquares, smallWidth, smallHeight, radius)

  // a = cov(I, p) / (var(I) + eps), b = mean(p) − a · mean(I)
  const slope = new Float32Array(small)
  const offset = new Float32Array(small)
  const gate = new Float32Array(small)
  for (let i = 0; i < small; i++) {
    const mg = meanGuide[i] ?? 0
    const mp = meanSource[i] ?? 0
    const variance = (meanSquares[i] ?? 0) - mg * mg
    const covariance = (meanCross[i] ?? 0) - mg * mp
    const a = covariance / (variance + options.epsilon)
    slope[i] = a
    offset[i] = mp - a * mg

    const sourceVariance = Math.max(0, (meanSourceSquares[i] ?? 0) - mp * mp)
    // Ramps in over one more threshold's worth, so the gate itself does not
    // become a visible boundary.
    gate[i] =
      options.minVariance <= 0
        ? 1
        : Math.min(1, Math.max(0, sourceVariance / options.minVariance - 1))
  }

  const meanSlope = boxBlur(slope, smallWidth, smallHeight, radius)
  const meanOffset = boxBlur(offset, smallWidth, smallHeight, radius)
  const meanGate = boxBlur(gate, smallWidth, smallHeight, radius)

  // q = mean(a) · I + mean(b). The guide is read at full resolution here,
  // which is what puts the refined edge on the real one.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x
      const fx = x / step
      const fy = y / step
      const a = sampleBilinear(meanSlope, smallWidth, smallHeight, fx, fy)
      const b = sampleBilinear(meanOffset, smallWidth, smallHeight, fx, fy)
      const blend = sampleBilinear(meanGate, smallWidth, smallHeight, fx, fy)
      const refined = a * luminance(rgba, at) + b
      const original = (mask[at] ?? 0) / 255
      mask[at] = toByte(original + (refined - original) * blend)
    }
  }

  return mask
}

/** Rec. 709: the mask follows perceived edges, so use perceived brightness. */
const luminance = (rgba: Uint8ClampedArray, pixel: number): number => {
  const at = pixel * 4
  return (
    (0.2126 * (rgba[at] ?? 0) + 0.7152 * (rgba[at + 1] ?? 0) + 0.0722 * (rgba[at + 2] ?? 0)) / 255
  )
}

const toByte = (value: number): number => {
  const scaled = Math.round(value * 255)
  return scaled < 0 ? 0 : scaled > 255 ? 255 : scaled
}

/** Separable box blur with a running sum: O(1) per pixel whatever the radius. */
const boxBlur = (
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array => {
  const horizontal = new Float32Array(source.length)
  const windowSize = radius * 2 + 1

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += source[row + x] ?? 0
    // Edges are clamped, so the leading samples repeat the first pixel.
    sum += (source[row] ?? 0) * Math.min(radius, width)

    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / windowSize
      const leaving = Math.max(0, x - radius)
      const entering = Math.min(width - 1, x + radius + 1)
      sum += (source[row + entering] ?? 0) - (source[row + leaving] ?? 0)
    }
  }

  const vertical = new Float32Array(source.length)
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = 0; y <= Math.min(radius, height - 1); y++) sum += horizontal[y * width + x] ?? 0
    sum += (horizontal[x] ?? 0) * Math.min(radius, height)

    for (let y = 0; y < height; y++) {
      vertical[y * width + x] = sum / windowSize
      const leaving = Math.max(0, y - radius)
      const entering = Math.min(height - 1, y + radius + 1)
      sum += (horizontal[entering * width + x] ?? 0) - (horizontal[leaving * width + x] ?? 0)
    }
  }

  return vertical
}

const sampleBilinear = (
  source: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number => {
  const cx = Math.min(width - 1, Math.max(0, x))
  const cy = Math.min(height - 1, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0

  const top = (source[y0 * width + x0] ?? 0) * (1 - fx) + (source[y0 * width + x1] ?? 0) * fx
  const bottom = (source[y1 * width + x0] ?? 0) * (1 - fx) + (source[y1 * width + x1] ?? 0) * fx
  return top * (1 - fy) + bottom * fy
}
