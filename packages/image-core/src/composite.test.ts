import { describe, expect, test } from 'bun:test'
import { applyAlphaMask, cropRgba, flattenOnto, WHITE } from './composite.ts'

describe('applyAlphaMask', () => {
  test('writes alpha and keeps colour', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])
    applyAlphaMask(rgba, new Uint8Array([0, 128]), { width: 2, height: 1 })
    expect([...rgba]).toEqual([10, 20, 30, 0, 40, 50, 60, 128])
  })

  test('rejects a mask from a different image', () => {
    const rgba = new Uint8ClampedArray(8)
    const result = applyAlphaMask(rgba, new Uint8Array(3), { width: 2, height: 1 })
    expect(result.ok).toBe(false)
  })
})

/** 3x2 pixels whose red channel is the pixel index, so a copy is checkable. */
const source = (): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(3 * 2 * 4)
  for (let i = 0; i < 6; i++) rgba[i * 4] = i
  return rgba
}

describe('cropRgba', () => {
  const size = { width: 3, height: 2 }

  test('copies the requested rectangle', () => {
    const out = new Uint8ClampedArray(2 * 2 * 4)
    cropRgba(source(), size, { x: 1, y: 0, width: 2, height: 2 }, out)
    expect([out[0], out[4], out[8], out[12]]).toEqual([1, 2, 4, 5])
  })

  test('rejects a rectangle that leaves the image', () => {
    const out = new Uint8ClampedArray(2 * 2 * 4)
    const result = cropRgba(source(), size, { x: 2, y: 0, width: 2, height: 2 }, out)
    expect(result.ok).toBe(false)
  })

  test('rejects an output buffer of the wrong size', () => {
    const out = new Uint8ClampedArray(4)
    const result = cropRgba(source(), size, { x: 0, y: 0, width: 2, height: 2 }, out)
    expect(result.ok).toBe(false)
  })
})

describe('flattenOnto', () => {
  test('matches the Rust implementation', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128])
    flattenOnto(rgba, { width: 3, height: 1 }, WHITE)

    expect(Array.from(rgba.slice(0, 4))).toEqual([255, 255, 255, 255])
    expect(Array.from(rgba.slice(4, 8))).toEqual([0, 0, 0, 255])
    expect(rgba[8]).toBe(127)
    expect(rgba[11]).toBe(255)
  })
})
