import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * The edge controls, and trimming to the subject.
 *
 * Both are read off the exported file rather than the canvas: what the slider
 * is worth is what ends up in the PNG.
 */
const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

type Exported = { width: number; height: number; opaque: number }

const open = async (page: Page): Promise<void> => {
  await page.goto('/editor')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()
  await page.getByRole('button', { name: '背景をきりり' }).click()
  await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({
    timeout: 300_000,
  })
}

const exported = async (page: Page): Promise<Exported> => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG で書き出す' }).click()
  const path = await (await download).path()
  const decoded = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      )
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (context === null) return null
      context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      let opaque = 0
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 127) opaque += 1
      return { width: bitmap.width, height: bitmap.height, opaque }
    },
    Array.from(await readFile(path)),
  )
  expect(decoded).not.toBeNull()
  return decoded ?? { width: 0, height: 0, opaque: 0 }
}

test.describe('edge', () => {
  test('pulling the edge in leaves less of the subject than pushing it out', async ({ page }) => {
    test.slow()
    await open(page)

    const shrink = page.getByRole('slider', { name: '締める' })
    await shrink.fill('-4')
    const pulled = await exported(page)
    await shrink.fill('4')
    const pushed = await exported(page)

    expect(pulled.opaque).toBeLessThan(pushed.opaque)
    // Still the same picture, not a collapsed or runaway mask.
    expect(pulled.opaque).toBeGreaterThan(0)
    expect(pushed.opaque).toBeLessThan(pushed.width * pushed.height)
  })

  test('the controls appear only once there is a mask', async ({ page }) => {
    await page.goto('/editor')
    await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
    await expect(page.getByLabel('編集中の画像')).toBeVisible()
    await expect(page.getByRole('slider', { name: '締める' })).toBeHidden()
  })

  test('trimming to the subject makes the export smaller than the image', async ({ page }) => {
    test.slow()
    await open(page)
    const whole = await exported(page)
    expect(whole.width).toBe(120)

    await page.getByRole('button', { name: 'トリミング' }).click()
    await page.getByRole('button', { name: '余白を詰める' }).click()
    const trimmed = await exported(page)

    expect(trimmed.width).toBeLessThan(whole.width)
    expect(trimmed.height).toBeLessThan(whole.height)
    // The subject survived the trim: only the empty margin went.
    expect(trimmed.opaque).toBeGreaterThan(whole.opaque * 0.9)
  })
})
