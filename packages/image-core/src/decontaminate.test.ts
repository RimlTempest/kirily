import { describe, expect, test } from 'bun:test'
import { KirilyErrorCode } from '@kirily/contract/error'
import { err, ok } from '@kirily/contract/result'
import { decontaminate, unmix } from './decontaminate.ts'
import { BACKGROUND_FIELD, estimateField } from './field.ts'

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
    const field = estimateField(rgba, size, mask, { ...BACKGROUND_FIELD, cell: 16 })
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
