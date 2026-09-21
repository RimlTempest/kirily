import { describe, expect, test } from 'bun:test'
import { KirilyErrorCode } from '@kirily/contract/error'
import { err, ok } from '@kirily/contract/result'
import { boundaryFScore, edgeColourError, iou, meanAbsoluteError } from './metrics.ts'

/** A mask drawn from a string picture: `#` is opaque, `.` is transparent. */
const draw = (rows: readonly string[]): { mask: Uint8Array; width: number; height: number } => {
  const width = rows[0]?.length ?? 0
  const mask = new Uint8Array(width * rows.length)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) mask[y * width + x] = row[x] === '#' ? 255 : 0
  })
  return { mask, width, height: rows.length }
}

describe('iou', () => {
  test('is 1 for identical masks', () => {
    const a = draw(['.##.', '.##.'])
    expect(iou(a.mask, a.mask)).toEqual(ok(1))
  })

  test('is 0 when the masks share no pixel', () => {
    const a = draw(['##..'])
    const b = draw(['..##'])
    expect(iou(a.mask, b.mask)).toEqual(ok(0))
  })

  test('is intersection over union when they overlap', () => {
    const a = draw(['###.'])
    const b = draw(['.###'])
    // Intersection 2, union 4.
    expect(iou(a.mask, b.mask)).toEqual(ok(0.5))
  })

  test('is 1 when both masks are empty, because nothing was missed', () => {
    const a = draw(['....'])
    expect(iou(a.mask, a.mask)).toEqual(ok(1))
  })

  test('counts a pixel as inside from 128 up', () => {
    expect(iou(new Uint8Array([128]), new Uint8Array([255]))).toEqual(ok(1))
    expect(iou(new Uint8Array([127]), new Uint8Array([255]))).toEqual(ok(0))
  })

  test('reports a size mismatch instead of comparing what it cannot', () => {
    expect(iou(new Uint8Array(2), new Uint8Array(3))).toEqual(
      err({ code: KirilyErrorCode.SizeMismatch, detail: 'iou: 2 vs 3' }),
    )
  })
})

describe('boundaryFScore', () => {
  const size = { width: 8, height: 8 }
  const square = draw([
    '........',
    '........',
    '..####..',
    '..####..',
    '..####..',
    '..####..',
    '........',
    '........',
  ])

  test('is 1 for identical masks', () => {
    expect(boundaryFScore(square.mask, square.mask, size, 1)).toEqual(ok(1))
  })

  test('still scores 1 when the edge is off by less than the tolerance', () => {
    const shifted = draw([
      '........',
      '........',
      '...####.',
      '...####.',
      '...####.',
      '...####.',
      '........',
      '........',
    ])
    expect(boundaryFScore(square.mask, shifted.mask, size, 1)).toEqual(ok(1))
  })

  test('falls below 1 once the edge moves further than the tolerance', () => {
    const shifted = draw([
      '........',
      '........',
      '....####',
      '....####',
      '....####',
      '....####',
      '........',
      '........',
    ])
    const score = boundaryFScore(square.mask, shifted.mask, size, 1)
    expect(score.ok && score.value).toBeLessThan(1)
  })

  test('is 0 when the two boundaries are nowhere near each other', () => {
    const far = draw([
      '##......',
      '##......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    expect(boundaryFScore(square.mask, far.mask, size, 1)).toEqual(ok(0))
  })

  test('is 1 when neither mask has a boundary, because there is nothing to align', () => {
    const empty = new Uint8Array(64)
    expect(boundaryFScore(empty, empty, size, 1)).toEqual(ok(1))
  })

  test('is 0 when one mask has a boundary and the other has none', () => {
    const empty = new Uint8Array(64)
    expect(boundaryFScore(square.mask, empty, size, 1)).toEqual(ok(0))
  })
})

describe('meanAbsoluteError', () => {
  test('is 0 for identical masks', () => {
    const a = new Uint8Array([0, 128, 255])
    expect(meanAbsoluteError(a, a)).toEqual(ok(0))
  })

  test('is 1 when every pixel is inverted', () => {
    expect(meanAbsoluteError(new Uint8Array([0, 0]), new Uint8Array([255, 255]))).toEqual(ok(1))
  })

  /**
   * The reason both metrics exist: a hard cutout of a soft edge is perfect by
   * IoU and visibly wrong on screen.
   */
  test('sees a hardened edge that iou calls perfect', () => {
    const truth = new Uint8Array([255, 200, 140, 0])
    const hardened = new Uint8Array([255, 255, 255, 0])
    expect(iou(hardened, truth)).toEqual(ok(1))
    const error = meanAbsoluteError(hardened, truth)
    expect(error.ok && error.value).toBeGreaterThan(0.1)
  })
})

describe('edgeColourError', () => {
  /** One pixel at half coverage, one opaque, one transparent. */
  const truthAlpha = new Uint8Array([128, 255, 0])
  const truthRgb = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255])

  test('is 0 when the soft pixel already carries the subject colour', () => {
    const predicted = new Uint8ClampedArray([255, 255, 255, 128, 255, 255, 255, 255, 0, 0, 0, 0])
    expect(edgeColourError(predicted, truthAlpha, truthRgb)).toEqual(ok(0))
  })

  test('sees the background still mixed into the soft pixel', () => {
    // Half white subject, half black background: the stored colour is 128.
    const predicted = new Uint8ClampedArray([128, 128, 128, 128, 255, 255, 255, 255, 0, 0, 0, 0])
    const error = edgeColourError(predicted, truthAlpha, truthRgb)
    expect(error.ok && error.value).toBeCloseTo(127 / 255, 3)
  })

  test('ignores pixels that were never mixed, whatever colour they hold', () => {
    const predicted = new Uint8ClampedArray([255, 255, 255, 128, 0, 0, 0, 255, 9, 9, 9, 0])
    expect(edgeColourError(predicted, truthAlpha, truthRgb)).toEqual(ok(0))
  })

  test('is 0 when no pixel falls in the measurable band', () => {
    const opaque = new Uint8Array([255, 255])
    expect(
      edgeColourError(new Uint8ClampedArray(8), opaque, new Uint8Array([0, 0, 0, 0, 0, 0])),
    ).toEqual(ok(0))
  })
})
