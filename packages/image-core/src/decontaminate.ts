/**
 * Takes the old background's colour back out of the soft edge.
 *
 * A partially covered pixel holds `subject·a + background·(1-a)`. Dropping the
 * background without undoing that mix leaves the familiar halo: a dark subject
 * cut from a light page keeps a pale rim, and it only becomes visible once the
 * cut-out is placed somewhere else (kirily-design.md §7.3).
 *
 * Measured on `tests/fixtures/cases.ts` before this existed: the mean channel
 * error over partially covered pixels was 0.38 on the thin strands and 0.24 on
 * the gradient backdrop. `edgeColourError` is what keeps it honest.
 *
 * The background is not one colour. Correcting against a single sampled colour
 * works on a studio backdrop and fails on everything else, so the estimate is
 * a coarse grid — one colour per `DEFAULT_CELL` square, bilinearly sampled.
 * That is 18 KB at 1254² instead of a second full-resolution buffer, and a
 * gradient comes out as a gradient.
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'

export type Size = { readonly width: number; readonly height: number }

/** One background colour per `cell`×`cell` square of the image. */
export type BackgroundField = {
  readonly cell: number
  readonly width: number
  readonly height: number
  /** Three bytes per cell, row major. */
  readonly rgb: Uint8Array
}

/**
 * Coarse enough that a cell almost always contains some background, fine
 * enough to follow a sky. At 1254² this is a 40×40 grid.
 */
export const DEFAULT_CELL = 32

/** At or below this, a pixel is background the model was sure about. */
const BACKGROUND_BELOW = 24

/** Nothing in the image was background: better a neutral than a black rim. */
const NEUTRAL = 128

export const estimateBackground = (
  rgba: Uint8ClampedArray,
  size: Size,
  mask: Uint8Array,
  cell: number = DEFAULT_CELL,
): BackgroundField => {
  const across = Math.max(1, Math.ceil(size.width / cell))
  const down = Math.max(1, Math.ceil(size.height / cell))
  const totals = new Float64Array(across * down * 3)
  const counts = new Uint32Array(across * down)

  for (let y = 0; y < size.height; y += 1) {
    const row = Math.min(down - 1, Math.floor(y / cell))
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x
      if ((mask[index] ?? 0) > BACKGROUND_BELOW) continue
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

  // A cell buried inside the subject saw no background. Grow outward from the
  // cells that did, so it copies the nearest real measurement rather than
  // painting a black rim onto whatever edge borders it.
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
export const sampleBackground = (
  field: BackgroundField,
  x: number,
  y: number,
): [number, number, number] => {
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

/**
 * The colour the subject had before it was mixed, clamped to what a byte can
 * hold.
 *
 * Small alphas amplify: at a = 0.05 a one-unit error in the estimate becomes
 * twenty. Clamping bounds the damage, and such a pixel contributes almost
 * nothing once it is composited again.
 */
export const unmix = (observed: number, background: number, alpha: number): number => {
  if (alpha <= 0) return observed
  const recovered = (observed - background * (1 - alpha)) / alpha
  return Math.round(Math.min(255, Math.max(0, recovered)))
}

/**
 * Corrects the partially covered pixels of `rgba` in place.
 *
 * In place because the caller already owns a copy: the export pipeline works
 * on the cropped buffer it is about to encode, and the renderer corrects the
 * pixels it has just sampled. Neither touches the decoded original.
 *
 * `origin` is where this buffer sits in the full image. A crop carries its own
 * coordinates but the field was measured on the whole picture, so without it a
 * crop would be corrected against the wrong part of the background.
 */
export const decontaminate = (
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  size: Size,
  field: BackgroundField,
  origin: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): Result<void, KirilyError> => {
  const pixels = size.width * size.height
  if (mask.length !== pixels) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `decontaminate: mask ${mask.length}, expected ${pixels}`,
      ),
    )
  }
  if (rgba.length !== pixels * 4) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `decontaminate: rgba ${rgba.length}, expected ${pixels * 4}`,
      ),
    )
  }

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x
      const coverage = mask[index] ?? 0
      // An untouched pixel holds no background, and an invisible one is never
      // composited: only the band between them carries a halo.
      if (coverage === 0 || coverage === 255) continue

      const background = sampleBackground(field, origin.x + x, origin.y + y)
      const alpha = coverage / 255
      for (let c = 0; c < 3; c += 1) {
        rgba[index * 4 + c] = unmix(rgba[index * 4 + c] ?? 0, background[c] ?? 0, alpha)
      }
    }
  }
  return ok(undefined)
}
