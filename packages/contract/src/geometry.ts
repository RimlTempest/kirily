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

/** Clockwise quarter turns. Anything else would resample and lose detail. */
export const QUARTERS = [0, 90, 180, 270] as const

export type Quarter = (typeof QUARTERS)[number]

export const nextQuarter = (rotation: Quarter): Quarter =>
  QUARTERS[(QUARTERS.indexOf(rotation) + 1) % QUARTERS.length] ?? 0

export type Viewport = {
  /** Screen pixels per image pixel. 1 means 100%. */
  readonly scale: number
  /** Where the image origin sits, in screen pixels. */
  readonly offsetX: number
  readonly offsetY: number
  /**
   * How far the image is turned on screen, clockwise.
   *
   * A property of the *view*, like the zoom. The mask, the crop and the export
   * never see it: a landscape photograph held in a portrait hand is hard to
   * paint on, and that is a problem with the hand rather than with the file
   * (ADR-0027).
   */
  readonly rotation: Quarter
}

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 }

/**
 * Turns a vector about the origin, not about the image's centre.
 *
 * Keeping the rotation free of the image's size is what lets the conversions
 * stay two-argument functions: whatever translation a turn needs to bring the
 * picture back into view is folded into the offsets, which is where every
 * other translation already lives.
 */
const turn = (x: number, y: number, rotation: Quarter): { x: number; y: number } => {
  if (rotation === 90) return { x: -y, y: x }
  if (rotation === 180) return { x: -x, y: -y }
  if (rotation === 270) return { x: y, y: -x }
  return { x, y }
}

/** Total over the four, so undoing a turn needs no arithmetic and no cast. */
const OPPOSITE: Record<Quarter, Quarter> = { 0: 0, 90: 270, 180: 180, 270: 90 }

const unturn = (x: number, y: number, rotation: Quarter): { x: number; y: number } =>
  turn(x, y, OPPOSITE[rotation])

export const toImagePoint = (point: ScreenPoint, viewport: Viewport): ImagePoint => {
  const turned = unturn(
    (point.x - viewport.offsetX) / viewport.scale,
    (point.y - viewport.offsetY) / viewport.scale,
    viewport.rotation,
  )
  return imagePoint(turned.x, turned.y)
}

export const toScreenPoint = (point: ImagePoint, viewport: Viewport): ScreenPoint => {
  const turned = turn(point.x, point.y, viewport.rotation)
  return screenPoint(
    turned.x * viewport.scale + viewport.offsetX,
    turned.y * viewport.scale + viewport.offsetY,
  )
}

/** What the image occupies on screen once it is turned, before scaling. */
export const turnedBounds = (
  image: { readonly width: number; readonly height: number },
  rotation: Quarter,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  const corners = [
    turn(0, 0, rotation),
    turn(image.width, 0, rotation),
    turn(0, image.height, rotation),
    turn(image.width, image.height, rotation),
  ]
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

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
  const turned = turn(image.x, image.y, viewport.rotation)
  return {
    ...viewport,
    scale: next,
    offsetX: anchor.x - turned.x * next,
    offsetY: anchor.y - turned.y * next,
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
  rotation: Quarter = 0,
): Viewport => {
  const usable = container.width > 0 && container.height > 0
  // Fit what the screen will show, which is the turned shape: a landscape
  // image turned a quarter has to be fitted as a portrait one.
  const bounds = turnedBounds(image, rotation)
  const scale = usable ? clampZoom(Math.min(1, fitScale(bounds, container))) : 1
  return centred(image, container, scale, rotation)
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
  rotation: Quarter = 0,
): Viewport => {
  const bounds = turnedBounds(image, rotation)
  return {
    scale,
    rotation,
    // The turned box does not start at the origin — a quarter turn puts it at
    // negative x — so the offset has to undo that before centring.
    offsetX: (container.width - bounds.width * scale) / 2 - bounds.x * scale,
    offsetY: (container.height - bounds.height * scale) / 2 - bounds.y * scale,
  }
}
