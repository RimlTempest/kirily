import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { imageRect, pointOnImage } from './canvas.ts'

/**
 * How much a stroke is about to take.
 *
 * The brush is a radius in the image's pixels, so what it covers on screen
 * depends on the zoom — a number in the corner cannot say that and a ring at
 * the pointer can.
 */
const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

const open = async (page: Page): Promise<void> => {
  await page.goto('/editor')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()
}

const ring = (page: Page) => page.getByTestId('brush-ring')

const hoverCentre = async (page: Page): Promise<{ x: number; y: number }> => {
  const rect = await imageRect(page, 120)
  expect(rect).not.toBeNull()
  const at = pointOnImage(rect ?? { x: 0, y: 0, width: 0, height: 0 }, 0.5, 0.5)
  await page.mouse.move(at.x, at.y)
  return at
}

test.describe('the brush ring', () => {
  test('appears under the pointer for a brush', async ({ page }) => {
    await open(page)
    await hoverCentre(page)
    await expect(ring(page)).toBeVisible()
  })

  test('is not shown for a tool that has no radius', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'まとめて消す' }).click()
    await hoverCentre(page)
    await expect(ring(page)).toBeHidden()
  })

  test('goes away when the pointer leaves', async ({ page }) => {
    await open(page)
    await hoverCentre(page)
    await expect(ring(page)).toBeVisible()

    await page.mouse.move(2, 2)
    await expect(ring(page)).toBeHidden()
  })

  test('follows the pointer', async ({ page }) => {
    await open(page)
    const at = await hoverCentre(page)
    const before = await ring(page).boundingBox()

    await page.mouse.move(at.x + 40, at.y + 25)
    const after = await ring(page).boundingBox()

    expect((after?.x ?? 0) - (before?.x ?? 0)).toBeCloseTo(40, 0)
    expect((after?.y ?? 0) - (before?.y ?? 0)).toBeCloseTo(25, 0)
  })

  test('is twice the radius across, so it covers what the stroke will', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: '100%', exact: true }).click()
    await page.getByRole('slider', { name: '太さ' }).fill('20')
    await hoverCentre(page)

    // Radius 20 at 100% zoom is a 40px circle.
    expect((await ring(page).boundingBox())?.width).toBeCloseTo(40, 0)
  })

  test('grows with the zoom, because the brush is measured in image pixels', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: '100%', exact: true }).click()
    await page.getByRole('slider', { name: '太さ' }).fill('20')
    await hoverCentre(page)
    const at100 = (await ring(page).boundingBox())?.width ?? 0

    await page.getByRole('button', { name: '200%', exact: true }).click()
    await hoverCentre(page)
    const at200 = (await ring(page).boundingBox())?.width ?? 0

    expect(at200).toBeCloseTo(at100 * 2, 0)
  })

  test('does not swallow the stroke it is drawn over', async ({ page }) => {
    await open(page)
    const at = await hoverCentre(page)
    await page.mouse.down()
    await page.mouse.move(at.x + 20, at.y, { steps: 6 })
    await page.mouse.up()

    await expect(page.getByRole('button', { name: '取り消す' })).toBeEnabled()
  })
})
