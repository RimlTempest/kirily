import { describe, expect, test } from 'bun:test'
import { DEFAULT_EDGE, adjustEdge, isNeutral } from './edge.ts'

const WIDTH = 64
const HEIGHT = 16
const size = { width: WIDTH, height: HEIGHT }
const ROW = 8

/** A hard edge at x = 32: opaque to the left, transparent to the right. */
const step = (): Uint8Array => {
  const mask = new Uint8Array(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = x < 32 ? 255 : 0
  }
  return mask
}

/** Where the mask crosses half, to a fraction of a pixel. */
const crossing = (mask: Uint8Array): number => {
  for (let x = 1; x < WIDTH; x += 1) {
    const before = mask[ROW * WIDTH + x - 1] ?? 0
    const after = mask[ROW * WIDTH + x] ?? 0
    if (before >= 128 && after < 128) {
      return x - 1 + (before - 128) / Math.max(1, before - after)
    }
  }
  return Number.NaN
}

describe('isNeutral', () => {
  test('the default does nothing, so it can be skipped', () => {
    expect(isNeutral(DEFAULT_EDGE)).toBe(true)
  })

  test('any shrink or feather is something', () => {
    expect(isNeutral({ shrink: -1, feather: 0 })).toBe(false)
    expect(isNeutral({ shrink: 0, feather: 2 })).toBe(false)
  })
})

describe('adjustEdge', () => {
  test('leaves the mask untouched when there is nothing to do', () => {
    const mask = step()
    adjustEdge(mask, size, DEFAULT_EDGE)
    expect([...mask].every((value) => value === 0 || value === 255)).toBe(true)
    expect(crossing(mask)).toBeCloseTo(31.5, 1)
  })

  test('pulls the edge in by about the number of pixels asked for', () => {
    const mask = step()
    adjustEdge(mask, size, { shrink: -2, feather: 0 })
    expect(crossing(mask)).toBeCloseTo(29.5, 0)
  })

  test('pushes the edge out by about the number of pixels asked for', () => {
    const mask = step()
    adjustEdge(mask, size, { shrink: 2, feather: 0 })
    expect(crossing(mask)).toBeCloseTo(33.5, 0)
  })

  test('feathering widens the transition without moving it', () => {
    const hard = step()
    adjustEdge(hard, size, DEFAULT_EDGE)
    const soft = step()
    adjustEdge(soft, size, { shrink: 0, feather: 4 })

    const partial = (mask: Uint8Array): number =>
      [...mask.subarray(ROW * WIDTH, (ROW + 1) * WIDTH)].filter((v) => v > 8 && v < 247).length
    expect(partial(soft)).toBeGreaterThan(partial(hard) + 2)
    expect(crossing(soft)).toBeCloseTo(crossing(hard), 0)
  })

  test('a region far from any edge keeps its value', () => {
    const mask = step()
    adjustEdge(mask, size, { shrink: -2, feather: 4 })
    expect(mask[ROW * WIDTH + 2]).toBe(255)
    expect(mask[ROW * WIDTH + 61]).toBe(0)
  })

  test('a mask that does not match the image is left alone', () => {
    const mask = new Uint8Array(3).fill(200)
    adjustEdge(mask, size, { shrink: -2, feather: 0 })
    expect([...mask]).toEqual([200, 200, 200])
  })
})
