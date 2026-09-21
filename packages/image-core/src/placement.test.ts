import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PLACEMENT,
  clampScale,
  isPlaced,
  moveBy,
  placedSample,
  zoomBy,
} from './placement.ts'

describe('a placement that has not been touched', () => {
  test('is not a placement at all, so it can be skipped', () => {
    expect(isPlaced(DEFAULT_PLACEMENT)).toBe(false)
  })

  test('samples where it was asked to', () => {
    expect(placedSample(DEFAULT_PLACEMENT, 40, 25, { width: 100, height: 100 })).toEqual({
      x: 40,
      y: 25,
    })
  })
})

describe('moveBy', () => {
  test('adds up, so a drag is a series of small moves', () => {
    const moved = moveBy(moveBy(DEFAULT_PLACEMENT, 10, 5), -3, 2)
    expect(moved.offsetX).toBe(7)
    expect(moved.offsetY).toBe(7)
  })

  test('counts as a placement', () => {
    expect(isPlaced(moveBy(DEFAULT_PLACEMENT, 1, 0))).toBe(true)
  })
})

describe('zoomBy', () => {
  const size = { width: 100, height: 100 }

  test('multiplies, so two steps of the same size are symmetric', () => {
    const zoomed = zoomBy(DEFAULT_PLACEMENT, 2, 0, 0, size)
    expect(zoomBy(zoomed, 0.5, 0, 0, size).scale).toBeCloseTo(1, 6)
  })

  test('holds the anchor still, wherever it is', () => {
    for (const [ax, ay] of [
      [30, 70],
      [0, 0],
      [99, 99],
      [50, 50],
    ] as const) {
      const before = placedSample(DEFAULT_PLACEMENT, ax, ay, size)
      const after = placedSample(zoomBy(DEFAULT_PLACEMENT, 2, ax, ay, size), ax, ay, size)
      expect(after.x).toBeCloseTo(before.x, 6)
      expect(after.y).toBeCloseTo(before.y, 6)
    }
  })

  test('holds the anchor still when it is already placed', () => {
    const placed = moveBy(zoomBy(DEFAULT_PLACEMENT, 1.5, 20, 20, size), 7, -4)
    const before = placedSample(placed, 30, 70, size)
    const after = placedSample(zoomBy(placed, 2, 30, 70, size), 30, 70, size)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  test('is held inside limits a user can come back from', () => {
    expect(clampScale(1000)).toBeLessThanOrEqual(8)
    expect(clampScale(0.0001)).toBeGreaterThanOrEqual(0.1)
    expect(clampScale(Number.NaN)).toBe(1)
  })
})

describe('placedSample', () => {
  test('a move shifts what is under a point the other way', () => {
    // The content moved right by 10, so the point reads 10 further left.
    const placed = moveBy(DEFAULT_PLACEMENT, 10, 0)
    expect(placedSample(placed, 40, 25, { width: 100, height: 100 }).x).toBe(30)
  })

  test('a zoom of 2 halves the distance from the centre', () => {
    const size = { width: 100, height: 100 }
    const placed = zoomBy(DEFAULT_PLACEMENT, 2, 50, 50, size)
    expect(placedSample(placed, 70, 50, size).x).toBeCloseTo(60, 6)
  })
})
