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
const paleFixture = fileURLToPath(
  new URL('../../fixtures/pale-subject-on-white.png', import.meta.url),
)

/**
 * Reads the alpha channel of the composited canvas at points given as
 * fractions of the image, so the same probe works at any preview scale.
 */
const alphaAt = async (
  page: Page,
  points: Readonly<Record<string, readonly [number, number]>>,
): Promise<Record<string, number>> =>
  page.evaluate((spots) => {
    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return {}
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return {}

    const out: Record<string, number> = {}
    for (const [name, [fx, fy]] of Object.entries(spots)) {
      const x = Math.min(canvas.width - 1, Math.round(fx * canvas.width))
      const y = Math.min(canvas.height - 1, Math.round(fy * canvas.height))
      out[name] = context.getImageData(x, y, 1, 1).data[3] ?? 0
    }
    return out
  }, points)

const modelsPublished = async (page: Page): Promise<boolean> => {
  const response = await page.request.get('/models/u2netp/manifest.json')
  return response.ok()
}

/**
 * Waits for a real model to finish — any tier, but not the placeholder.
 *
 * Which tier runs depends on the device, so naming one here would make the
 * suite pass on a laptop and fail on a CI runner for reasons that have nothing
 * to do with the code.
 */
const removedByAModel = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: '背景をきりり' }).click()
  await expect(page.getByText(/高精度モデル|軽量モデル/)).toBeVisible({ timeout: 300_000 })
  await expect(page.getByText('簡易処理')).toBeHidden()
}

test.describe('segmentation', () => {
  test('removes the background with a real model, not the placeholder', async ({ page }) => {
    await page.goto('/')
    test.skip(!(await modelsPublished(page)), "run 'bun run models:fetch' first")

    await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
    await expect(page.getByLabel('編集中の画像')).toBeVisible()

    // Downloading and running a model takes noticeably longer than the
    // placeholder, so the status line is what we wait on.
    await removedByAModel(page)

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
    await removedByAModel(page)

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

  /**
   * The hard case: background and skin are within a few percent of each other
   * in lightness. The silhouette comes out right, but the model reports low
   * confidence across the interior, which used to leave the face半透明
   * (ADR-0007). `solidifyInterior` closes it — these probes are what would
   * catch it coming back.
   */
  test('keeps the interior opaque when the subject is as pale as the background', async ({
    page,
  }) => {
    await page.goto('/')
    test.skip(!(await modelsPublished(page)), "run 'bun run models:fetch' first")

    await page.getByLabel('編集する画像を選ぶ').setInputFiles(paleFixture)
    await expect(page.getByLabel('編集中の画像')).toBeVisible()
    await expect(page.getByText('1254 × 1254')).toBeVisible()

    await removedByAModel(page)

    const alpha = await alphaAt(page, {
      topLeft: [0.02, 0.02],
      topRight: [0.98, 0.02],
      bottomLeft: [0.02, 0.98],
      hair: [0.5, 0.3],
      faceCentre: [0.5, 0.72],
      // Measured, not guessed: with the interior left unclosed the quality
      // model reports 120–200 here and nowhere else inside the face.
      rightCheek: [0.65, 0.725],
      underRightEye: [0.675, 0.775],
    })

    // Background: the corners are outside the subject on every tier.
    expect(alpha['topLeft']).toBeLessThan(32)
    expect(alpha['topRight']).toBeLessThan(32)
    expect(alpha['bottomLeft']).toBeLessThan(32)

    // Subject: hair is easy, the pale interior is the regression.
    expect(alpha['hair']).toBeGreaterThan(223)
    expect(alpha['faceCentre']).toBeGreaterThan(223)
    expect(alpha['rightCheek']).toBeGreaterThan(223)
    expect(alpha['underRightEye']).toBeGreaterThan(223)
  })

  test('the quality model runs on a GPU and keeps the subject to its edge', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-webgpu',
      'needs a real GPU adapter: bun run e2e:webgpu',
    )
    await page.goto('/')
    test.skip(!(await modelsPublished(page)), "run 'bun run models:fetch' first")

    await page.getByLabel('編集する画像を選ぶ').setInputFiles(paleFixture)
    await page.getByRole('button', { name: '背景をきりり' }).click()
    await expect(page.getByText('高精度モデル')).toBeVisible({ timeout: 300_000 })

    const alpha = await alphaAt(page, {
      corner: [0.02, 0.02],
      faceCentre: [0.5, 0.72],
      // The collar touches the bottom edge. The small model drops it; the
      // quality tier is expected to hold on to it.
      collar: [0.5, 0.95],
    })

    expect(alpha['corner']).toBeLessThan(32)
    expect(alpha['faceCentre']).toBeGreaterThan(223)
    expect(alpha['collar']).toBeGreaterThan(223)
  })
})
