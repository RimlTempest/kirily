import { describe, expect, test } from 'bun:test'
import { BACKGROUND_FIELD, FOREGROUND_FIELD, estimateField, sampleField } from './field.ts'

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

describe('estimateField', () => {
  test('reports the background colour everywhere when it is flat', () => {
    const { rgba, mask } = flat(64, 64, [10, 20, 30])
    const field = estimateField(rgba, { width: 64, height: 64 }, mask, {
      ...BACKGROUND_FIELD,
      cell: 16,
    })
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
    const field = estimateField(rgba, { width: 64, height: 64 }, mask, {
      ...BACKGROUND_FIELD,
      cell: 16,
    })
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
    const field = estimateField(rgba, { width: 64, height: 64 }, mask, {
      ...BACKGROUND_FIELD,
      cell: 16,
    })
    expect([field.rgb[3], field.rgb[4], field.rgb[5]]).toEqual([200, 100, 50])
  })

  test('falls back to mid grey when the whole image is subject', () => {
    const { rgba, mask } = flat(32, 32, [200, 100, 50])
    mask.fill(255)
    const field = estimateField(rgba, { width: 32, height: 32 }, mask, {
      ...BACKGROUND_FIELD,
      cell: 16,
    })
    expect([field.rgb[0], field.rgb[1], field.rgb[2]]).toEqual([128, 128, 128])
  })
})

describe('sampleField', () => {
  const field = {
    cell: 16,
    width: 2,
    height: 1,
    rgb: new Uint8Array([0, 0, 0, 100, 100, 100]),
  }

  test('reads a cell centre as that cell', () => {
    expect(sampleField(field, 8, 8)).toEqual([0, 0, 0])
    expect(sampleField(field, 24, 8)).toEqual([100, 100, 100])
  })

  test('interpolates between cell centres instead of stepping', () => {
    expect(sampleField(field, 16, 8)).toEqual([50, 50, 50])
  })

  test('holds the edge colour outside the outermost centres', () => {
    expect(sampleField(field, 0, 0)).toEqual([0, 0, 0])
    expect(sampleField(field, 31, 15)).toEqual([100, 100, 100])
  })
})

describe('estimateField on the foreground', () => {
  test('measures the subject rather than the background', () => {
    const { rgba, mask } = flat(64, 64, [0, 0, 0])
    // A subject block in the middle, in its own colour.
    for (let y = 16; y < 48; y += 1) {
      for (let x = 16; x < 48; x += 1) {
        mask[y * 64 + x] = 255
        rgba[(y * 64 + x) * 4] = 200
        rgba[(y * 64 + x) * 4 + 1] = 100
        rgba[(y * 64 + x) * 4 + 2] = 50
      }
    }
    const field = estimateField(rgba, { width: 64, height: 64 }, mask, {
      ...FOREGROUND_FIELD,
      cell: 16,
    })
    expect(sampleField(field, 32, 32)).toEqual([200, 100, 50])
  })

  test('borrows the subject colour into cells that saw only background', () => {
    const { rgba, mask } = flat(64, 64, [0, 0, 0])
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        mask[y * 64 + x] = 255
        rgba[(y * 64 + x) * 4] = 180
      }
    }
    const field = estimateField(rgba, { width: 64, height: 64 }, mask, {
      ...FOREGROUND_FIELD,
      cell: 16,
    })
    expect(sampleField(field, 56, 32)[0]).toBe(180)
  })
})
