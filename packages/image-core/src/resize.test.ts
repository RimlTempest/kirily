import { describe, expect, test } from 'bun:test'
import { buildAxisWeights, resampleGray, resampleRgba } from './resize.ts'

/** Builds an RGBA buffer whose red channel comes from `reds`. */
const reds = (values: readonly number[]): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(values.length * 4)
  values.forEach((value, i) => {
    rgba[i * 4] = value
    rgba[i * 4 + 3] = 255
  })
  return rgba
}

const redChannel = (rgba: Uint8ClampedArray): number[] =>
  Array.from(rgba.filter((_, i) => i % 4 === 0))

describe('buildAxisWeights', () => {
  test('normalises every output pixel so a flat input stays flat', () => {
    for (const [from, to] of [
      [8, 3],
      [3, 8],
      [1000, 7],
      [7, 1000],
    ] as const) {
      for (const kernel of ['triangle', 'lanczos3'] as const) {
        const w = buildAxisWeights(from, to, kernel)
        for (let i = 0; i < to; i++) {
          let total = 0
          for (let k = 0; k < (w.counts[i] ?? 0); k++) total += w.weights[i * w.stride + k] ?? 0
          expect(total).toBeCloseTo(1, 5)
        }
      }
    }
  })

  test('widens the footprint when shrinking, so no source pixel is skipped', () => {
    // 16 → 4 is a 4× reduction: each output must read at least 4 inputs.
    const w = buildAxisWeights(16, 4, 'triangle')
    for (let i = 0; i < 4; i++) expect(w.counts[i]).toBeGreaterThanOrEqual(4)
  })

  test('keeps the kernel narrow when enlarging', () => {
    const w = buildAxisWeights(4, 16, 'triangle')
    for (let i = 0; i < 16; i++) expect(w.counts[i]).toBeLessThanOrEqual(2)
  })

  test('never reads outside the source', () => {
    const w = buildAxisWeights(5, 40, 'lanczos3')
    for (let i = 0; i < 40; i++) {
      expect(w.starts[i]).toBeGreaterThanOrEqual(0)
      expect((w.starts[i] ?? 0) + (w.counts[i] ?? 0)).toBeLessThanOrEqual(5)
    }
  })
})

describe('resampleRgba', () => {
  test('copies when the size already matches', () => {
    const source = reds([1, 2, 3, 4])
    const out = resampleRgba(source, { width: 2, height: 2 }, { width: 2, height: 2 })
    expect(Array.from(out)).toEqual(Array.from(source))
    expect(out).not.toBe(source)
  })

  test('averages a one-pixel checkerboard instead of aliasing it', () => {
    // This is what a fixed 2×2 bilinear gets wrong: shrinking 8× it would land
    // on one phase of the pattern and return a flat black or white image.
    const size = 16
    const values: number[] = []
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) values.push((x + y) % 2 === 0 ? 0 : 255)
    }

    const out = resampleRgba(reds(values), { width: size, height: size }, { width: 2, height: 2 })

    for (const red of redChannel(out)) {
      expect(red).toBeGreaterThan(100)
      expect(red).toBeLessThan(155)
    }
  })

  test('keeps a flat image flat at any scale', () => {
    const flat = reds(Array.from({ length: 64 }, () => 200))
    const down = resampleRgba(flat, { width: 8, height: 8 }, { width: 3, height: 3 })
    const up = resampleRgba(flat, { width: 8, height: 8 }, { width: 19, height: 19 })
    expect(redChannel(down).every((v) => v === 200)).toBe(true)
    expect(redChannel(up).every((v) => v === 200)).toBe(true)
  })

  test('keeps the corner pixels when enlarging', () => {
    const out = resampleRgba(
      reds([10, 20, 30, 40]),
      { width: 2, height: 2 },
      {
        width: 8,
        height: 8,
      },
    )
    expect(out[0]).toBe(10)
    expect(out[(7 * 8 + 7) * 4]).toBe(40)
  })

  test('interpolates instead of stair-stepping', () => {
    const out = resampleRgba(reds([0, 255]), { width: 2, height: 1 }, { width: 4, height: 1 })
    const second = out[4] ?? 0
    expect(second).toBeGreaterThan(0)
    expect(second).toBeLessThan(255)
  })

  test('carries the alpha channel through', () => {
    const source = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255])
    const out = resampleRgba(source, { width: 2, height: 1 }, { width: 2, height: 1 })
    expect(out[3]).toBe(0)
    expect(out[7]).toBe(255)
  })

  test('handles a non-square target', () => {
    const out = resampleRgba(
      reds([1, 2, 3, 4]),
      { width: 2, height: 2 },
      {
        width: 64,
        height: 32,
      },
    )
    expect(out.length).toBe(64 * 32 * 4)
  })
})

describe('resampleGray', () => {
  test('copies when the size already matches', () => {
    const source = new Uint8Array([1, 2, 3, 4])
    const out = resampleGray(source, { width: 2, height: 2 }, { width: 2, height: 2 })
    expect(Array.from(out)).toEqual([1, 2, 3, 4])
  })

  test('stays inside 0..255 even though lanczos overshoots', () => {
    // A hard step is the worst case for ringing.
    const step = new Uint8Array(32)
    step.fill(255, 16)
    const out = resampleGray(step, { width: 32, height: 1 }, { width: 128, height: 1 })
    expect(Array.from(out).every((v) => v >= 0 && v <= 255)).toBe(true)
  })

  test('leaves a straighter diagonal edge than a triangle filter', () => {
    // Stair-stepping on a diagonal is what "jaggy" means here. Measure it:
    // walk the 50% contour and see how far it wobbles off a straight line.
    const from = 32
    const to = 128
    const diagonal = new Uint8Array(from * from)
    for (let y = 0; y < from; y++) {
      for (let x = 0; x < from; x++) diagonal[y * from + x] = x > y ? 255 : 0
    }

    const wobble = (kernel: 'triangle' | 'lanczos3'): number => {
      const mask = resampleGray(
        diagonal,
        { width: from, height: from },
        { width: to, height: to },
        undefined,
        kernel,
      )
      const offsets: number[] = []
      for (let y = 4; y < to - 4; y++) {
        for (let x = 1; x < to; x++) {
          const before = mask[y * to + x - 1] ?? 0
          const after = mask[y * to + x] ?? 0
          if (before < 128 && after >= 128) {
            offsets.push(x - 1 + (128 - before) / Math.max(1, after - before) - y)
            break
          }
        }
      }
      const mean = offsets.reduce((sum, v) => sum + v, 0) / offsets.length
      return Math.sqrt(offsets.reduce((sum, v) => sum + (v - mean) ** 2, 0) / offsets.length)
    }

    expect(wobble('lanczos3')).toBeLessThan(wobble('triangle') * 0.8)
  })

  test('keeps a flat mask flat', () => {
    const flat = new Uint8Array(100).fill(137)
    const out = resampleGray(flat, { width: 10, height: 10 }, { width: 27, height: 13 })
    expect(Array.from(out).every((v) => v === 137)).toBe(true)
  })

  test('averages when shrinking rather than dropping rows', () => {
    // Alternating rows of 0 and 255: any correct shrink gives mid grey.
    const rows = new Uint8Array(16 * 16)
    for (let y = 0; y < 16; y++) rows.fill(y % 2 === 0 ? 0 : 255, y * 16, (y + 1) * 16)

    const out = resampleGray(rows, { width: 16, height: 16 }, { width: 4, height: 4 })
    for (const value of out) {
      expect(value).toBeGreaterThan(100)
      expect(value).toBeLessThan(155)
    }
  })
})
