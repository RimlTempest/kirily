import { describe, expect, test } from 'bun:test'
import { imagePoint } from '@kirily/contract/geometry'
import { ASPECT_PRESETS, clampCrop, cropFromDrag, resizeCrop } from './crop.ts'

const image = { width: 400, height: 300 }

describe('cropFromDrag', () => {
  test('makes a rectangle from two corners, whichever way they were dragged', () => {
    const forward = cropFromDrag(imagePoint(50, 40), imagePoint(150, 140), image, null)
    const backward = cropFromDrag(imagePoint(150, 140), imagePoint(50, 40), image, null)

    expect(forward).toEqual({ x: 50, y: 40, width: 100, height: 100 })
    expect(backward).toEqual(forward)
  })

  test('stays inside the image however far the drag goes', () => {
    const crop = cropFromDrag(imagePoint(-80, -80), imagePoint(900, 900), image, null)
    expect(crop).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  test('honours an aspect ratio by fitting inside the drag', () => {
    // A 100x100 drag at 16:9 keeps the width and shortens the height.
    const crop = cropFromDrag(imagePoint(0, 0), imagePoint(160, 160), image, 16 / 9)
    expect(crop.width / crop.height).toBeCloseTo(16 / 9, 3)
    expect(crop.width).toBeLessThanOrEqual(160)
    expect(crop.height).toBeLessThanOrEqual(160)
  })

  test('never returns an empty rectangle', () => {
    const crop = cropFromDrag(imagePoint(10, 10), imagePoint(10, 10), image, null)
    expect(crop.width).toBeGreaterThan(0)
    expect(crop.height).toBeGreaterThan(0)
  })
})

describe('clampCrop', () => {
  test('pushes a rectangle back inside rather than shrinking it', () => {
    // Dragging the whole box off the edge should slide it back, not resize it.
    const crop = clampCrop({ x: 380, y: 290, width: 100, height: 50 }, image)
    expect(crop).toEqual({ x: 300, y: 250, width: 100, height: 50 })
  })

  test('shrinks only when the rectangle is larger than the image', () => {
    const crop = clampCrop({ x: -10, y: -10, width: 900, height: 900 }, image)
    expect(crop).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  test('rounds to whole pixels, because a crop is a pixel range', () => {
    const crop = clampCrop({ x: 10.4, y: 10.6, width: 50.5, height: 50.4 }, image)
    expect(Number.isInteger(crop.x)).toBe(true)
    expect(Number.isInteger(crop.width)).toBe(true)
  })
})

describe('resizeCrop', () => {
  const crop = { x: 100, y: 100, width: 120, height: 90 }

  test('moves the dragged corner and leaves the opposite one', () => {
    const resized = resizeCrop(crop, 'top-left', imagePoint(80, 70), image, null)
    expect(resized.x).toBe(80)
    expect(resized.y).toBe(70)
    // The bottom-right corner has not moved.
    expect(resized.x + resized.width).toBe(220)
    expect(resized.y + resized.height).toBe(190)
  })

  test('moves the opposite edge for a bottom-right handle', () => {
    const resized = resizeCrop(crop, 'bottom-right', imagePoint(300, 250), image, null)
    expect(resized.x).toBe(100)
    expect(resized.y).toBe(100)
    expect(resized.width).toBe(200)
    expect(resized.height).toBe(150)
  })

  test('keeps the aspect ratio when one is set', () => {
    const resized = resizeCrop(crop, 'bottom-right', imagePoint(300, 300), image, 1)
    expect(resized.width).toBe(resized.height)
  })

  test('does not let a handle cross its opposite', () => {
    const resized = resizeCrop(crop, 'top-left', imagePoint(999, 999), image, null)
    expect(resized.width).toBeGreaterThan(0)
    expect(resized.height).toBeGreaterThan(0)
  })
})

describe('ASPECT_PRESETS', () => {
  test('offers the ratios the design lists', () => {
    expect(ASPECT_PRESETS.map((preset) => preset.label)).toEqual([
      '自由',
      '1:1',
      '4:3',
      '3:4',
      '16:9',
      '9:16',
    ])
  })

  test('free crop has no ratio', () => {
    expect(ASPECT_PRESETS[0]?.ratio).toBeNull()
  })
})
