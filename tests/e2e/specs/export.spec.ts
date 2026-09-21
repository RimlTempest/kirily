import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * What each format actually writes.
 *
 * The pipeline has encoded all three since the beginning, but only PNG had a
 * button, so nothing had ever checked that a WebP keeps its transparency or
 * that a JPEG puts the chosen colour where the transparency was. The magic
 * bytes and the decoded corner are what say so.
 */
const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

const open = async (page: Page): Promise<void> => {
  await page.goto('/editor')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()
  await page.getByRole('button', { name: '背景をきりり' }).click()
  await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({
    timeout: 300_000,
  })
}

type Written = {
  readonly name: string
  readonly bytes: number
  readonly head: string
  readonly corner: readonly [number, number, number, number]
  readonly centre: readonly [number, number, number, number]
}

const writeAndRead = async (page: Page, button: string): Promise<Written> => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: button }).click()
  const file = await download
  const path = await file.path()
  const bytes = await readFile(path)

  const decoded = await page.evaluate(async (input) => {
    const blob = new Blob([new Uint8Array(input)])
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.drawImage(bitmap, 0, 0)
    const at = (x: number, y: number): number[] => [...context.getImageData(x, y, 1, 1).data]
    return {
      corner: at(1, 1),
      centre: at(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2)),
    }
  }, Array.from(bytes))

  expect(decoded).not.toBeNull()
  return {
    name: file.suggestedFilename(),
    bytes: bytes.length,
    // Enough of the header to tell the three apart.
    head: bytes.subarray(0, 12).toString('hex'),
    corner: [
      decoded?.corner[0] ?? 0,
      decoded?.corner[1] ?? 0,
      decoded?.corner[2] ?? 0,
      decoded?.corner[3] ?? 0,
    ],
    centre: [
      decoded?.centre[0] ?? 0,
      decoded?.centre[1] ?? 0,
      decoded?.centre[2] ?? 0,
      decoded?.centre[3] ?? 0,
    ],
  }
}

test.describe('export formats', () => {
  test('PNG keeps the transparency', async ({ page }) => {
    await open(page)
    const written = await writeAndRead(page, 'PNG で書き出す')
    expect(written.head.startsWith('89504e47')).toBe(true)
    expect(written.name.endsWith('.png')).toBe(true)
    expect(written.corner[3]).toBeLessThan(32)
  })

  test('WebP keeps the transparency too', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'WebP', exact: true }).click()
    const written = await writeAndRead(page, 'WebP で書き出す')
    // RIFF....WEBP
    expect(written.head.startsWith('52494646')).toBe(true)
    expect(written.head.slice(16, 24)).toBe('57454250')
    expect(written.name.endsWith('.webp')).toBe(true)
    expect(written.corner[3]).toBeLessThan(32)
  })

  test('JPEG puts the chosen colour where the transparency was', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'JPEG', exact: true }).click()
    await page.getByRole('button', { name: '黒', exact: true }).click()

    const written = await writeAndRead(page, 'JPEG で書き出す')
    expect(written.head.startsWith('ffd8ff')).toBe(true)
    expect(written.name.endsWith('.jpg')).toBe(true)
    // Opaque everywhere, and the removed background is now black, not white.
    expect(written.corner[3]).toBe(255)
    expect(written.corner[0]).toBeLessThan(32)
    expect(written.centre[0]).toBeGreaterThan(128)
  })

  test('the quality slider changes how big the file is', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'JPEG', exact: true }).click()

    const slider = page.getByRole('slider', { name: '品質' })
    await slider.fill('100')
    const best = await writeAndRead(page, 'JPEG で書き出す')
    await slider.fill('20')
    const worst = await writeAndRead(page, 'JPEG で書き出す')

    // Both are JPEGs of the same picture; only the quality moved, so the
    // only thing that can differ is how many bytes it took.
    expect(best.head.startsWith('ffd8ff')).toBe(true)
    expect(worst.head.startsWith('ffd8ff')).toBe(true)
    expect(best.bytes).toBeGreaterThan(worst.bytes)
  })

  test('the option that does not apply is not shown', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('slider', { name: '品質' })).toBeHidden()
    await expect(page.getByRole('group', { name: '透明部分の色' })).toBeHidden()

    await page.getByRole('button', { name: 'WebP', exact: true }).click()
    await expect(page.getByRole('slider', { name: '品質' })).toBeVisible()
    await expect(page.getByRole('group', { name: '透明部分の色' })).toBeHidden()

    await page.getByRole('button', { name: 'JPEG', exact: true }).click()
    await expect(page.getByRole('group', { name: '透明部分の色' })).toBeVisible()
  })
})
