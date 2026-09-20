import { describe, expect, test } from 'bun:test'
import { imagePoint } from '@kirily/contract/geometry'
import { createMaskLayers } from '@kirily/image-core/mask'
import { affectedRect, resample, targetLayer } from './commands.ts'

const layers = createMaskLayers(100, 100)

describe('affectedRect', () => {
  test('covers the stroke plus the brush radius, clamped to the image', () => {
    const rect = affectedRect(
      {
        kind: 'brush-stroke',
        mode: 'keep',
        brush: { size: 10, hardness: 1, opacity: 1 },
        points: [imagePoint(50, 50), imagePoint(60, 50)],
      },
      layers,
    )
    expect(rect).toEqual({ x: 39, y: 39, width: 32, height: 22 })
  })

  test('never reaches outside the image', () => {
    const rect = affectedRect(
      {
        kind: 'brush-stroke',
        mode: 'keep',
        brush: { size: 40, hardness: 1, opacity: 1 },
        points: [imagePoint(0, 0)],
      },
      layers,
    )
    expect(rect).toEqual({ x: 0, y: 0, width: 41, height: 41 })
  })

  test('a stroke entirely outside the image affects nothing', () => {
    const rect = affectedRect(
      {
        kind: 'brush-stroke',
        mode: 'keep',
        brush: { size: 1, hardness: 1, opacity: 1 },
        points: [imagePoint(-50, -50)],
      },
      layers,
    )
    expect(rect).toBeNull()
  })

  test('replacing the AI mask affects the whole image', () => {
    const rect = affectedRect({ kind: 'replace-base-mask', alpha: new Uint8Array(0) }, layers)
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  test('a crop touches no mask pixel', () => {
    expect(affectedRect({ kind: 'set-crop', rect: null }, layers)).toBeNull()
    expect(targetLayer({ kind: 'set-crop', rect: null }, layers)).toBeNull()
  })
})

describe('resample', () => {
  const brush = { size: 30, hardness: 1, opacity: 1 }

  test('drops points a pointer emitted faster than the brush can matter', () => {
    // 21 points one pixel apart, a brush of radius 30: one dab every 10 pixels
    // covers the same ground, so only x = 0, 10 and 20 survive.
    const dense = Array.from({ length: 21 }, (_, i) => imagePoint(i, 0))
    expect(resample(dense, brush).map((p) => p.x)).toEqual([0, 10, 20])
  })

  test('keeps every point of a fast, wide-apart drag', () => {
    const sparse = [imagePoint(0, 0), imagePoint(100, 0), imagePoint(200, 0)]
    expect(resample(sparse, brush).length).toBe(3)
  })

  test('keeps the first point even for a single tap', () => {
    expect(resample([imagePoint(5, 5)], brush)).toEqual([imagePoint(5, 5)])
  })

  test('an empty path stays empty', () => {
    expect(resample([], brush)).toEqual([])
  })
})
