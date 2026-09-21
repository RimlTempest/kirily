/**
 * Crop geometry.
 *
 * Every value here is in *image* coordinates, never screen ones: the crop is
 * applied to the original pixels at export time, so a rectangle that means
 * something different at a different zoom would silently change what gets
 * written out (kirily-design.md §16).
 *
 * All of it is arithmetic, which is why it lives here rather than in the
 * component that drags the handles.
 */
import type { ImagePoint, Rect } from '@kirily/contract/geometry'

export type Size = { readonly width: number; readonly height: number }

/** Which part of the rectangle a drag is moving. */
export type CropHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'move'

export type AspectPreset = {
  readonly label: string
  /** Width over height, or null for a free crop. */
  readonly ratio: number | null
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { label: '自由', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
]

/** A crop smaller than this is a mis-click, not an intention. */
const MINIMUM = 8

/**
 * Keeps a rectangle inside the image.
 *
 * It slides before it shrinks: dragging a box off the edge should stop it, not
 * silently resize it to whatever is left.
 */
export const clampCrop = (rect: Rect, image: Size): Rect => {
  const width = Math.round(Math.min(rect.width, image.width))
  const height = Math.round(Math.min(rect.height, image.height))
  return {
    x: Math.round(Math.min(Math.max(0, rect.x), image.width - width)),
    y: Math.round(Math.min(Math.max(0, rect.y), image.height - height)),
    width,
    height,
  }
}

/** The rectangle between two dragged corners, respecting an aspect ratio. */
export const cropFromDrag = (
  from: ImagePoint,
  to: ImagePoint,
  image: Size,
  ratio: number | null,
): Rect => {
  const left = Math.max(0, Math.min(from.x, to.x))
  const top = Math.max(0, Math.min(from.y, to.y))
  const right = Math.min(image.width, Math.max(from.x, to.x))
  const bottom = Math.min(image.height, Math.max(from.y, to.y))

  let width = Math.max(MINIMUM, right - left)
  let height = Math.max(MINIMUM, bottom - top)

  if (ratio !== null && ratio > 0) {
    // Fit inside the drag rather than outside it, so the box never jumps
    // beyond where the pointer went.
    if (width / height > ratio) width = height * ratio
    else height = width / ratio
  }

  return clampCrop({ x: left, y: top, width, height }, image)
}

/**
 * Moves one handle, leaving the opposite corner where it is.
 *
 * A handle that crosses its opposite would invert the rectangle; it stops at
 * the minimum instead, which is what every editor does.
 */
export const resizeCrop = (
  rect: Rect,
  handle: CropHandle,
  to: ImagePoint,
  image: Size,
  ratio: number | null,
): Rect => {
  if (handle === 'move') return clampCrop({ ...rect, x: to.x, y: to.y }, image)

  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const holdsLeft = handle === 'top-right' || handle === 'bottom-right'
  const holdsTop = handle === 'bottom-left' || handle === 'bottom-right'

  const anchorX = holdsLeft ? rect.x : right
  const anchorY = holdsTop ? rect.y : bottom

  return cropFromDrag(
    { space: 'image', x: anchorX, y: anchorY },
    { space: 'image', x: to.x, y: to.y },
    image,
    ratio,
  )
}

/** The whole image, as a crop. */
export const fullCrop = (image: Size): Rect => ({
  x: 0,
  y: 0,
  width: image.width,
  height: image.height,
})

/**
 * The smallest rectangle that still contains everything visible.
 *
 * What a cut-out usually wants next is to stop being mostly empty: the subject
 * sat in the middle of a photograph, and the transparent margin around it is
 * now just padding that every later step has to carry.
 *
 * `VISIBLE` is deliberately not 1. Refinement and matting leave a scatter of
 * single-digit alpha well outside the subject, and trimming to those would
 * trim to nothing (ADR-0021).
 */
const VISIBLE = 8

export const cropToSubject = (mask: Uint8Array, image: Size): Rect => {
  const whole = fullCrop(image)
  if (mask.length !== image.width * image.height) return whole

  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1

  for (let y = 0; y < image.height; y += 1) {
    const row = y * image.width
    for (let x = 0; x < image.width; x += 1) {
      if ((mask[row + x] ?? 0) < VISIBLE) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }

  // Nothing visible: an empty rectangle would be a crop the user cannot undo
  // their way out of by eye.
  if (right < left || bottom < top) return whole
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}
