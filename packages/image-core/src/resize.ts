/**
 * RGBA resampling.
 *
 * A segmentation model takes a fixed, small input (320² or 1024²) while the
 * image the user opened is whatever their camera produced. Both directions of
 * that conversion happen on every run, so they live here as pure functions
 * rather than going through a canvas: `drawImage` is fast but only exists on
 * the main thread, and the AI path has to work inside a Worker.
 */

export type Size = { readonly width: number; readonly height: number }

/**
 * Bilinear resample of an RGBA buffer.
 *
 * Nearest-neighbour would be cheaper, but the model's input is where detail is
 * lost for good — aliasing here shows up as a ragged mask later.
 */
export const resampleRgba = (
  source: Uint8ClampedArray,
  from: Size,
  to: Size,
  out: Uint8ClampedArray = new Uint8ClampedArray(to.width * to.height * 4),
): Uint8ClampedArray => {
  if (from.width === to.width && from.height === to.height) {
    out.set(source)
    return out
  }

  const xRatio = from.width / to.width
  const yRatio = from.height / to.height

  for (let y = 0; y < to.height; y++) {
    const sourceY = Math.min(from.height - 1, Math.max(0, (y + 0.5) * yRatio - 0.5))
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(from.height - 1, y0 + 1)
    const wy = sourceY - y0

    for (let x = 0; x < to.width; x++) {
      const sourceX = Math.min(from.width - 1, Math.max(0, (x + 0.5) * xRatio - 0.5))
      const x0 = Math.floor(sourceX)
      const x1 = Math.min(from.width - 1, x0 + 1)
      const wx = sourceX - x0

      const topLeft = (y0 * from.width + x0) * 4
      const topRight = (y0 * from.width + x1) * 4
      const bottomLeft = (y1 * from.width + x0) * 4
      const bottomRight = (y1 * from.width + x1) * 4
      const target = (y * to.width + x) * 4

      for (let channel = 0; channel < 4; channel++) {
        const top = lerp(source[topLeft + channel] ?? 0, source[topRight + channel] ?? 0, wx)
        const bottom = lerp(
          source[bottomLeft + channel] ?? 0,
          source[bottomRight + channel] ?? 0,
          wx,
        )
        out[target + channel] = Math.round(lerp(top, bottom, wy))
      }
    }
  }
  return out
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
