import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What ends up behind the cut-out.
 *
 * Read off the exported file: a backdrop that only exists in the preview is
 * the Preview/Export split failing, which is the thing that split exists to
 * catch (kirily-design.md §16).
 */
const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

const open = async (page: Page): Promise<void> => {
  await page.goto('/editor')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()
  await page.getByRole('button', { name: '背景をきりり' }).click()
  await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({ timeout: 300_000 })
}

type Corner = { r: number; g: number; b: number; a: number }

const cornerOfExport = async (page: Page): Promise<Corner> => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /で書き出す/ }).click()
  const path = await (await download).path()
  const read = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (context === null) return null
      context.drawImage(bitmap, 0, 0)
      const [r, g, b, a] = context.getImageData(1, 1, 1, 1).data
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 0 }
    },
    Array.from(await readFile(path)),
  )
  expect(read).not.toBeNull()
  return read ?? { r: 0, g: 0, b: 0, a: 0 }
}

/** A solid blue PNG, written where a file input can pick it up. */
const bluePng = async (page: Page): Promise<string> => {
  const encoded = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 64)
    const context = canvas.getContext('2d')
    if (context === null) return ''
    context.fillStyle = '#0000ff'
    context.fillRect(0, 0, 64, 64)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const value of bytes) binary += String.fromCharCode(value)
    return btoa(binary)
  })
  const directory = await mkdtemp(join(tmpdir(), 'kirily-backdrop-'))
  const path = join(directory, 'blue.png')
  await writeFile(path, Buffer.from(encoded, 'base64'))
  return path
}

test.describe('backdrop', () => {
  test('nothing behind leaves the transparency alone', async ({ page }) => {
    test.slow()
    await open(page)
    expect((await cornerOfExport(page)).a).toBeLessThan(32)
  })

  test('a colour behind reaches a PNG, which could have kept the alpha', async ({ page }) => {
    test.slow()
    await open(page)
    await page.getByRole('button', { name: '色', exact: true }).click()
    await page.getByRole('button', { name: '黒', exact: true }).click()

    const corner = await cornerOfExport(page)
    expect(corner.a).toBe(255)
    expect(corner.r).toBeLessThan(32)
  })

  test('a picture behind reaches the file', async ({ page }) => {
    test.slow()
    await open(page)
    await page.getByRole('button', { name: '画像', exact: true }).click()
    await page.getByLabel(/画像を選ぶ|画像を変える/).setInputFiles(await bluePng(page))

    const corner = await cornerOfExport(page)
    expect(corner.a).toBe(255)
    expect(corner.b).toBeGreaterThan(200)
    expect(corner.r).toBeLessThan(64)
  })

  test('JPEG is not offered a transparency it cannot keep', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('button', { name: 'なし', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'JPEG', exact: true }).click()
    await expect(page.getByRole('button', { name: 'なし', exact: true })).toBeHidden()
  })
})
