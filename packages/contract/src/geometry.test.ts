import { describe, expect, test } from 'bun:test'
import {
  centred,
  fitScale,
  IDENTITY_VIEWPORT,
  imagePoint,
  screenPoint,
  toImagePoint,
  toScreenPoint,
} from './geometry.ts'

describe('coordinate conversion', () => {
  test('is the identity at 100% with no offset', () => {
    expect(toImagePoint(screenPoint(10, 20), IDENTITY_VIEWPORT)).toEqual(imagePoint(10, 20))
  })

  test('maps a screen point back to the original image pixel when zoomed out', () => {
    // A 4000px-wide image shown at 1200px: one screen pixel is 3.33 image pixels.
    const viewport = { scale: 0.3, offsetX: 100, offsetY: 50 }
    expect(toImagePoint(screenPoint(400, 350), viewport)).toEqual(imagePoint(1000, 1000))
  })

  test('round-trips', () => {
    const viewport = { scale: 2.5, offsetX: -37, offsetY: 11 }
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
    expect(viewport).toEqual({ scale: 1, offsetX: 100, offsetY: 50 })
  })
})
