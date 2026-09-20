import { describe, expect, test } from 'bun:test'
import { renderViewport } from './viewport.ts'

const IMAGE = { width: 4, height: 4 }

/** A 4x4 image whose red channel is the pixel index, fully opaque. */
const source = () => {
  const rgba = new Uint8ClampedArray(16 * 4)
  for (let i = 0; i < 16; i++) {
    rgba[i * 4] = i * 16
    rgba[i * 4 + 1] = 0
    rgba[i * 4 + 2] = 0
    rgba[i * 4 + 3] = 255
  }
  return { rgba, width: 4, height: 4 }
}

const opaque = (): Uint8Array => new Uint8Array(16).fill(255)

const alphaAt = (out: Uint8ClampedArray, width: number, x: number, y: number): number =>
  out[(y * width + x) * 4 + 3] ?? 0

const redAt = (out: Uint8ClampedArray, width: number, x: number, y: number): number =>
  out[(y * width + x) * 4] ?? 0

describe('renderViewport', () => {
  test('reproduces the image at 1:1 with no offset', () => {
    const out = renderViewport(
      source(),
      opaque(),
      IMAGE,
      { scale: 1, offsetX: 0, offsetY: 0 },
      { width: 4, height: 4 },
    )

    expect(redAt(out, 4, 0, 0)).toBe(0)
    expect(redAt(out, 4, 3, 3)).toBe(240)
    expect(alphaAt(out, 4, 2, 2)).toBe(255)
  })

  test('puts the mask in the alpha channel', () => {
    const mask = opaque()
    mask[5] = 0
    const out = renderViewport(
      source(),
      mask,
      IMAGE,
      { scale: 1, offsetX: 0, offsetY: 0 },
      { width: 4, height: 4 },
    )

    expect(alphaAt(out, 4, 1, 1)).toBe(0)
    expect(alphaAt(out, 4, 0, 0)).toBe(255)
  })

  test('leaves everything outside the image transparent', () => {
    // The image sits in the middle of a larger canvas.
    const out = renderViewport(
      source(),
      opaque(),
      IMAGE,
      { scale: 1, offsetX: 2, offsetY: 2 },
      { width: 8, height: 8 },
    )

    expect(alphaAt(out, 8, 0, 0)).toBe(0)
    expect(alphaAt(out, 8, 7, 7)).toBe(0)
    expect(alphaAt(out, 8, 3, 3)).toBe(255)
  })

  test('pans with the offset', () => {
    const origin = renderViewport(
      source(),
      opaque(),
      IMAGE,
      { scale: 1, offsetX: 0, offsetY: 0 },
      { width: 4, height: 4 },
    )
    const panned = renderViewport(
      source(),
      opaque(),
      IMAGE,
      { scale: 1, offsetX: -1, offsetY: 0 },
      { width: 4, height: 4 },
    )

    // Panning left by one shows what used to be one pixel to the right.
    expect(redAt(panned, 4, 0, 0)).toBe(redAt(origin, 4, 1, 0))
  })

  test('shows whole pixels when zoomed in, not a blur', () => {
    // At 4x each image pixel covers a 4x4 block; the block has to be flat, or
    // the user is editing a smeared approximation of their image.
    const out = renderViewport(
      source(),
      opaque(),
      IMAGE,
      { scale: 4, offsetX: 0, offsetY: 0 },
      { width: 8, height: 8 },
    )

    const first = redAt(out, 8, 0, 0)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) expect(redAt(out, 8, x, y)).toBe(first)
    }
    expect(redAt(out, 8, 4, 0)).not.toBe(first)
  })

  test('blends when zoomed out, so shrinking does not alias', () => {
    const out = renderViewport(
      source(),
      opaque(),
      IMAGE,
      { scale: 0.5, offsetX: 0, offsetY: 0 },
      { width: 2, height: 2 },
    )

    // Each output pixel covers two source pixels, so it lands between them.
    const value = redAt(out, 2, 0, 0)
    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(16 * 16)
  })

  test('samples colour and mask by image coordinates even at different sizes', () => {
    // A half-size colour source — what the preview is — with a full-resolution
    // mask. Both have to be read through the same image coordinates.
    const half = {
      rgba: new Uint8ClampedArray([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]),
      width: 2,
      height: 2,
    }
    const mask = opaque()
    mask[0] = 0

    const out = renderViewport(
      half,
      mask,
      IMAGE,
      { scale: 1, offsetX: 0, offsetY: 0 },
      { width: 4, height: 4 },
    )

    expect(alphaAt(out, 4, 0, 0)).toBe(0)
    expect(alphaAt(out, 4, 3, 3)).toBe(255)
    expect(redAt(out, 4, 3, 3)).toBeGreaterThan(0)
  })

  test('reuses the buffer it is given', () => {
    const out = new Uint8ClampedArray(4 * 4 * 4)
    const result = renderViewport(
      source(),
      opaque(),
      IMAGE,
      { scale: 1, offsetX: 0, offsetY: 0 },
      { width: 4, height: 4 },
      out,
    )
    expect(result).toBe(out)
  })

  test('is a no-op when the buffers do not match their sizes', () => {
    const out = new Uint8ClampedArray(4 * 4 * 4).fill(7)
    renderViewport(
      { rgba: new Uint8ClampedArray(4), width: 4, height: 4 },
      opaque(),
      IMAGE,
      { scale: 1, offsetX: 0, offsetY: 0 },
      { width: 4, height: 4 },
      out,
    )
    expect(Array.from(out).every((v) => v === 7)).toBe(true)
  })
})
