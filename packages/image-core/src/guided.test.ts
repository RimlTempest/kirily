import { describe, expect, test } from 'bun:test'
import { DEFAULT_REFINE, refineMask, refineRadiusFor } from './guided.ts'

/** An image split down the middle: black on the left, white on the right. */
const splitImage = (width: number, height: number, edge: number): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = x < edge ? 0 : 255
      const at = (y * width + x) * 4
      rgba[at] = value
      rgba[at + 1] = value
      rgba[at + 2] = value
      rgba[at + 3] = 255
    }
  }
  return rgba
}

/**
 * The mask a model might return: the right answer, but a few pixels off and
 * blurred, as a 1024² mask blown up to this size would be.
 */
const offsetRamp = (width: number, height: number, edge: number, ramp: number): Uint8Array => {
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x - (edge - ramp)) / (ramp * 2)
      mask[y * width + x] = Math.round(Math.min(1, Math.max(0, t)) * 255)
    }
  }
  return mask
}

const size = { width: 64, height: 64 }
const EDGE = 32
const ROW = 32 * size.width

describe('refineMask', () => {
  test('snaps a soft mask edge onto the image edge', () => {
    const rgba = splitImage(64, 64, EDGE)
    const before = offsetRamp(64, 64, EDGE - 6, 6)
    const after = refineMask(rgba, new Uint8Array(before), size, {
      radius: 16,
      epsilon: 1e-4,
      subsample: 1,
      minVariance: 0,
    })

    const step = (mask: Uint8Array): number => (mask[ROW + EDGE] ?? 0) - (mask[ROW + EDGE - 1] ?? 0)

    expect(step(after)).toBeGreaterThan(step(before) * 5)
    expect(after[ROW + EDGE - 2]).toBeLessThan(before[ROW + EDGE - 2] ?? 0)
    expect(after[ROW + 56]).toBeGreaterThan(231)
  })

  test('puts the steepest transition on the image edge', () => {
    const rgba = splitImage(64, 64, EDGE)
    const after = refineMask(rgba, offsetRamp(64, 64, EDGE - 6, 6), size, {
      radius: 16,
      epsilon: 1e-4,
      subsample: 1,
      minVariance: 0,
    })

    let steepest = 1
    let best = -1
    for (let x = 1; x < 64; x++) {
      const delta = Math.abs((after[ROW + x] ?? 0) - (after[ROW + x - 1] ?? 0))
      if (delta > best) {
        best = delta
        steepest = x
      }
    }
    expect(steepest).toBe(EDGE)
  })

  test('leaves a mask alone where the image has no edge', () => {
    const rgba = new Uint8ClampedArray(32 * 32 * 4).fill(128)
    const mask = refineMask(rgba, new Uint8Array(32 * 32).fill(200), {
      width: 32,
      height: 32,
    })
    // A flat guide carries no information, so the filter falls back to the
    // local mean — which for a flat mask is the mask itself.
    expect(Array.from(mask).every((v) => Math.abs(v - 200) <= 1)).toBe(true)
  })

  test('keeps a fully opaque mask opaque and a transparent one transparent', () => {
    const rgba = splitImage(48, 48, 24)
    const opaque = refineMask(rgba, new Uint8Array(48 * 48).fill(255), {
      width: 48,
      height: 48,
    })
    const clear = refineMask(rgba, new Uint8Array(48 * 48), { width: 48, height: 48 })

    expect(Array.from(opaque).every((v) => v > 250)).toBe(true)
    expect(Array.from(clear).every((v) => v < 5)).toBe(true)
  })

  test('subsampling stays close to the exact result', () => {
    const rgba = splitImage(96, 96, 48)
    const original = offsetRamp(96, 96, 44, 6)
    const big = { width: 96, height: 96 }

    const exact = refineMask(rgba, new Uint8Array(original), big, {
      radius: 12,
      epsilon: 1e-4,
      subsample: 1,
      minVariance: 0,
    })
    const fast = refineMask(rgba, new Uint8Array(original), big, {
      radius: 12,
      epsilon: 1e-4,
      subsample: 4,
      minVariance: 0,
    })

    let error = 0
    for (let i = 0; i < exact.length; i++) error += Math.abs((exact[i] ?? 0) - (fast[i] ?? 0))
    expect(error / exact.length).toBeLessThan(6)
  })

  test('is a no-op at radius zero', () => {
    const rgba = splitImage(16, 16, 8)
    const original = offsetRamp(16, 16, 6, 3)
    const out = refineMask(
      rgba,
      new Uint8Array(original),
      { width: 16, height: 16 },
      {
        ...DEFAULT_REFINE,
        radius: 0,
      },
    )
    expect(Array.from(out)).toEqual(Array.from(original))
  })

  test('keeps a confident region even when the guide disagrees', () => {
    // A bright highlight inside the subject, on an image whose background is
    // also bright: locally "bright" means "background", so a filter with no
    // guard rails drags the highlight to transparent. The model was certain
    // here — the mask is flatly opaque — so it has to survive.
    const w = 64
    const rgba = new Uint8ClampedArray(w * w * 4).fill(255)
    for (let y = 0; y < w; y++) {
      for (let x = 16; x < 48; x++) {
        const at = (y * w + x) * 4
        rgba[at] = 60
        rgba[at + 1] = 90
        rgba[at + 2] = 180
      }
    }
    for (let y = 24; y < 40; y++) {
      for (let x = 26; x < 34; x++) {
        const at = (y * w + x) * 4
        rgba[at] = 254
        rgba[at + 1] = 254
        rgba[at + 2] = 254
      }
    }

    const mask = new Uint8Array(w * w)
    for (let y = 0; y < w; y++) mask.fill(255, y * w + 16, y * w + 48)

    // 4 px on a 64 px image is the fraction the helper gives on a real one.
    refineMask(rgba, mask, { width: w, height: w }, { ...DEFAULT_REFINE, radius: 4 })

    expect(mask[32 * w + 30]).toBeGreaterThan(231)
  })

  test('scales its reach with the image so it cannot reach into the subject', () => {
    expect(refineRadiusFor({ width: 1254, height: 1254 })).toBe(6)
    expect(refineRadiusFor({ width: 4000, height: 3000 })).toBe(20)
    // Never so small that it cannot correct anything.
    expect(refineRadiusFor({ width: 120, height: 120 })).toBe(4)
  })

  test('is a no-op when the buffers do not match the size', () => {
    const mask = new Uint8Array(10).fill(100)
    refineMask(new Uint8ClampedArray(64), mask, { width: 4, height: 4 })
    expect(Array.from(mask).every((v) => v === 100)).toBe(true)
  })
})
