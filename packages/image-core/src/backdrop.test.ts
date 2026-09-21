import { describe, expect, test } from 'bun:test'
import type { Backdrop } from './backdrop.ts'
import { compositeBackdrop, coverTransform } from './backdrop.ts'

describe('coverTransform', () => {
  test('fills a square with a square without moving it', () => {
    expect(coverTransform({ width: 100, height: 100 }, { width: 50, height: 50 })).toEqual({
      scale: 2,
      offsetX: 0,
      offsetY: 0,
    })
  })

  test('crops the sides when the backdrop is wider than the frame', () => {
    // 200x50 into 100x100: scale by 2 to cover the height, then centre.
    const cover = coverTransform({ width: 100, height: 100 }, { width: 200, height: 50 })
    expect(cover.scale).toBe(2)
    expect(cover.offsetY).toBe(0)
    expect(cover.offsetX).toBe(-150)
  })

  test('crops the top and bottom when the backdrop is taller', () => {
    const cover = coverTransform({ width: 100, height: 100 }, { width: 50, height: 200 })
    expect(cover.scale).toBe(2)
    expect(cover.offsetX).toBe(0)
    expect(cover.offsetY).toBe(-150)
  })

  test('never leaves a gap, whatever the shapes', () => {
    for (const backdrop of [
      { width: 7, height: 300 },
      { width: 640, height: 11 },
      { width: 1, height: 1 },
    ]) {
      const frame = { width: 120, height: 90 }
      const cover = coverTransform(frame, backdrop)
      expect(backdrop.width * cover.scale + cover.offsetX).toBeGreaterThanOrEqual(
        frame.width - 1e-6,
      )
      expect(backdrop.height * cover.scale + cover.offsetY).toBeGreaterThanOrEqual(
        frame.height - 1e-6,
      )
      expect(cover.offsetX).toBeLessThanOrEqual(1e-6)
      expect(cover.offsetY).toBeLessThanOrEqual(1e-6)
    }
  })

  test('a backdrop with no pixels leaves the frame alone', () => {
    expect(coverTransform({ width: 100, height: 100 }, { width: 0, height: 5 })).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    })
  })
})

const solid = (
  width: number,
  height: number,
  colour: readonly [number, number, number],
  alpha = 255,
): Uint8ClampedArray<ArrayBuffer> => {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = colour[0]
    rgba[i * 4 + 1] = colour[1]
    rgba[i * 4 + 2] = colour[2]
    rgba[i * 4 + 3] = alpha
  }
  return rgba
}

describe('compositeBackdrop', () => {
  const size = { width: 4, height: 4 }

  test('shows through where the cut-out is transparent', () => {
    const target = solid(4, 4, [255, 0, 0], 0)
    const backdrop = { rgba: solid(4, 4, [0, 0, 255]), width: 4, height: 4 }
    compositeBackdrop(target, size, backdrop, { x: 0, y: 0 }, size)
    expect([target[0], target[1], target[2], target[3]]).toEqual([0, 0, 255, 255])
  })

  test('is hidden where the cut-out is opaque', () => {
    const target = solid(4, 4, [255, 0, 0])
    const backdrop = { rgba: solid(4, 4, [0, 0, 255]), width: 4, height: 4 }
    compositeBackdrop(target, size, backdrop, { x: 0, y: 0 }, size)
    expect([target[0], target[1], target[2], target[3]]).toEqual([255, 0, 0, 255])
  })

  test('mixes where the cut-out is half covered', () => {
    const target = solid(4, 4, [255, 255, 255], 128)
    const backdrop = { rgba: solid(4, 4, [0, 0, 0]), width: 4, height: 4 }
    compositeBackdrop(target, size, backdrop, { x: 0, y: 0 }, size)
    expect(target[0]).toBeGreaterThan(120)
    expect(target[0]).toBeLessThan(136)
    expect(target[3]).toBe(255)
  })

  test('leaves the result opaque everywhere, because a backdrop is a background', () => {
    const target = solid(4, 4, [255, 0, 0], 0)
    const backdrop = { rgba: solid(4, 4, [0, 0, 255]), width: 4, height: 4 }
    compositeBackdrop(target, size, backdrop, { x: 0, y: 0 }, size)
    for (let i = 3; i < target.length; i += 4) expect(target[i]).toBe(255)
  })

  test('reads the part of the backdrop the crop sits over', () => {
    // A backdrop whose left half is red and right half is green, and a crop
    // taking only the right half of the image.
    const backdrop = { rgba: solid(4, 4, [0, 0, 0]), width: 4, height: 4 }
    for (let y = 0; y < 4; y += 1) {
      for (let x = 2; x < 4; x += 1) backdrop.rgba[(y * 4 + x) * 4 + 1] = 255
    }
    const target = solid(2, 4, [0, 0, 0], 0)
    compositeBackdrop(
      target,
      { width: 2, height: 4 },
      backdrop,
      { x: 2, y: 0 },
      { width: 4, height: 4 },
    )
    expect(target[1]).toBe(255)
  })
})

describe('compositeBackdrop with the backdrop moved', () => {
  const size = { width: 4, height: 4 }
  /** Left half red, right half green. */
  const halves = (): Backdrop => {
    const rgba = solid(4, 4, [255, 0, 0])
    for (let y = 0; y < 4; y += 1) {
      for (let x = 2; x < 4; x += 1) {
        rgba[(y * 4 + x) * 4] = 0
        rgba[(y * 4 + x) * 4 + 1] = 255
      }
    }
    return { rgba, width: 4, height: 4 }
  }

  test('shows the other half once it has been dragged across', () => {
    const target = solid(4, 4, [0, 0, 0], 0)
    compositeBackdrop(target, size, halves(), { x: 0, y: 0 }, size, {
      offsetX: 2,
      offsetY: 0,
      scale: 1,
    })
    // The backdrop moved right by two, so its left edge now reads at x = 2.
    expect(target[0]).toBe(255)
    expect(target[(2 * 4 + 0) * 4]).toBe(255)
  })

  test('a move of zero and a scale of one is the framing it had', () => {
    const moved = solid(4, 4, [0, 0, 0], 0)
    const still = solid(4, 4, [0, 0, 0], 0)
    compositeBackdrop(moved, size, halves(), { x: 0, y: 0 }, size, {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    })
    compositeBackdrop(still, size, halves(), { x: 0, y: 0 }, size)
    expect([...moved]).toEqual([...still])
  })
})
