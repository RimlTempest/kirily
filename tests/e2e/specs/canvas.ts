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
    ({ spots: points, originX, originY, side }) => {
      const canvas = document.querySelector('canvas')
      if (!(canvas instanceof HTMLCanvasElement)) return {}
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) return {}

      const out: Record<string, number> = {}
      for (const [name, [fx, fy]] of Object.entries(points)) {
        const x = Math.min(canvas.width - 1, Math.round(originX + side * fx))
        const y = Math.min(canvas.height - 1, Math.round(originY + side * fy))
        out[name] = context.getImageData(x, y, 1, 1).data[3] ?? 0
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
