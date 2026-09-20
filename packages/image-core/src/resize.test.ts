import { describe, expect, test } from 'bun:test'
import { resampleRgba } from './resize.ts'

/** Builds an RGBA buffer whose red channel is set per pixel from `reds`. */
const reds = (values: readonly number[]): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(values.length * 4)
  values.forEach((value, i) => {
    rgba[i * 4] = value
    rgba[i * 4 + 3] = 255
  })
  return rgba
}

describe('resampleRgba', () => {
  test('copies when the size already matches', () => {
    const source = reds([1, 2, 3, 4])
    const out = resampleRgba(source, { width: 2, height: 2 }, { width: 2, height: 2 })
    expect(Array.from(out)).toEqual(Array.from(source))
    expect(out).not.toBe(source)
  })

  test('keeps the corner pixels when scaling up', () => {
    const out = resampleRgba(
      reds([10, 20, 30, 40]),
      { width: 2, height: 2 },
      {
        width: 8,
        height: 8,
      },
    )
    expect(out[0]).toBe(10)
    expect(out[(7 * 8 + 7) * 4]).toBe(40)
  })

  test('interpolates instead of stair-stepping', () => {
    const out = resampleRgba(reds([0, 255]), { width: 2, height: 1 }, { width: 4, height: 1 })
    const second = out[4] ?? 0
    expect(second).toBeGreaterThan(0)
    expect(second).toBeLessThan(255)
  })

  test('averages when scaling down a flat image', () => {
    const out = resampleRgba(
      reds(Array.from({ length: 16 }, () => 128)),
      {
        width: 4,
        height: 4,
      },
      { width: 2, height: 2 },
    )
    expect(Array.from(out.filter((_, i) => i % 4 === 0))).toEqual([128, 128, 128, 128])
  })

  test('carries the alpha channel through', () => {
    const source = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255])
    const out = resampleRgba(source, { width: 2, height: 1 }, { width: 2, height: 1 })
    expect(out[3]).toBe(0)
    expect(out[7]).toBe(255)
  })

  test('handles a non-square target', () => {
    const out = resampleRgba(
      reds([1, 2, 3, 4]),
      { width: 2, height: 2 },
      {
        width: 1024,
        height: 1024,
      },
    )
    expect(out.length).toBe(1024 * 1024 * 4)
  })
})
