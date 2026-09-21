import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alphaOnImage, imageRect, pointOnImage, settled } from './canvas.ts'

/**
 * Turning the view.
 *
 * A view setting, like the zoom: it exists because a wide photograph on a tall
 * phone is fitted small and hard to paint on, and the export never sees it
 * (ADR-0027).
 */
const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))
const SIZE = 120

const open = async (page: Page): Promise<void> => {
  await page.goto('/editor')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()
}

const rotate = (page: Page) => page.getByRole('button', { name: '表示を回す' })

/** A landscape image that does not fit a phone, written where an input can take it. */
const widePng = async (page: Page): Promise<string> => {
  const encoded = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1200, 400)
    const context = canvas.getContext('2d')
    if (context === null) return ''
    context.fillStyle = '#f8f8f6'
    context.fillRect(0, 0, 1200, 400)
    context.fillStyle = '#c83c32'
    context.fillRect(400, 100, 400, 200)
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    )
    let binary = ''
    for (const value of bytes) binary += String.fromCharCode(value)
    return btoa(binary)
  })
  const directory = await mkdtemp(join(tmpdir(), 'kirily-rotate-'))
  const path = join(directory, 'wide.png')
  await writeFile(path, Buffer.from(encoded, 'base64'))
  return path
}

/** Width and height of the written file, from the PNG header. */
const exportedSize = async (page: Page): Promise<{ width: number; height: number }> => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /で書き出す/ }).click()
  const bytes = await readFile(await (await download).path())
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

test.describe('turning the view', () => {
  test('cycles a quarter at a time and says where it is', async ({ page }) => {
    await open(page)
    await expect(rotate(page)).toHaveText('↻')
    await rotate(page).click()
    await expect(rotate(page)).toHaveText('↻ 90°')
    await rotate(page).click()
    await expect(rotate(page)).toHaveText('↻ 180°')
    await rotate(page).click()
    await rotate(page).click()
    await expect(rotate(page)).toHaveText('↻')
  })

  /**
   * The reason the feature exists. A landscape image in a portrait frame is
   * fitted by its width; turned, it is fitted by its height and gets larger.
   *
   * Wider than the frame on purpose: the fit never enlarges past 100%, so an
   * image that already fits gains nothing from being turned. The square
   * fixture the other tests use is exactly that case.
   */
  test('a wide image gets bigger on a tall screen', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 900 })
    await page.goto('/editor')
    await page.getByLabel('編集する画像を選ぶ').setInputFiles(await widePng(page))
    await expect(page.getByLabel('編集中の画像')).toBeVisible()
    await settled(page)

    const before = await page.getByLabel('現在の倍率').textContent()
    await rotate(page).click()
    await settled(page)
    const after = await page.getByLabel('現在の倍率').textContent()

    expect(Number((after ?? '0').replace('%', ''))).toBeGreaterThan(
      Number((before ?? '0').replace('%', '')),
    )
  })

  /**
   * The bug this whole coordinate module exists to prevent, now with one more
   * transform in the chain.
   */
  test('a stroke lands where the pointer is, not a quarter away', async ({ page }) => {
    await open(page)
    await rotate(page).click()
    await settled(page)

    const rect = await imageRect(page, SIZE)
    expect(rect).not.toBeNull()
    if (rect === null) return

    // A quarter of the way across the frame, and well down it: a point that
    // moves if the turn is applied in the wrong direction.
    const at = pointOnImage(rect, 0.25, 0.75)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + 4, at.y + 4, { steps: 4 })
    await page.mouse.up()

    const alpha = await page.evaluate(
      async ([x, y]) => {
        const canvas = document.querySelector('canvas')
        if (!(canvas instanceof HTMLCanvasElement)) return -1
        const bitmap = await createImageBitmap(canvas)
        const copy = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = copy.getContext('2d', { willReadFrequently: true })
        if (context === null) return -1
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(Math.round(x ?? 0), Math.round(y ?? 0), 1, 1).data[3] ?? -1
      },
      await (async () => {
        const box = await page.getByLabel('編集中の画像').boundingBox()
        return [at.x - (box?.x ?? 0), at.y - (box?.y ?? 0)]
      })(),
    )

    // The brush removes, so where it landed is now transparent.
    expect(alpha).toBeLessThan(128)
  })

  test('the written file is the same size however the view is turned', async ({ page }) => {
    test.slow()
    await open(page)
    const upright = await exportedSize(page)
    expect(upright).toEqual({ width: SIZE, height: SIZE })

    await rotate(page).click()
    await settled(page)
    expect(await exportedSize(page)).toEqual(upright)
  })

  test('a turned view still paints on the right pixels of the file', async ({ page }) => {
    test.slow()
    await open(page)
    await page.getByRole('button', { name: '背景をきりり' }).click()
    await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({
      timeout: 300_000,
    })

    await rotate(page).click()
    await settled(page)

    // The subject is still the subject and the corner is still the corner,
    // read through the turned view.
    const alpha = await alphaOnImage(page, SIZE, { corner: [0.03, 0.03], centre: [0.5, 0.5] })
    expect(alpha['corner']).toBeLessThan(32)
    expect(alpha['centre']).toBeGreaterThan(223)
  })
})
