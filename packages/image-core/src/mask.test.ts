import { describe, expect, test } from 'bun:test'
import { imagePoint } from '@kirily/contract/geometry'
import { DEFAULT_BRUSH } from '@kirily/contract/mask'
import {
  DEFAULT_SOLIDIFY,
  composeMask,
  createMaskLayers,
  layerFor,
  resampleMask,
  solidifyInterior,
  stampBrush,
} from './mask.ts'

describe('createMaskLayers', () => {
  test('starts fully opaque so the user sees their image before the AI runs', () => {
    const layers = createMaskLayers(2, 2)
    expect([...layers.base]).toEqual([255, 255, 255, 255])
    expect([...layers.keep]).toEqual([0, 0, 0, 0])
    expect([...layers.remove]).toEqual([0, 0, 0, 0])
  })
})

describe('composeMask', () => {
  test('manual edits win over the AI mask', () => {
    const layers = createMaskLayers(2, 2)
    layers.base.set([0, 255, 255, 0])
    layers.keep.set([255, 0, 0, 0])
    layers.remove.set([0, 255, 0, 0])

    const out = new Uint8Array(4)
    const result = composeMask(layers, out)

    expect(result.ok).toBe(true)
    expect([...out]).toEqual([255, 0, 255, 0])
  })

  test('rejects an output buffer from a different image', () => {
    const result = composeMask(createMaskLayers(2, 2), new Uint8Array(3))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SIZE_MISMATCH')
  })
})

describe('stampBrush', () => {
  const size = { width: 9, height: 9 }

  test('a hard brush fills its circle and nothing outside it', () => {
    const layer = new Uint8Array(81)
    stampBrush(layer, size, imagePoint(4.5, 4.5), { size: 2, hardness: 1, opacity: 1 })

    expect(layer[4 * 9 + 4]).toBe(255)
    expect(layer[0]).toBe(0)
  })

  test('a soft brush fades towards the edge', () => {
    const layer = new Uint8Array(81)
    stampBrush(layer, size, imagePoint(4.5, 4.5), { size: 4, hardness: 0, opacity: 1 })

    const centre = layer[4 * 9 + 4] ?? 0
    const edge = layer[4 * 9 + 7] ?? 0
    expect(centre).toBe(255)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(centre)
  })

  test('a zero-size brush does nothing', () => {
    const layer = new Uint8Array(81).fill(7)
    stampBrush(layer, size, imagePoint(4, 4), { ...DEFAULT_BRUSH, size: 0 })
    expect([...layer].every((v) => v === 7)).toBe(true)
  })

  test('repeated low-opacity dabs build up but never pass opaque', () => {
    const layer = new Uint8Array(81)
    for (let i = 0; i < 20; i++) {
      stampBrush(layer, size, imagePoint(4.5, 4.5), { size: 2, hardness: 1, opacity: 0.5 })
    }
    expect(layer[4 * 9 + 4]).toBe(255)
  })

  test('rejects a layer from a different image', () => {
    const result = stampBrush(new Uint8Array(4), size, imagePoint(1, 1), DEFAULT_BRUSH)
    expect(result.ok).toBe(false)
  })

  test('a dab at the image edge does not wrap to the other side', () => {
    const layer = new Uint8Array(81)
    stampBrush(layer, size, imagePoint(0.5, 0.5), { size: 2, hardness: 1, opacity: 1 })
    // Row 0 is painted on the left; the right end of row 0 must stay untouched.
    expect(layer[0]).toBe(255)
    expect(layer[8]).toBe(0)
  })
})

describe('layerFor', () => {
  test('routes each mode to its own layer', () => {
    const layers = createMaskLayers(1, 1)
    expect(layerFor(layers, 'keep')).toBe(layers.keep)
    expect(layerFor(layers, 'remove')).toBe(layers.remove)
  })
})

describe('resampleMask', () => {
  test('is a copy when the sizes already match', () => {
    const source = new Uint8Array([1, 2, 3, 4])
    const out = resampleMask(source, { width: 2, height: 2 }, { width: 2, height: 2 })
    expect([...out]).toEqual([1, 2, 3, 4])
    expect(out).not.toBe(source)
  })

  test('scales a mask up to the original resolution', () => {
    const source = new Uint8Array([0, 255, 0, 255])
    const out = resampleMask(source, { width: 2, height: 2 }, { width: 4, height: 4 })
    expect(out.length).toBe(16)
    expect(out[0]).toBe(0)
    expect(out[3]).toBe(255)
  })

  test('interpolates rather than stair-stepping a soft edge', () => {
    const source = new Uint8Array([0, 255])
    const out = resampleMask(source, { width: 2, height: 1 }, { width: 4, height: 1 })
    const middle = out[1] ?? 0
    expect(middle).toBeGreaterThan(0)
    expect(middle).toBeLessThan(255)
  })

  test('scales a mask down for the preview', () => {
    const source = new Uint8Array(16).fill(255)
    const out = resampleMask(source, { width: 4, height: 4 }, { width: 2, height: 2 })
    expect([...out]).toEqual([255, 255, 255, 255])
  })

  test('keeps the corners at their original values', () => {
    const source = new Uint8Array([10, 20, 30, 40])
    const out = resampleMask(source, { width: 2, height: 2 }, { width: 8, height: 8 })
    expect(out[0]).toBe(10)
    expect(out[63]).toBe(40)
  })
})

/** A `size`² opaque square with a soft 1px edge, holding `interior` inside. */
const subject = (size: number, interior: (x: number, y: number) => number | null): Uint8Array => {
  const mask = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onEdge = x === 2 || y === 2 || x === size - 3 || y === size - 3
      const outside = x < 2 || y < 2 || x > size - 3 || y > size - 3
      const override = interior(x, y)
      mask[y * size + x] = outside ? 0 : (override ?? (onEdge ? 128 : 255))
    }
  }
  return mask
}

describe('solidifyInterior', () => {
  const size = { width: 24, height: 24 }
  // Speck closing off: these cover the ramp, and a 24x24 image is small enough
  // that any fraction would round the limit to zero anyway.
  const options = { backgroundBelow: 24, edgeBand: 2, ramp: 0, maxEnclosedFraction: 0 }

  test('fills a low-confidence patch inside the subject', () => {
    const mask = subject(24, (x, y) => (x > 9 && x < 15 && y > 9 && y < 15 ? 160 : null))
    solidifyInterior(mask, size, options)
    expect(mask[12 * 24 + 12]).toBe(255)
  })

  test('leaves the soft silhouette alone', () => {
    const mask = subject(24, () => null)
    solidifyInterior(mask, size, options)
    // The 1px anti-aliased ring is within the protected band.
    expect(mask[2 * 24 + 12]).toBe(128)
  })

  test('leaves the background transparent', () => {
    const mask = subject(24, () => null)
    solidifyInterior(mask, size, options)
    expect(mask[0]).toBe(0)
    expect(mask[23 * 24 + 23]).toBe(0)
  })

  test('keeps a genuine hole, because the model is confident about it', () => {
    const mask = subject(24, (x, y) => (x > 9 && x < 15 && y > 9 && y < 15 ? 0 : null))
    solidifyInterior(mask, size, options)
    expect(mask[12 * 24 + 12]).toBe(0)
  })

  test('does not reach into a bay that is open to the background', () => {
    // A notch cut in from the left edge stays background: the trace walks in.
    const mask = subject(24, (x, y) => (y > 9 && y < 15 && x < 12 ? 0 : null))
    solidifyInterior(mask, size, options)
    expect(mask[12 * 24 + 6]).toBe(0)
  })

  test('ramps instead of stepping, so the closed region has no seam', () => {
    // A wide subject with an unsure interior: the pixel just past the band is
    // only partly raised, the one deep inside is fully opaque.
    const mask = subject(24, (x, y) => (x > 3 && x < 21 && y > 3 && y < 21 ? 100 : null))
    solidifyInterior(mask, size, { ...options, ramp: 4 })

    const nearEdge = mask[5 * 24 + 12] ?? 0
    const deepInside = mask[12 * 24 + 12] ?? 0
    expect(nearEdge).toBeGreaterThan(100)
    expect(nearEdge).toBeLessThan(deepInside)
    expect(deepInside).toBe(255)
  })

  test('is a no-op when the mask does not match the size', () => {
    const mask = new Uint8Array(10).fill(100)
    solidifyInterior(mask, { width: 5, height: 5 }, options)
    expect(Array.from(mask)).toEqual(Array.from(new Uint8Array(10).fill(100)))
  })

  test('leaves a fully opaque mask untouched', () => {
    const mask = new Uint8Array(16).fill(255)
    solidifyInterior(mask, { width: 4, height: 4 }, options)
    expect(Array.from(mask).every((v) => v === 255)).toBe(true)
  })

  test('leaves a fully transparent mask untouched', () => {
    const mask = new Uint8Array(16)
    solidifyInterior(mask, { width: 4, height: 4 }, options)
    expect(Array.from(mask).every((v) => v === 0)).toBe(true)
  })
})

describe('solidifyInterior and enclosed specks', () => {
  const SIZE = 100
  const size = { width: SIZE, height: SIZE }

  /** A solid subject filling the middle, with a rectangular hole punched in it. */
  const subjectWithHole = (hole: { x: number; y: number; w: number; h: number }): Uint8Array => {
    const mask = new Uint8Array(SIZE * SIZE)
    for (let y = 10; y < 90; y += 1) {
      for (let x = 10; x < 90; x += 1) mask[y * SIZE + x] = 255
    }
    for (let y = hole.y; y < hole.y + hole.h; y += 1) {
      for (let x = hole.x; x < hole.x + hole.w; x += 1) mask[y * SIZE + x] = 0
    }
    return mask
  }

  const alphaAt = (mask: Uint8Array, x: number, y: number): number => mask[y * SIZE + x] ?? 0

  test('closes a speck of background that the subject surrounds', () => {
    // 9 px in a 10 000 px image: 0.09%, just under the 0.1% limit.
    const mask = subjectWithHole({ x: 48, y: 48, w: 3, h: 3 })
    solidifyInterior(mask, size)
    expect(alphaAt(mask, 49, 49)).toBe(255)
  })

  test('keeps a hole that is large enough to be something', () => {
    const mask = subjectWithHole({ x: 35, y: 35, w: 30, h: 30 })
    solidifyInterior(mask, size)
    expect(alphaAt(mask, 50, 50)).toBe(0)
  })

  test('never closes background that reaches the image border', () => {
    const mask = new Uint8Array(SIZE * SIZE)
    for (let y = 10; y < 90; y += 1) {
      for (let x = 10; x < 90; x += 1) mask[y * SIZE + x] = 255
    }
    solidifyInterior(mask, size)
    expect(alphaAt(mask, 2, 2)).toBe(0)
    expect(alphaAt(mask, 50, 5)).toBe(0)
  })

  test('measures the limit as a share of the image, not a pixel count', () => {
    const generous = { ...DEFAULT_SOLIDIFY, maxEnclosedFraction: 0.2 }
    const strict = { ...DEFAULT_SOLIDIFY, maxEnclosedFraction: 0.000_1 }
    const hole = { x: 40, y: 40, w: 20, h: 20 }

    const filled = subjectWithHole(hole)
    solidifyInterior(filled, size, generous)
    expect(alphaAt(filled, 50, 50)).toBe(255)

    const kept = subjectWithHole(hole)
    solidifyInterior(kept, size, strict)
    expect(alphaAt(kept, 50, 50)).toBe(0)
  })
})
