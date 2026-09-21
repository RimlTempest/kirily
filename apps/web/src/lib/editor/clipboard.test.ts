import { describe, expect, test } from 'bun:test'
import type { PastedItem } from './clipboard.ts'
import { imageFrom } from './clipboard.ts'

const item = (kind: string, type: string, file: File | null): PastedItem => ({
  kind,
  type,
  getAsFile: () => file,
})

const png = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
const gif = new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' })

describe('imageFrom', () => {
  test('takes the first image the editor can open', () => {
    expect(imageFrom([item('file', 'image/png', png)])).toBe(png)
  })

  test('skips the text a screenshot is usually pasted alongside', () => {
    expect(imageFrom([item('string', 'text/plain', null), item('file', 'image/png', png)])).toBe(
      png,
    )
  })

  test('ignores an image format the editor does not open', () => {
    expect(imageFrom([item('file', 'image/gif', gif)])).toBeNull()
  })

  test('is null when the paste carries no file at all', () => {
    expect(imageFrom([item('string', 'text/html', null)])).toBeNull()
  })

  test('is null when the item claims a file and has none', () => {
    expect(imageFrom([item('file', 'image/png', null)])).toBeNull()
  })
})
