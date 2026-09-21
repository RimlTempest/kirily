/**
 * A coarse map of what colour something is, measured from the image itself.
 *
 * Both halves of the matting equation need one. The background's colour is
 * what `decontaminate` subtracts back out of a soft edge; the foreground's is
 * what `colourMatte` measures the edge against. They differ only in which
 * pixels they are allowed to average, so they are one thing here rather than
 * two implementations that could drift apart.
 *
 * Coarse on purpose. A grid of one colour per cell is 18 KB at 1254² against
 * a second full-resolution buffer, and a background that is a gradient comes
 * out as a gradient rather than as one averaged colour.
 */
export type Size = { readonly width: number; readonly height: number }

/** One colour per `cell`x`cell` square of the image. */
export type ColourField = {
  readonly cell: number
  readonly width: number
  readonly height: number
  /** Three bytes per cell, row major. */
  readonly rgb: Uint8Array
}

/** Which side of the mask a field measures. */
export const FieldSide = {
  Background: 'background',
  Foreground: 'foreground',
} as const

export type FieldSide = (typeof FieldSide)[keyof typeof FieldSide]

export type FieldOptions = {
  readonly side: FieldSide
  /** Cell size in image pixels. */
  readonly cell: number
  /**
   * How sure the mask has to be before a pixel may contribute. Alpha at or
   * below this is background; at or above `255 - this` is foreground.
   */
  readonly confidence: number
}

/**
 * Coarse enough that a cell almost always contains some background, fine
 * enough to follow a sky. At 1254² this is a 40x40 grid.
 */
export const BACKGROUND_FIELD: FieldOptions = {
  side: FieldSide.Background,
  cell: 32,
  confidence: 24,
}

/**
 * Finer than the background's. The background of a photograph changes slowly;
 * the subject right at its edge does not — hair, skin and a collar can meet
 * within a few pixels, and averaging them together would measure a colour that
 * is nowhere in the picture.
 */
export const FOREGROUND_FIELD: FieldOptions = {
  side: FieldSide.Foreground,
  cell: 8,
  confidence: 24,
}

/** Nothing in the image qualified: better a neutral than a black rim. */
const NEUTRAL = 128

export const estimateField = (
  rgba: Uint8ClampedArray,
  size: Size,
  mask: Uint8Array,
  options: FieldOptions,
): ColourField => {
  const { cell } = options
  const across = Math.max(1, Math.ceil(size.width / cell))
  const down = Math.max(1, Math.ceil(size.height / cell))
  const totals = new Float64Array(across * down * 3)
  const counts = new Uint32Array(across * down)

  const wanted =
    options.side === FieldSide.Background
      ? (alpha: number): boolean => alpha <= options.confidence
      : (alpha: number): boolean => alpha >= 255 - options.confidence

  for (let y = 0; y < size.height; y += 1) {
    const row = Math.min(down - 1, Math.floor(y / cell))
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x
      if (!wanted(mask[index] ?? 0)) continue
      const at = row * across + Math.min(across - 1, Math.floor(x / cell))
      counts[at] = (counts[at] ?? 0) + 1
      for (let c = 0; c < 3; c += 1) {
        totals[at * 3 + c] = (totals[at * 3 + c] ?? 0) + (rgba[index * 4 + c] ?? 0)
      }
    }
  }

  const rgb = new Uint8Array(across * down * 3)
  const known = new Uint8Array(across * down)
  const queue = new Int32Array(across * down)
  let tail = 0
  for (let i = 0; i < across * down; i += 1) {
    const count = counts[i] ?? 0
    if (count === 0) continue
    known[i] = 1
    queue[tail++] = i
    for (let c = 0; c < 3; c += 1) {
      rgb[i * 3 + c] = Math.round((totals[i * 3 + c] ?? 0) / count)
    }
  }

  if (tail === 0) {
    rgb.fill(NEUTRAL)
    return { cell, width: across, height: down, rgb }
  }

  // A cell that saw nothing of this side copies the nearest cell that did,
  // rather than staying black and painting a rim onto whatever borders it.
  for (let head = 0; head < tail; head += 1) {
    const from = queue[head] ?? 0
    const x = from % across
    const y = (from - x) / across
    const spread = (to: number): void => {
      if (known[to] === 1) return
      known[to] = 1
      rgb.copyWithin(to * 3, from * 3, from * 3 + 3)
      queue[tail++] = to
    }
    if (x > 0) spread(from - 1)
    if (x + 1 < across) spread(from + 1)
    if (y > 0) spread(from - across)
    if (y + 1 < down) spread(from + across)
  }

  return { cell, width: across, height: down, rgb }
}

/** Bilinear between cell centres, holding the edge colour beyond the outermost. */
export const sampleField = (field: ColourField, x: number, y: number): [number, number, number] => {
  const fx = Math.min(field.width - 1, Math.max(0, (x - field.cell / 2) / field.cell))
  const fy = Math.min(field.height - 1, Math.max(0, (y - field.cell / 2) / field.cell))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(field.width - 1, x0 + 1)
  const y1 = Math.min(field.height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0

  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c += 1) {
    const top =
      (field.rgb[(y0 * field.width + x0) * 3 + c] ?? 0) * (1 - tx)
      + (field.rgb[(y0 * field.width + x1) * 3 + c] ?? 0) * tx
    const bottom =
      (field.rgb[(y1 * field.width + x0) * 3 + c] ?? 0) * (1 - tx)
      + (field.rgb[(y1 * field.width + x1) * 3 + c] ?? 0) * tx
    out[c] = Math.round(top * (1 - ty) + bottom * ty)
  }
  return out
}
