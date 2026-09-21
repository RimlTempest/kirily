import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/**
 * The GPU path has to draw the same picture as the CPU one.
 *
 * A renderer that is merely close is a renderer that shows the user something
 * different from what the exporter will write, which is the one thing the
 * Preview/Export split exists to prevent (kirily-design.md §16). So this runs
 * the same file through both and compares every channel of every pixel.
 *
 * Two page loads rather than two canvases: a canvas hands out one kind of
 * context for its lifetime, so the two renderers cannot share one. Everything
 * that decides the picture — the file, the model, the viewport, the window —
 * is the same across the two loads.
 */
const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

/** Straight RGBA off the visible canvas, as base64. */
const canvasPixels = async (
  page: Page,
  renderer: 'webgl' | 'canvas',
  zoom: boolean,
): Promise<Buffer> => {
  await page.goto(`/editor?renderer=${renderer}`)
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()

  await page.getByRole('button', { name: '背景をきりり' }).click()
  await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({
    timeout: 300_000,
  })

  if (zoom) {
    // Past 150% the renderers switch from bilinear to nearest, which is a
    // different sampler on the GPU and a different branch on the CPU.
    const readout = page.getByLabel('現在の倍率')
    const percent = async (): Promise<number> =>
      Number((await readout.textContent())?.replace('%', '') ?? '0')
    // Stepped up rather than set: the fit scale depends on the window, so a
    // fixed number of clicks lands somewhere different on a different machine.
    for (let i = 0; i < 6 && (await percent()) < 150; i += 1) {
      await page.getByRole('button', { name: '拡大' }).click()
    }
    expect(await percent()).toBeGreaterThanOrEqual(150)
  }

  const encoded = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return ''
    // Through a blob: reading a WebGL canvas needs its own context, and
    // `convertToBlob` on a copy works for both kinds.
    const bitmap = await createImageBitmap(canvas)
    const copy = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = copy.getContext('2d', { willReadFrequently: true })
    if (context === null) return ''
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    let binary = ''
    for (const value of data) binary += String.fromCharCode(value)
    return btoa(binary)
  })

  return Buffer.from(encoded, 'base64')
}

test.describe('renderer', () => {
  for (const [name, zoom] of [
    ['fitted, so both sample bilinearly', false],
    ['zoomed past 150%, where both switch to nearest', true],
  ] as const) {
    test(`the GPU draws what the CPU draws — ${name}`, async ({ page }) => {
      test.slow()

      const gpu = await canvasPixels(page, 'webgl', zoom)
      const cpu = await canvasPixels(page, 'canvas', zoom)
      expect(gpu.length).toBeGreaterThan(0)
      expect(gpu.length).toBe(cpu.length)

      let worst = 0
      let total = 0
      let off = 0
      for (let i = 0; i < gpu.length; i += 1) {
        const difference = Math.abs((gpu[i] ?? 0) - (cpu[i] ?? 0))
        total += difference
        if (difference > worst) worst = difference
        if (difference > 2) off += 1
      }

      // Not byte-identical by design: the CPU path rounds each bilinear sample
      // to a byte before compositing and the GPU keeps floats until the write.
      // A channel may land a step apart; a wrong picture cannot hide in that.
      expect(worst).toBeLessThanOrEqual(2)
      expect(off).toBe(0)
      expect(total / gpu.length).toBeLessThan(0.5)
    })
  }
})
