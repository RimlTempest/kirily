import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { alphaOnImage, imageRect, pointOnImage } from './canvas.ts'

/**
 * The bucket, after it learned two things.
 *
 * Its selection used to be what a flood fill reaches: 0.3% of it was partial
 * and the boundary was a stair-step. And it could only see colour, so it ran
 * straight through a white collar into a white page (ADR-0019).
 */
const fixture = fileURLToPath(new URL('../../fixtures/pale-subject-on-white.png', import.meta.url))
const SIZE = 1254

test.describe('bucket', () => {
  test('the edge it leaves is a ramp, not a step', async ({ page }) => {
    test.slow()
    await page.goto('/editor')
    await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
    await expect(page.getByText('1254 × 1254')).toBeVisible()

    await page.getByRole('button', { name: 'まとめて消す' }).click()
    const rect = await imageRect(page, SIZE)
    expect(rect).not.toBeNull()
    if (rect === null) return

    // A corner: unambiguously background on any model's reading.
    const seed = pointOnImage(rect, 0.03, 0.03)
    await page.mouse.click(seed.x, seed.y)

    // Sample straight across the hair's left edge. A step would put every
    // reading at 0 or 255; a ramp puts at least one in between.
    const spots: Record<string, [number, number]> = {}
    for (let i = 0; i < 24; i += 1) {
      spots[`x${i}`] = [0.06 + i * 0.004, 0.45]
    }
    const alpha = await alphaOnImage(page, SIZE, spots)
    const values = Object.values(alpha)
    expect(values.some((value) => value > 16 && value < 239)).toBe(true)
  })

  test('with the AI edge on, a fill from the background stops at the subject', async ({ page }) => {
    test.slow()
    await page.goto('/editor')
    await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
    await page.getByRole('button', { name: '背景をきりり' }).click()
    await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({
      timeout: 300_000,
    })

    await page.getByRole('button', { name: 'まとめて消す' }).click()
    const guard = page.getByRole('checkbox', { name: 'AI の輪郭で止める' })
    await expect(guard).toBeVisible()
    await expect(guard).toBeChecked()

    const rect = await imageRect(page, SIZE)
    if (rect === null) return

    // A loose tolerance, which without the guard is exactly what makes a fill
    // from the background walk into the pale skin.
    await page.getByRole('slider', { name: '色の幅' }).fill('0.08')
    const seed = pointOnImage(rect, 0.03, 0.03)
    await page.mouse.click(seed.x, seed.y)

    const alpha = await alphaOnImage(page, SIZE, {
      corner: [0.02, 0.02],
      faceCentre: [0.5, 0.72],
      hair: [0.5, 0.3],
    })
    expect(alpha['corner']).toBeLessThan(32)
    expect(alpha['faceCentre']).toBeGreaterThan(223)
    expect(alpha['hair']).toBeGreaterThan(223)
  })

  test('the AI edge switch is only offered once there is a mask', async ({ page }) => {
    await page.goto('/editor')
    await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
    await page.getByRole('button', { name: 'まとめて消す' }).click()
    await expect(page.getByRole('checkbox', { name: 'AI の輪郭で止める' })).toBeHidden()
  })
})
