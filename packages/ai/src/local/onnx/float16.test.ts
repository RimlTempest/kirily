import { describe, expect, test } from 'bun:test'
import { decodeFloat16Array, encodeFloat16Array, fromFloat16, toFloat16 } from './float16.ts'

describe('float16', () => {
  test.each([0, 1, -1, 0.5, -0.5, 2, 1024, -1024, 0.0001220703125])(
    'round-trips %p exactly',
    (value) => {
      expect(fromFloat16(toFloat16(value))).toBe(value)
    },
  )

  test('round-trips the normalised pixel range closely enough', () => {
    // Inputs after ImageNet normalisation sit roughly in −2.2..2.7.
    for (let raw = -2.5; raw <= 2.5; raw += 0.01) {
      const back = fromFloat16(toFloat16(raw))
      expect(Math.abs(back - raw)).toBeLessThan(0.002)
    }
  })

  test('keeps the sign of zero', () => {
    expect(Object.is(fromFloat16(toFloat16(-0)), -0)).toBe(true)
  })

  test('saturates values beyond the half range to infinity', () => {
    expect(fromFloat16(toFloat16(1e6))).toBe(Infinity)
    expect(fromFloat16(toFloat16(-1e6))).toBe(-Infinity)
  })

  test('flushes a value far below the subnormal range to zero', () => {
    expect(fromFloat16(toFloat16(1e-12))).toBe(0)
  })

  test('preserves infinity and NaN', () => {
    expect(fromFloat16(toFloat16(Infinity))).toBe(Infinity)
    expect(Number.isNaN(fromFloat16(toFloat16(NaN)))).toBe(true)
  })

  test('represents subnormals rather than dropping them', () => {
    const smallest = 2 ** -24 // smallest positive half subnormal
    expect(fromFloat16(toFloat16(smallest))).toBe(smallest)
  })

  test('converts arrays in both directions', () => {
    const original = new Float32Array([0, 0.25, -0.5, 3])
    const decoded = decodeFloat16Array(encodeFloat16Array(original))
    expect(Array.from(decoded)).toEqual([0, 0.25, -0.5, 3])
  })
})
