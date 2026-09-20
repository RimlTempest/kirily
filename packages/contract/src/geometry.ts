/**
 * Kirily has four coordinate systems and mixing them is the bug that shows up
 * as "the brush paints in the wrong place when zoomed" (IMPLEMENTATION.md §11):
 *
 *   screen → viewport → canvas → image
 *
 * Only *image* coordinates are stored. They refer to the original image's
 * pixels, never the preview's, so a stroke painted at 25% zoom still lands on
 * the right pixel of a 4000×3000 export.
 *
 * The `space` tag is what makes a mix-up a compile error. A branded type would
 * be free at runtime but would need a construction escape hatch; one string
 * field per point costs nothing measurable next to the pixel work, and shows
 * up in devtools.
 */

export type ImagePoint = {
  readonly space: 'image'
  readonly x: number
  readonly y: number
}

/** A point in CSS pixels, relative to the canvas element's top-left corner. */
export type ScreenPoint = {
  readonly space: 'screen'
  readonly x: number
  readonly y: number
}

export const imagePoint = (x: number, y: number): ImagePoint => ({ space: 'image', x, y })

export const screenPoint = (x: number, y: number): ScreenPoint => ({ space: 'screen', x, y })

export type Rect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type Viewport = {
  /** Screen pixels per image pixel. 1 means 100%. */
  readonly scale: number
  /** Where the image origin sits, in screen pixels. */
  readonly offsetX: number
  readonly offsetY: number
}

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }

export const toImagePoint = (point: ScreenPoint, viewport: Viewport): ImagePoint =>
  imagePoint(
    (point.x - viewport.offsetX) / viewport.scale,
    (point.y - viewport.offsetY) / viewport.scale,
  )

export const toScreenPoint = (point: ImagePoint, viewport: Viewport): ScreenPoint =>
  screenPoint(
    point.x * viewport.scale + viewport.offsetX,
    point.y * viewport.scale + viewport.offsetY,
  )

/** The zoom presets the toolbar offers (kirily-design.md §14). */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 1, 2, 4]

/**
 * Below this the image is a thumbnail; above it, one image pixel covers a
 * large block of screen and there is nothing left to see.
 */
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 32

export const clampZoom = (scale: number): number => {
  if (!Number.isFinite(scale)) return Number.isNaN(scale) ? 1 : ZOOM_MAX
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/**
 * Zooms while keeping the image point under `anchor` exactly where it is.
 *
 * Without this the image slides away from the pointer as you zoom, which is
 * the difference between a zoom you can aim and one you fight.
 */
export const zoomAt = (viewport: Viewport, anchor: ScreenPoint, scale: number): Viewport => {
  const next = clampZoom(scale)
  const image = toImagePoint(anchor, viewport)
  return {
    scale: next,
    offsetX: anchor.x - image.x * next,
    offsetY: anchor.y - image.y * next,
  }
}

/** Moves the image by a screen-space delta, one pixel for one. */
export const panBy = (viewport: Viewport, dx: number, dy: number): Viewport => ({
  ...viewport,
  offsetX: viewport.offsetX + dx,
  offsetY: viewport.offsetY + dy,
})

/**
 * Shows the whole image, centred, and never enlarges past 100%: blowing up a
 * small image to fill the frame suggests detail that is not there.
 */
export const fitViewport = (
  image: { readonly width: number; readonly height: number },
  container: { readonly width: number; readonly height: number },
): Viewport => {
  const usable = container.width > 0 && container.height > 0
  const scale = usable ? clampZoom(Math.min(1, fitScale(image, container))) : 1
  return centred(image, container, scale)
}

/** Scale that fits `image` inside `container` without cropping it. */
export const fitScale = (
  image: { readonly width: number; readonly height: number },
  container: { readonly width: number; readonly height: number },
): number => Math.min(container.width / image.width, container.height / image.height)

/**
 * Centres an image of `scale` inside `container`. Returned as a whole viewport
 * so callers cannot forget to update the offsets when the scale changes.
 */
export const centred = (
  image: { readonly width: number; readonly height: number },
  container: { readonly width: number; readonly height: number },
  scale: number,
): Viewport => ({
  scale,
  offsetX: (container.width - image.width * scale) / 2,
  offsetY: (container.height - image.height * scale) / 2,
})
