import { describe, expect, test } from 'bun:test'
import { BACKGROUND_FIELD, estimateField } from './field.ts'
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

describe('renderViewport with a background field', () => {
  const image = { width: 2, height: 1 }
  const viewport = { scale: 1, offsetX: 0, offsetY: 0 }
  /** Left pixel half covered by white over black; right pixel is that black. */
  const color = {
    width: 2,
    height: 1,
    rgba: new Uint8ClampedArray([128, 128, 128, 255, 0, 0, 0, 255]),
  }
  const mask = new Uint8Array([128, 0])

  test('leaves the soft pixel mixed when no field is given', () => {
    const out = renderViewport(color, mask, image, viewport, image)
    expect([out[0], out[1], out[2], out[3]]).toEqual([128, 128, 128, 128])
  })

  test('gives the soft pixel its own colour back when a field is given', () => {
    const field = estimateField(color.rgba, image, mask, { ...BACKGROUND_FIELD, cell: 16 })
    const out = renderViewport(color, mask, image, viewport, image, undefined, field)
    expect([out[0], out[1], out[2], out[3]]).toEqual([255, 255, 255, 128])
  })

  test('does not touch a fully opaque pixel', () => {
    const solid = new Uint8Array([255, 0])
    const field = estimateField(color.rgba, image, solid, { ...BACKGROUND_FIELD, cell: 16 })
    const out = renderViewport(color, solid, image, viewport, image, undefined, field)
    expect([out[0], out[1], out[2], out[3]]).toEqual([128, 128, 128, 255])
  })
})

describe('renderViewport with the cut-out moved', () => {
  const image = { width: 4, height: 1 }
  const viewport = { scale: 1, offsetX: 0, offsetY: 0 }
  /** One opaque pixel at x = 1, nothing anywhere else. */
  const colour = {
    width: 4,
    height: 1,
    rgba: new Uint8ClampedArray([0, 0, 0, 255, 200, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
  }
  const mask = new Uint8Array([0, 255, 0, 0])

  test('leaves it where it was by default', () => {
    const out = renderViewport(colour, mask, image, viewport, image)
    expect(out[3]).toBe(0)
    expect(out[7]).toBe(255)
  })

  test('moving it right reads it at the new place', () => {
    const out = renderViewport(colour, mask, image, viewport, image, undefined, null, {
      offsetX: 2,
      offsetY: 0,
      scale: 1,
    })
    expect(out[7]).toBe(0)
    expect(out[15]).toBe(255)
    expect(out[12]).toBe(200)
  })

  test('what moves off the frame is transparent, not wrapped', () => {
    const out = renderViewport(colour, mask, image, viewport, image, undefined, null, {
      offsetX: 10,
      offsetY: 0,
      scale: 1,
    })
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(0)
  })
})
