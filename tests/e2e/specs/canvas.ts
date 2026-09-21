import type { Page } from '@playwright/test'

/**
 * Where the image sits on screen, and how to read it.
 *
 * The canvas fills its frame and the image is fitted and centred inside it, so
 * canvas coordinates are not image coordinates. Every spec that clicks on the
 * image or samples a pixel has to go through the same mapping the editor uses
 * (`fitViewport`): fit to the smaller side, never enlarge past 100%.
 */
export type ImageRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const imageRect = async (page: Page, imageSize: number): Promise<ImageRect | null> => {
  const box = await page.getByLabel('編集中の画像').boundingBox()
  if (box === null) return null

  const scale = Math.min(1, Math.min(box.width, box.height) / imageSize)
  const side = imageSize * scale
  return {
    x: box.x + (box.width - side) / 2,
    y: box.y + (box.height - side) / 2,
    width: side,
    height: side,
  }
}

/** A page-space point at a fraction across the image. */
export const pointOnImage = (
  rect: ImageRect,
  fx: number,
  fy: number,
): { x: number; y: number } => ({
  x: rect.x + rect.width * fx,
  y: rect.y + rect.height * fy,
})

/**
 * Alpha at canvas-space points.
 *
 * Copied through a bitmap rather than read in place: a canvas keeps one kind
 * of context for life, and the editor's is WebGL whenever the GPU renderer
 * took it, so `getContext('2d')` on it would hand back null.
 */
export const alphaAt = async (
  page: Page,
  points: Readonly<Record<string, { x: number; y: number }>>,
): Promise<Record<string, number>> =>
  page.evaluate(async (wanted) => {
    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return {}
    const bitmap = await createImageBitmap(canvas)
    const copy = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = copy.getContext('2d', { willReadFrequently: true })
    if (context === null) return {}
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)

    const out: Record<string, number> = {}
    for (const [name, point] of Object.entries(wanted)) {
      const x = Math.min(bitmap.width - 1, Math.max(0, Math.round(point.x)))
      const y = Math.min(bitmap.height - 1, Math.max(0, Math.round(point.y)))
      out[name] = data[(y * bitmap.width + x) * 4 + 3] ?? 0
    }
    return out
  }, points)

/**
 * Alpha of the composited canvas at fractions across the *image*.
 *
 * Reads through the same mapping, so a probe means the same thing whatever the
 * window size.
 */
export const alphaOnImage = async (
  page: Page,
  imageSize: number,
  spots: Readonly<Record<string, readonly [number, number]>>,
): Promise<Record<string, number>> => {
  const rect = await imageRect(page, imageSize)
  if (rect === null) return {}

  const box = await page.getByLabel('編集中の画像').boundingBox()
  if (box === null) return {}

  return page.evaluate(
    async ({ spots: points, originX, originY, side }) => {
      const canvas = document.querySelector('canvas')
      if (!(canvas instanceof HTMLCanvasElement)) return {}

      // Copied through a bitmap rather than read in place: a canvas keeps one
      // kind of context for life, and the editor's is WebGL whenever the GPU
      // renderer took it, so `getContext('2d')` here would hand back null.
      const bitmap = await createImageBitmap(canvas)
      const copy = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = copy.getContext('2d', { willReadFrequently: true })
      if (context === null) return {}
      context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)

      const out: Record<string, number> = {}
      for (const [name, [fx, fy]] of Object.entries(points)) {
        const x = Math.min(bitmap.width - 1, Math.round(originX + side * fx))
        const y = Math.min(bitmap.height - 1, Math.round(originY + side * fy))
        out[name] = data[(y * bitmap.width + x) * 4 + 3] ?? 0
      }
      return out
    },
    {
      spots,
      // Canvas pixels, not page pixels: the canvas backing store matches its
      // CSS size here, but its origin is the frame's, not the page's.
      originX: rect.x - box.x,
      originY: rect.y - box.y,
      side: rect.width,
    },
  )
}
