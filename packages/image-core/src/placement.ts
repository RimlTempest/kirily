/**
 * Where a layer sits, as an offset and a zoom.
 *
 * Two things need it and they need the same thing: the picture behind the
 * cut-out, which arrives framed to `cover` and is rarely framed the way anyone
 * wanted, and the cut-out itself, which lands where it was in the original
 * photograph and usually belongs somewhere else on the new background.
 *
 * Expressed as a *sampling* transform rather than a drawing one. Everything
 * downstream — the two renderers and the exporter — walks output pixels and
 * asks what belongs there, so a placement has to answer "where do I read
 * from", and `placedSample` is that question.
 */
import type { Size } from './field.ts'

export type Placement = {
  /** How far the content has been moved, in the frame's pixels. */
  readonly offsetX: number
  readonly offsetY: number
  /** 1 is untouched. Grows about the frame's centre plus the offset. */
  readonly scale: number
}

export const DEFAULT_PLACEMENT: Placement = { offsetX: 0, offsetY: 0, scale: 1 }

/** Far enough to be useful, near enough that a user can undo it by eye. */
export const SCALE_MIN = 0.1
export const SCALE_MAX = 8

export const clampScale = (scale: number): number => {
  if (!Number.isFinite(scale)) return 1
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale))
}

/** False when there is nothing to apply, so callers can take the fast path. */
export const isPlaced = (placement: Placement): boolean =>
  placement.offsetX !== 0 || placement.offsetY !== 0 || placement.scale !== 1

export const moveBy = (placement: Placement, dx: number, dy: number): Placement => ({
  ...placement,
  offsetX: placement.offsetX + dx,
  offsetY: placement.offsetY + dy,
})

/**
 * Zooms about a point, keeping what is under it under it.
 *
 * Anchored rather than centred because a user zooms at the thing they are
 * looking at, and a centred zoom walks it off the screen.
 */
export const zoomBy = (
  placement: Placement,
  factor: number,
  anchorX: number,
  anchorY: number,
  frame: Size,
): Placement => {
  const next = clampScale(placement.scale * factor)
  const ratio = next / placement.scale

  // Solved from `placedSample`, by asking that the same content point stays
  // under the anchor before and after. The frame's centre is in the inverse,
  // so it has to be here too — leaving it out is a zoom that quietly slides.
  const hold = (anchor: number, offset: number, half: number): number =>
    anchor - half - (anchor - offset - half) * ratio

  return {
    scale: next,
    offsetX: hold(anchorX, placement.offsetX, frame.width / 2),
    offsetY: hold(anchorY, placement.offsetY, frame.height / 2),
  }
}

/**
 * Where to read from, for an output pixel at `(x, y)`.
 *
 * The inverse of the move-and-zoom: the content went right, so the sample
 * comes from further left.
 */
export const placedSample = (
  placement: Placement,
  x: number,
  y: number,
  frame: Size,
): { readonly x: number; readonly y: number } => {
  if (placement.scale === 1) {
    return { x: x - placement.offsetX, y: y - placement.offsetY }
  }
  const centreX = frame.width / 2
  const centreY = frame.height / 2
  return {
    x: centreX + (x - placement.offsetX - centreX) / placement.scale,
    y: centreY + (y - placement.offsetY - centreY) / placement.scale,
  }
}
