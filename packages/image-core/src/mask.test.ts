import { describe, expect, test } from 'bun:test'
import { imagePoint } from '@kirily/contract/geometry'
import { DEFAULT_BRUSH } from '@kirily/contract/mask'
import { composeMask, createMaskLayers, layerFor, resampleMask, stampBrush } from './mask.ts'

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
