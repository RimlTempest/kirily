import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * The real segmentation models.
 *
 * The weights are build input, not source (`bun run models:fetch`), so this
 * file checks that they are published before asserting anything about them —
 * a checkout without them should not turn into a wall of red.
 *
 * Chromium is launched without a GPU here, so this exercises the CPU tier.
 * The WebGPU tiers need a real adapter; `docs/adr/0007-segmentation-model.md`
 * records how to run them.
 */

const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

const modelsPublished = async (page: Page): Promise<boolean> => {
  const response = await page.request.get('/models/u2netp/manifest.json')
  return response.ok()
}

test.describe('segmentation', () => {
  test('removes the background with a real model, not the placeholder', async ({ page }) => {
    await page.goto('/')
    test.skip(!(await modelsPublished(page)), "run 'bun run models:fetch' first")

    await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
    await expect(page.getByLabel('編集中の画像')).toBeVisible()

    await page.getByRole('button', { name: '背景をきりり' }).click()
    // Downloading and running a model takes noticeably longer than the
    // placeholder, so the status line is what we wait on.
    await expect(page.getByText('軽量モデル')).toBeVisible({ timeout: 120_000 })

    const alpha = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      if (!(canvas instanceof HTMLCanvasElement)) return null
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) return null
      return {
        corner: context.getImageData(1, 1, 1, 1).data[3],
        centre: context.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data[3],
      }
    })

    expect(alpha).not.toBeNull()
    // The fixture is a red square on white: the corner is background, the
    // centre is the subject.
    expect(alpha?.corner).toBeLessThan(32)
    expect(alpha?.centre).toBeGreaterThan(223)
  })

  test('the exported PNG carries the transparency, at the original size', async ({ page }) => {
    await page.goto('/')
    test.skip(!(await modelsPublished(page)), "run 'bun run models:fetch' first")

    await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
    await page.getByRole('button', { name: '背景をきりり' }).click()
    await expect(page.getByText('軽量モデル')).toBeVisible({ timeout: 120_000 })

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'PNG で書き出す' }).click()
    const file = await download

    const path = await file.path()
    const decoded = await page.evaluate(
      async (bytes) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
        const bitmap = await createImageBitmap(blob)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')
        if (context === null) return null
        context.drawImage(bitmap, 0, 0)
        return {
          width: bitmap.width,
          height: bitmap.height,
          corner: context.getImageData(1, 1, 1, 1).data[3],
          centre: context.getImageData(
            Math.floor(bitmap.width / 2),
            Math.floor(bitmap.height / 2),
            1,
            1,
          ).data[3],
        }
      },
      Array.from(await readFile(path)),
    )

    expect(decoded?.width).toBe(120)
    expect(decoded?.height).toBe(120)
    expect(decoded?.corner).toBeLessThan(32)
    expect(decoded?.centre).toBeGreaterThan(223)
  })
})
