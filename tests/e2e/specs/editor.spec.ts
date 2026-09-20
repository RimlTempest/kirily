import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { alphaOnImage, imageRect, pointOnImage } from './canvas.ts'

/** Alpha of the composited canvas directly under a page-space point. */
const alphaUnderPointer = async (page: Page, point: { x: number; y: number }): Promise<number> => {
  const box = await page.getByLabel('編集中の画像').boundingBox()
  if (box === null) return 0
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('canvas')
      if (!(canvas instanceof HTMLCanvasElement)) return 0
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) return 0
      return context.getImageData(Math.round(x), Math.round(y), 1, 1).data[3] ?? 0
    },
    { x: point.x - box.x, y: point.y - box.y },
  )
}

/**
 * The vertical slice, end to end (kirily-design.md §31): open an image, remove
 * the background, correct it by hand, undo, export at the original resolution.
 *
 * It runs on both the desktop and the mobile project, because a mobile layout
 * that cannot complete this flow is a broken product, not a smaller one.
 */

const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

/**
 * Waits for background removal to finish.
 *
 * How long that takes depends entirely on which tier the device runs: the
 * small model is a second, the quality one downloads 170 MiB first. Waiting on
 * the status line rather than a fixed timeout keeps the test honest on both.
 */
const removeBackground = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: '背景をきりり' }).click()
  await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({
    timeout: 300_000,
  })
}

const openImage = async (page: Page): Promise<void> => {
  await page.goto('/')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()
}

test('the editor opens an image and reports its original size', async ({ page }) => {
  await openImage(page)
  await expect(page.getByText('120 × 120')).toBeVisible()
})

test('the landing page promises browser-only processing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('サーバーへは送信されません')).toBeVisible()
})

test('background removal makes undo available, and undo takes it back', async ({ page }) => {
  await openImage(page)

  const undo = page.getByRole('button', { name: '取り消す' })
  await expect(undo).toBeDisabled()

  await removeBackground(page)
  await expect(undo).toBeEnabled()

  await undo.click()
  await expect(undo).toBeDisabled()
  await expect(page.getByRole('button', { name: 'やり直す' })).toBeEnabled()
})

test('a brush stroke is one undo step', async ({ page }) => {
  await openImage(page)
  const rect = await imageRect(page, 120)
  expect(rect).not.toBeNull()
  if (rect === null) return

  const start = pointOnImage(rect, 0.5, 0.5)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + rect.width * 0.15, start.y, { steps: 10 })
  await page.mouse.up()

  await expect(page.getByRole('button', { name: '取り消す' })).toBeEnabled()
})

test('the bucket takes a whole region in one click', async ({ page }) => {
  await openImage(page)

  const undo = page.getByRole('button', { name: '取り消す' })
  await expect(undo).toBeDisabled()

  await page.getByRole('button', { name: 'まとめて消す' }).click()
  // The tolerance slider replaces the brush width one for the bucket.
  await expect(page.getByLabel('色の幅')).toBeVisible()

  const rect = await imageRect(page, 120)
  expect(rect).not.toBeNull()
  if (rect === null) return

  // The fixture is a red square on white; near a corner is background.
  const corner = pointOnImage(rect, 0.05, 0.05)
  await page.mouse.click(corner.x, corner.y)

  await expect(undo).toBeEnabled()

  const alpha = await alphaOnImage(page, 120, {
    corner: [0.05, 0.05],
    centre: [0.5, 0.5],
  })

  // One click removed the whole background and left the subject alone.
  expect(alpha['corner']).toBeLessThan(32)
  expect(alpha['centre']).toBeGreaterThan(223)
})

test('a bucket fill is a single undo step', async ({ page }) => {
  await openImage(page)
  await page.getByRole('button', { name: 'まとめて消す' }).click()

  const rect = await imageRect(page, 120)
  if (rect === null) return
  const corner = pointOnImage(rect, 0.05, 0.05)
  await page.mouse.click(corner.x, corner.y)

  const undo = page.getByRole('button', { name: '取り消す' })
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(undo).toBeDisabled()
})

test('zoom presets change the level, and 全体 brings it back', async ({ page }) => {
  await openImage(page)

  // The fixture is 120px in a much larger frame, so fitting it stops at 100%.
  await expect(page.getByLabel('現在の倍率')).toHaveText('100%')

  await page.getByRole('button', { name: '200%', exact: true }).click()
  await expect(page.getByRole('button', { name: '200%', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByRole('button', { name: '全体' }).click()
  await expect(page.getByRole('button', { name: '100%', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the wheel zooms around the pointer, not the corner', async ({ page }) => {
  await openImage(page)
  const rect = await imageRect(page, 120)
  expect(rect).not.toBeNull()
  if (rect === null) return

  // Put the pointer on the subject's top-left corner and zoom in. That corner
  // has to stay under the pointer, which is what makes a zoom aimable.
  const anchor = pointOnImage(rect, 0.25, 0.25)
  await page.mouse.move(anchor.x, anchor.y)

  const before = await alphaUnderPointer(page, anchor)
  await page.mouse.wheel(0, -600)
  await expect(page.getByLabel('現在の倍率')).not.toHaveText('100%')
  const after = await alphaUnderPointer(page, anchor)

  expect(after).toBe(before)
})

test('painting lands where the pointer is, even when zoomed in', async ({ page }) => {
  await openImage(page)

  await page.getByRole('button', { name: '200%', exact: true }).click()
  const rect = await imageRect(page, 120)
  if (rect === null) return

  // Zoomed to 200%, the image is twice the fitted size and still centred.
  const box = await page.getByLabel('編集中の画像').boundingBox()
  if (box === null) return
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + 30, centre.y, { steps: 8 })
  await page.mouse.up()

  // The stroke removed part of the subject at the centre of the view.
  const alpha = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return null
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return null
    return context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1)
      .data[3]
  })

  expect(alpha).toBeLessThan(128)
})

test('cropping changes what the export writes, at the original resolution', async ({ page }) => {
  await openImage(page)
  await page.getByRole('button', { name: 'トリミング' }).click()

  // The tool opens with the whole image selected, so the handles are at the
  // image's corners.
  const rect = await imageRect(page, 120)
  expect(rect).not.toBeNull()
  if (rect === null) return

  const from = pointOnImage(rect, 1, 1)
  const to = pointOnImage(rect, 0.5, 0.5)
  await page.mouse.move(from.x - 2, from.y - 2)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG で書き出す' }).click()
  const file = await download

  const bytes = await readFile(await file.path())
  // Still a PNG, and now roughly half the image in each direction — the crop
  // is applied to the original pixels, not to what was on screen.
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  expect(width).toBeGreaterThan(40)
  expect(width).toBeLessThan(90)
  expect(height).toBe(width)
})

test('an aspect preset locks the crop to that shape', async ({ page }) => {
  await openImage(page)
  await page.getByRole('button', { name: 'トリミング' }).click()
  await page.getByRole('button', { name: '16:9', exact: true }).click()

  const rect = await imageRect(page, 120)
  if (rect === null) return
  const from = pointOnImage(rect, 1, 1)
  const to = pointOnImage(rect, 0.4, 0.4)
  await page.mouse.move(from.x - 2, from.y - 2)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG で書き出す' }).click()
  const bytes = await readFile(await (await download).path())

  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  expect(width / height).toBeCloseTo(16 / 9, 1)
})

test('export produces a PNG named after the source file', async ({ page }) => {
  await openImage(page)
  await removeBackground(page)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG で書き出す' }).click()
  const file = await download

  expect(file.suggestedFilename()).toBe('subject-on-white-kirily.png')

  // The export must be the *original* resolution, not the preview's.
  const path = await file.path()
  const bytes = readFileSync(path)
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(bytes.readUInt32BE(16)).toBe(120)
  expect(bytes.readUInt32BE(20)).toBe(120)
})
