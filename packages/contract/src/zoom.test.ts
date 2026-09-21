import type { Viewport } from './geometry.ts'
import { describe, expect, test } from 'bun:test'
import {
  clampZoom,
  fitViewport,
  panBy,
  screenPoint,
  toImagePoint,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
  zoomAt,
} from './geometry.ts'

const viewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 }

describe('clampZoom', () => {
  test('keeps the scale inside a usable range', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN)
    expect(clampZoom(1000)).toBe(ZOOM_MAX)
    expect(clampZoom(1.5)).toBe(1.5)
  })

  test('survives values that are not numbers at all', () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_MAX)
  })
})

describe('zoomAt', () => {
  test('keeps the image point under the cursor where it is', () => {
    // This is the whole job. Get it wrong and the image slides away from the
    // pointer as you zoom, which is the classic "unusable zoom" bug.
    const anchor = screenPoint(300, 200)
    const before = toImagePoint(anchor, viewport)

    const zoomed = zoomAt(viewport, anchor, 4)
    const after = toImagePoint(anchor, zoomed)

    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  test('holds the anchor when zooming out too', () => {
    const start: Viewport = { scale: 3, offsetX: -120, offsetY: 40, rotation: 0 }
    const anchor = screenPoint(17, 233)
    const before = toImagePoint(anchor, start)

    const after = toImagePoint(anchor, zoomAt(start, anchor, 0.5))
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  test('respects the zoom limits', () => {
    expect(zoomAt(viewport, screenPoint(0, 0), 1e9).scale).toBe(ZOOM_MAX)
    expect(zoomAt(viewport, screenPoint(0, 0), 1e-9).scale).toBe(ZOOM_MIN)
  })
})

describe('panBy', () => {
  test('moves the image with the pointer, one screen pixel for one', () => {
    const moved = panBy(viewport, 30, -12)
    expect(moved.offsetX).toBe(30)
    expect(moved.offsetY).toBe(-12)
    expect(moved.scale).toBe(1)
  })
})

describe('fitViewport', () => {
  test('shows the whole image, centred', () => {
    const fitted = fitViewport({ width: 1000, height: 500 }, { width: 400, height: 400 })

    expect(fitted.scale).toBe(0.4)
    expect(fitted.offsetX).toBe(0)
    expect(fitted.offsetY).toBe(100)
  })

  test('does not enlarge a small image past 100%', () => {
    const fitted = fitViewport({ width: 40, height: 40 }, { width: 400, height: 400 })
    expect(fitted.scale).toBe(1)
  })

  test('copes with a container that has no size yet', () => {
    const fitted = fitViewport({ width: 100, height: 100 }, { width: 0, height: 0 })
    expect(Number.isFinite(fitted.scale)).toBe(true)
    expect(fitted.scale).toBeGreaterThan(0)
  })
})

describe('ZOOM_STEPS', () => {
  test('offers the presets the design asks for', () => {
    expect(ZOOM_STEPS).toEqual([0.25, 0.5, 1, 2, 4])
  })
})
