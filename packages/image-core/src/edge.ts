/**
 * The two knobs every cutout tool has, and Kirily did not.
 *
 * The automatic edge is good but it is not always right, and the direction it
 * is wrong in is consistent enough to be worth a control. Measured on
 * `pale-subject-on-white.png`, the mask runs about a pixel wide of the subject
 * — pixels that read as pure background still carry alpha (ADR-0011) — so the
 * fix a user reaches for is "pull it in a little".
 *
 * Both come out of one blur. Blurring a step edge with radius r turns it into
 * a ramp `2r + 1` pixels wide, so reading off a level other than a half moves
 * the edge, and how steeply the level is remapped decides how soft it is:
 *
 *     alpha = clamp((blurred - level) · gain + 0.5)
 *     level = 0.5 - shrink / (2r + 1)
 *     gain  = (2r + 1) / feather
 *
 * This is a view of the mask, not an edit to it. It applies when the mask is
 * composed, so the renderer and the exporter see the same thing and undo has
 * nothing to do with it — the same reasoning as the crop.
 *
 * TypeScript only, like `solidifyInterior` and `colourMatte`: it runs where
 * the mask is composed, which has no WASM engine, and a blur of a byte mask is
 * not where the time goes.
 */
import { boxBlur } from './blur.ts'
import type { Size } from './field.ts'

export type EdgeSettings = {
  /** Pixels. Negative pulls the edge into the subject, positive pushes it out. */
  readonly shrink: number
  /** Pixels the edge takes to go from transparent to opaque. 0 keeps it as it is. */
  readonly feather: number
}

export const DEFAULT_EDGE: EdgeSettings = { shrink: 0, feather: 0 }

/** How far the controls reach. Beyond this it stops being an edge correction. */
export const EDGE_LIMIT = 6

export const isNeutral = (settings: EdgeSettings): boolean =>
  settings.shrink === 0 && settings.feather === 0

export const clampEdge = (settings: EdgeSettings): EdgeSettings => ({
  shrink: Number.isFinite(settings.shrink)
    ? Math.min(EDGE_LIMIT, Math.max(-EDGE_LIMIT, settings.shrink))
    : 0,
  feather: Number.isFinite(settings.feather)
    ? Math.min(EDGE_LIMIT, Math.max(0, settings.feather))
    : 0,
})

/** Rewrites `mask` in place. */
export const adjustEdge = (mask: Uint8Array, size: Size, settings: EdgeSettings): Uint8Array => {
  const pixels = size.width * size.height
  if (mask.length !== pixels || pixels === 0) return mask
  const { shrink, feather } = clampEdge(settings)
  if (shrink === 0 && feather === 0) return mask

  // The ramp has to have room for both the move and the softness, or the
  // remap reaches past the edge and lifts the interior with it. Writing out
  // what the interior and the exterior have to land on gives
  // `span >= feather + 2·|shrink|`, and this is that solved for the radius.
  const softness = Math.max(1, feather)
  const radius = Math.max(1, Math.ceil((softness + 2 * Math.abs(shrink) - 1) / 2))
  const span = radius * 2 + 1

  const source = new Float32Array(pixels)
  for (let i = 0; i < pixels; i += 1) source[i] = (mask[i] ?? 0) / 255
  const blurred = boxBlur(source, size.width, size.height, radius)

  // A *higher* level sits further into the subject, so pulling the edge in
  // means reading off a higher one. The sign is easy to get backwards and the
  // tests pin it.
  const level = 0.5 - shrink / span
  // Feather 0 means "as hard as the blur will allow", which is one pixel.
  const gain = span / softness

  for (let i = 0; i < pixels; i += 1) {
    const value = ((blurred[i] ?? 0) - level) * gain + 0.5
    mask[i] = value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255)
  }
  return mask
}
