import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { imageRect, pointOnImage } from './canvas.ts'

/**
 * Moving things.
 *
 * Three layers can move and they are three different answers: the view, the
 * cut-out, and the picture behind it. Read off the exported file, because a
 * move that only happens in the preview is the split failing.
 */
const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))
const SIZE = 120

const open = async (page: Page): Promise<void> => {
  await page.goto('/editor')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()
  await page.getByRole('button', { name: '背景をきりり' }).click()
  await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({ timeout: 300_000 })
}

/** Where the opaque pixels are, as a centre of mass. */
const centreOfSubject = async (page: Page): Promise<{ x: number; y: number }> => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /で書き出す/ }).click()
  const path = await (await download).path()
  const found = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (context === null) return null
      context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      let sumX = 0
      let sumY = 0
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) < 128) continue
        const pixel = i / 4
        sumX += pixel % bitmap.width
        sumY += Math.floor(pixel / bitmap.width)
        count += 1
      }
      return count === 0 ? null : { x: sumX / count, y: sumY / count }
    },
    Array.from(await readFile(path)),
  )
  expect(found).not.toBeNull()
  return found ?? { x: 0, y: 0 }
}

const drag = async (page: Page, dx: number, dy: number): Promise<void> => {
  const rect = await imageRect(page, SIZE)
  expect(rect).not.toBeNull()
  if (rect === null) return
  const from = pointOnImage(rect, 0.5, 0.5)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 })
  await page.mouse.up()
}

test.describe('moving', () => {
  test('the pan tool is there to be picked', async ({ page }) => {
    await page.goto('/editor')
    await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
    await expect(page.getByRole('button', { name: '手のひら' })).toBeVisible()
  })

  test('panning moves the view and not the file', async ({ page }) => {
    test.slow()
    await open(page)
    const before = await centreOfSubject(page)

    await page.getByRole('button', { name: '手のひら' }).click()
    await drag(page, 40, 0)

    const after = await centreOfSubject(page)
    expect(after.x).toBeCloseTo(before.x, 0)
  })

  test('dragging the cut-out moves it in the file', async ({ page }) => {
    test.slow()
    await open(page)
    const before = await centreOfSubject(page)

    await page.getByRole('button', { name: '被写体を動かす' }).click()
    await drag(page, 24, 0)

    const after = await centreOfSubject(page)
    expect(after.x).toBeGreaterThan(before.x + 4)
    expect(after.y).toBeCloseTo(before.y, 0)
  })
})
