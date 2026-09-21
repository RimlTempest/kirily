/**
 * A separable box blur with clamped edges.
 *
 * Shared rather than copied: the guided filter needs one for its statistics
 * and the edge adjustment needs one to find where the boundary is, and the
 * padding at the borders is the kind of detail that goes wrong in one copy and
 * not the other — it did, once, in both this and the Rust mirror (ADR-0019).
 *
 * The Rust side keeps its own in `kirily-raster::guided`, because that is the
 * only place over there that needs it.
 */
export const boxBlur = (
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
    // Edges are clamped: the window at x = 0 reads `radius` repeats of the
    // first pixel, then the pixels from 0 to radius — themselves clamped,
    // which is what a row shorter than the window needs.
    for (let x = 0; x <= radius; x++) sum += source[row + Math.min(width - 1, x)] ?? 0
    sum += (source[row] ?? 0) * radius

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
    for (let y = 0; y <= radius; y++) {
      sum += horizontal[Math.min(height - 1, y) * width + x] ?? 0
    }
    sum += (horizontal[x] ?? 0) * radius

    for (let y = 0; y < height; y++) {
      vertical[y * width + x] = sum / windowSize
      const leaving = Math.max(0, y - radius)
      const entering = Math.min(height - 1, y + radius + 1)
      sum += (horizontal[entering * width + x] ?? 0) - (horizontal[leaving * width + x] ?? 0)
    }
  }

  return vertical
}
