import { describe, expect, test } from 'bun:test'
import { perceptualDistance, toOklab } from './color.ts'

describe('toOklab', () => {
  test('maps black and white to the ends of the lightness axis', () => {
    const black = toOklab(0, 0, 0)
    const white = toOklab(255, 255, 255)
    expect(black[0]).toBeCloseTo(0, 3)
    expect(white[0]).toBeCloseTo(1, 3)
  })

  test('leaves grey without a hue', () => {
    const [, a, b] = toOklab(128, 128, 128)
    expect(Math.abs(a)).toBeLessThan(1e-6)
    expect(Math.abs(b)).toBeLessThan(1e-6)
  })

  test('matches the reference values for pure red', () => {
    // From Björn Ottosson's original article.
    const [l, a, b] = toOklab(255, 0, 0)
    expect(l).toBeCloseTo(0.6279, 3)
    expect(a).toBeCloseTo(0.2249, 3)
    expect(b).toBeCloseTo(0.1258, 3)
  })
})

/** Plain Euclidean RGB distance, for the comparison below. */
const rgbDistance = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0))

describe('perceptualDistance', () => {
  test('is zero for identical colours', () => {
    expect(perceptualDistance([200, 100, 50], [200, 100, 50])).toBe(0)
  })

  test('separates a subject from a near-identical background better than RGB', () => {
    // Measured from tests/fixtures/pale-subject-on-white.png: the background
    // and the skin are 9.4 apart in RGB, which is why a bucket keyed on RGB
    // swallows the face. In OKLab the hair stands out 30x further than the
    // skin does, against 19x in RGB.
    const background: [number, number, number] = [251, 251, 250]
    const skin: [number, number, number] = [255, 248, 242]
    const hair: [number, number, number] = [109, 149, 199]

    const perceptualRatio =
      perceptualDistance(background, hair) / perceptualDistance(background, skin)
    const rgbRatio = rgbDistance(background, hair) / rgbDistance(background, skin)

    expect(perceptualRatio).toBeGreaterThan(rgbRatio * 1.3)
  })

  test('grows with visible difference', () => {
    const white: [number, number, number] = [255, 255, 255]
    const near = perceptualDistance(white, [250, 250, 250])
    const far = perceptualDistance(white, [128, 128, 128])
    expect(far).toBeGreaterThan(near * 5)
  })
})
