import { describe, expect, test } from 'bun:test'
import { KirilyErrorCode } from '@kirily/contract/error'
import { err, ok } from '@kirily/contract/result'
import { decontaminate, estimateBackground, sampleBackground, unmix } from './decontaminate.ts'

/** An image of one colour, with a mask that calls all of it background. */
const flat = (
  width: number,
  height: number,
  colour: readonly [number, number, number],
): { rgba: Uint8ClampedArray; mask: Uint8Array } => {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = colour[0]
    rgba[i * 4 + 1] = colour[1]
    rgba[i * 4 + 2] = colour[2]
    rgba[i * 4 + 3] = 255
  }
  return { rgba, mask: new Uint8Array(width * height) }
}

describe('estimateBackground', () => {
  test('reports the background colour everywhere when it is flat', () => {
    const { rgba, mask } = flat(64, 64, [10, 20, 30])
    const field = estimateBackground(rgba, { width: 64, height: 64 }, mask, 16)
    expect(field.width).toBe(4)
    expect(field.height).toBe(4)
    for (let i = 0; i < field.width * field.height; i += 1) {
      expect([field.rgb[i * 3], field.rgb[i * 3 + 1], field.rgb[i * 3 + 2]]).toEqual([10, 20, 30])
    }
  })

  test('follows a gradient down the image instead of averaging it away', () => {
    const { rgba, mask } = flat(64, 64, [0, 0, 0])
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) rgba[(y * 64 + x) * 4] = y * 4
    }
    const field = estimateBackground(rgba, { width: 64, height: 64 }, mask, 16)
    const column = [0, 1, 2, 3].map((row) => field.rgb[row * field.width * 3] ?? 0)
    expect(column[0]).toBeLessThan(column[1] ?? 0)
    expect(column[1]).toBeLessThan(column[2] ?? 0)
    expect(column[2]).toBeLessThan(column[3] ?? 0)
  })

  /**
   * A cell buried inside the subject has no background to measure. Leaving it
   * black would paint a dark rim onto every edge that borders it.
   */
  test('borrows from the nearest cell that saw background when it saw none', () => {
    const { rgba, mask } = flat(64, 64, [200, 100, 50])
    // The middle two cell-columns are all subject.
    for (let y = 0; y < 64; y += 1) {
      for (let x = 16; x < 48; x += 1) mask[y * 64 + x] = 255
    }
    const field = estimateBackground(rgba, { width: 64, height: 64 }, mask, 16)
    expect([field.rgb[3], field.rgb[4], field.rgb[5]]).toEqual([200, 100, 50])
  })

  test('falls back to mid grey when the whole image is subject', () => {
    const { rgba, mask } = flat(32, 32, [200, 100, 50])
    mask.fill(255)
    const field = estimateBackground(rgba, { width: 32, height: 32 }, mask, 16)
    expect([field.rgb[0], field.rgb[1], field.rgb[2]]).toEqual([128, 128, 128])
  })
})

describe('sampleBackground', () => {
  const field = {
    cell: 16,
    width: 2,
    height: 1,
    rgb: new Uint8Array([0, 0, 0, 100, 100, 100]),
  }

  test('reads a cell centre as that cell', () => {
    expect(sampleBackground(field, 8, 8)).toEqual([0, 0, 0])
    expect(sampleBackground(field, 24, 8)).toEqual([100, 100, 100])
  })

  test('interpolates between cell centres instead of stepping', () => {
    expect(sampleBackground(field, 16, 8)).toEqual([50, 50, 50])
  })

  test('holds the edge colour outside the outermost centres', () => {
    expect(sampleBackground(field, 0, 0)).toEqual([0, 0, 0])
    expect(sampleBackground(field, 31, 15)).toEqual([100, 100, 100])
  })
})

describe('unmix', () => {
  test('recovers the colour that was mixed in', () => {
    // 255 over 0 at half coverage lands on 128.
    expect(unmix(128, 0, 128 / 255)).toBe(255)
  })

  test('clamps rather than overshooting when the alpha is small', () => {
    expect(unmix(200, 0, 0.05)).toBe(255)
    expect(unmix(10, 255, 0.05)).toBe(0)
  })
})

describe('decontaminate', () => {
  test('gives a half-covered pixel its own colour back', () => {
    const size = { width: 2, height: 1 }
    // Left: white subject at half coverage over black. Right: black background.
    const rgba = new Uint8ClampedArray([128, 128, 128, 255, 0, 0, 0, 255])
    const mask = new Uint8Array([128, 0])
    const field = estimateBackground(rgba, size, mask, 16)
    expect(decontaminate(rgba, mask, size, field)).toEqual(ok(undefined))
    expect([rgba[0], rgba[1], rgba[2]]).toEqual([255, 255, 255])
  })

  test('strips a white cast off a red subject at half coverage', () => {
    // Pure red at 50% over white reads as (255, 128, 128) on screen.
    const size = { width: 1, height: 1 }
    const rgba = new Uint8ClampedArray([255, 128, 128, 128])
    const field = { cell: 16, width: 1, height: 1, rgb: new Uint8Array([255, 255, 255]) }
    expect(decontaminate(rgba, new Uint8Array([128]), size, field)).toEqual(ok(undefined))
    expect(rgba[0]).toBe(255)
    expect(rgba[1]).toBeLessThanOrEqual(4)
    expect(rgba[2]).toBeLessThanOrEqual(4)
    expect(rgba[3]).toBe(128)
  })

  test('leaves pixels alone that were never mixed', () => {
    const size = { width: 3, height: 1 }
    const rgba = new Uint8ClampedArray([9, 9, 9, 255, 40, 50, 60, 255, 70, 80, 90, 255])
    const mask = new Uint8Array([255, 0, 128])
    const field = { cell: 16, width: 1, height: 1, rgb: new Uint8Array([0, 0, 0]) }
    expect(decontaminate(rgba, mask, size, field)).toEqual(ok(undefined))
    expect([rgba[0], rgba[1], rgba[2]]).toEqual([9, 9, 9])
    expect([rgba[4], rgba[5], rgba[6]]).toEqual([40, 50, 60])
  })

  const field = { cell: 16, width: 1, height: 1, rgb: new Uint8Array([0, 0, 0]) }
  const size = { width: 2, height: 1 }

  test('reports a mask that does not match the image', () => {
    expect(decontaminate(new Uint8ClampedArray(8), new Uint8Array(3), size, field)).toEqual(
      err({ code: KirilyErrorCode.SizeMismatch, detail: 'decontaminate: mask 3, expected 2' }),
    )
  })

  test('reports pixels that do not match the image', () => {
    expect(decontaminate(new Uint8ClampedArray(12), new Uint8Array(2), size, field)).toEqual(
      err({ code: KirilyErrorCode.SizeMismatch, detail: 'decontaminate: rgba 12, expected 8' }),
    )
  })
})
