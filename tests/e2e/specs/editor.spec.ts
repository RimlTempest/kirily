import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The vertical slice, end to end (kirily-design.md §31): open an image, remove
 * the background, correct it by hand, undo, export at the original resolution.
 *
 * It runs on both the desktop and the mobile project, because a mobile layout
 * that cannot complete this flow is a broken product, not a smaller one.
 */

const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

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

  await page.getByRole('button', { name: '背景をきりり' }).click()
  await expect(undo).toBeEnabled()

  await undo.click()
  await expect(undo).toBeDisabled()
  await expect(page.getByRole('button', { name: 'やり直す' })).toBeEnabled()
})

test('a brush stroke is one undo step', async ({ page }) => {
  await openImage(page)
  const canvas = page.getByLabel('編集中の画像')
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect(page.getByRole('button', { name: '取り消す' })).toBeEnabled()
})

test('export produces a PNG named after the source file', async ({ page }) => {
  await openImage(page)
  await page.getByRole('button', { name: '背景をきりり' }).click()

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
