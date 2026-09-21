import type { Viewport } from './geometry.ts'
import { describe, expect, test } from 'bun:test'
import {
  IDENTITY_VIEWPORT,
  QUARTERS,
  centred,
  fitScale,
  fitViewport,
  imagePoint,
  nextQuarter,
  panBy,
  screenPoint,
  toImagePoint,
  toScreenPoint,
  turnedBounds,
  zoomAt,
} from './geometry.ts'

describe('coordinate conversion', () => {
  test('is the identity at 100% with no offset', () => {
    expect(toImagePoint(screenPoint(10, 20), IDENTITY_VIEWPORT)).toEqual(imagePoint(10, 20))
  })

  test('maps a screen point back to the original image pixel when zoomed out', () => {
    // A 4000px-wide image shown at 1200px: one screen pixel is 3.33 image pixels.
    const viewport: Viewport = { scale: 0.3, offsetX: 100, offsetY: 50, rotation: 0 }
    expect(toImagePoint(screenPoint(400, 350), viewport)).toEqual(imagePoint(1000, 1000))
  })

  test('round-trips', () => {
    const viewport: Viewport = { scale: 2.5, offsetX: -37, offsetY: 11, rotation: 0 }
    const original = imagePoint(123, 456)
    expect(toImagePoint(toScreenPoint(original, viewport), viewport)).toEqual(original)
  })
})

describe('fitScale', () => {
  test('is limited by the tighter axis', () => {
    expect(fitScale({ width: 4000, height: 3000 }, { width: 800, height: 900 })).toBe(0.2)
    expect(fitScale({ width: 3000, height: 4000 }, { width: 900, height: 800 })).toBe(0.2)
  })
})

describe('centred', () => {
  test('leaves equal margins on both sides', () => {
    const viewport = centred({ width: 100, height: 100 }, { width: 300, height: 200 }, 1)
    expect(viewport).toEqual({ scale: 1, offsetX: 100, offsetY: 50, rotation: 0 })
  })
})

describe('a turned view', () => {
  const image = { width: 200, height: 100 }
  const container = { width: 400, height: 400 }

  test('cycles a quarter at a time and comes back', () => {
    expect(nextQuarter(0)).toBe(90)
    expect(nextQuarter(90)).toBe(180)
    expect(nextQuarter(180)).toBe(270)
    expect(nextQuarter(270)).toBe(0)
  })

  for (const rotation of QUARTERS) {
    test(`a point survives the round trip at ${rotation}°`, () => {
      const viewport = fitViewport(image, container, rotation)
      const there = toScreenPoint(imagePoint(37, 61), viewport)
      const back = toImagePoint(there, viewport)
      expect(back.x).toBeCloseTo(37, 6)
      expect(back.y).toBeCloseTo(61, 6)
    })

    test(`the whole image is on screen at ${rotation}°`, () => {
      const viewport = fitViewport(image, container, rotation)
      for (const [x, y] of [
        [0, 0],
        [image.width, 0],
        [0, image.height],
        [image.width, image.height],
      ] as const) {
        const screen = toScreenPoint(imagePoint(x, y), viewport)
        expect(screen.x).toBeGreaterThanOrEqual(-0.001)
        expect(screen.y).toBeGreaterThanOrEqual(-0.001)
        expect(screen.x).toBeLessThanOrEqual(container.width + 0.001)
        expect(screen.y).toBeLessThanOrEqual(container.height + 0.001)
      }
    })

    test(`zooming holds the anchor at ${rotation}°`, () => {
      const viewport = { ...fitViewport(image, container, rotation), scale: 1 }
      const anchor = screenPoint(123, 210)
      const before = toImagePoint(anchor, viewport)
      const after = toImagePoint(anchor, zoomAt(viewport, anchor, 2.5))
      expect(after.x).toBeCloseTo(before.x, 6)
      expect(after.y).toBeCloseTo(before.y, 6)
    })

    test(`panning moves by the screen delta at ${rotation}°`, () => {
      const viewport = fitViewport(image, container, rotation)
      const before = toScreenPoint(imagePoint(10, 20), viewport)
      const after = toScreenPoint(imagePoint(10, 20), panBy(viewport, 15, -7))
      expect(after.x - before.x).toBeCloseTo(15, 6)
      expect(after.y - before.y).toBeCloseTo(-7, 6)
    })
  }

  /**
   * The point of the feature, at the size it matters: a photograph wider than
   * the phone it is being painted on. The fit never enlarges past 100%, so an
   * image that already fits gains nothing from turning — which is why this
   * uses one that does not.
   */
  test('a quarter turn shows a wide photograph twice as large on a tall screen', () => {
    const photograph = { width: 2000, height: 1000 }
    const phone = { width: 390, height: 780 }
    const upright = fitViewport(photograph, phone, 0)
    const turned = fitViewport(photograph, phone, 90)
    expect(turned.scale).toBeCloseTo(upright.scale * 2, 6)
  })

  test('the turned bounds swap the sides at a quarter turn', () => {
    expect(turnedBounds(image, 90).width).toBe(image.height)
    expect(turnedBounds(image, 90).height).toBe(image.width)
    expect(turnedBounds(image, 180).width).toBe(image.width)
  })

  test('half a turn puts the far corner where the origin was', () => {
    const viewport = fitViewport(image, container, 180)
    const origin = toScreenPoint(imagePoint(0, 0), viewport)
    const far = toScreenPoint(imagePoint(image.width, image.height), viewport)
    expect(origin.x).toBeGreaterThan(far.x)
    expect(origin.y).toBeGreaterThan(far.y)
  })
})
