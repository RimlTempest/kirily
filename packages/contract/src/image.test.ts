import { describe, expect, test } from 'bun:test'
import { KirilyErrorCode } from './error.ts'
import { describeSource, exportFileName, isSupportedMimeType } from './image.ts'

const validInput = {
  width: 1200,
  height: 800,
  mimeType: 'image/png',
  fileName: 'cat.png',
  fileSize: 1024,
}

describe('describeSource', () => {
  test('accepts a supported image', () => {
    const result = describeSource(validInput)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.width).toBe(1200)
    expect(result.value.mimeType).toBe('image/png')
  })

  test('rejects a format the MVP cannot decode', () => {
    const result = describeSource({ ...validInput, mimeType: 'image/gif' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(KirilyErrorCode.UnsupportedFormat)
  })

  test('rejects an image whose decoded size is nonsense', () => {
    const result = describeSource({ ...validInput, width: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(KirilyErrorCode.ImageDecodeFailed)
  })

  test('rejects an image too large to edit in a tab', () => {
    const result = describeSource({ ...validInput, width: 12000, height: 9000 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(KirilyErrorCode.ImageTooLarge)
  })

  test('accepts an image exactly at the limit', () => {
    const result = describeSource({ ...validInput, width: 10000, height: 5000 })
    expect(result.ok).toBe(true)
  })
})

describe('isSupportedMimeType', () => {
  test.each([
    ['image/png', true],
    ['image/jpeg', true],
    ['image/webp', true],
    ['image/gif', false],
    ['text/html', false],
  ])('%s → %s', (value, expected) => {
    expect(isSupportedMimeType(value)).toBe(expected)
  })
})

describe('exportFileName', () => {
  test('replaces the extension and marks the file as Kirily output', () => {
    expect(exportFileName('cat.jpg', 'png')).toBe('cat-kirily.png')
  })

  test('keeps dots inside the name', () => {
    expect(exportFileName('holiday.2026.summer.webp', 'webp')).toBe(
      'holiday.2026.summer-kirily.webp',
    )
  })

  test('strips path separators so the name cannot escape the download folder', () => {
    expect(exportFileName('../../etc/passwd.png', 'png')).toBe('etcpasswd-kirily.png')
  })

  test('falls back when nothing usable is left', () => {
    expect(exportFileName('/.png', 'png')).toBe('image-kirily.png')
  })
})
