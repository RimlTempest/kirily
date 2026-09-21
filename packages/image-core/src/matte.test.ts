import { describe, expect, test } from 'bun:test'
import { KirilyErrorCode } from '@kirily/contract/error'
import { err, ok } from '@kirily/contract/result'
import { BACKGROUND_FIELD, FOREGROUND_FIELD, estimateField } from './field.ts'
import { DEFAULT_MATTE, colourMatte } from './matte.ts'

/**
 * A 1-pixel-tall strip: confident background on the left, confident subject on
 * the right, and a band in the middle the mask is unsure about.
 */
const strip = (
  colours: readonly (readonly [number, number, number])[],
  alphas: readonly number[],
): { rgba: Uint8ClampedArray; mask: Uint8Array; size: { width: number; height: number } } => {
  const rgba = new Uint8ClampedArray(colours.length * 4)
  colours.forEach((colour, i) => {
    rgba[i * 4] = colour[0]
    rgba[i * 4 + 1] = colour[1]
    rgba[i * 4 + 2] = colour[2]
    rgba[i * 4 + 3] = 255
  })
  return {
    rgba,
    mask: new Uint8Array(alphas),
    size: { width: colours.length, height: 1 },
  }
}

const WHITE = [255, 255, 255] as const
const BLACK = [0, 0, 0] as const
const GREY = [128, 128, 128] as const

/**
 * One cell covering everything, so these read as statements about the
 * projection and not about the estimator, which has its own tests.
 */
const constant = (colour: readonly [number, number, number]) => ({
  cell: 4096,
  width: 1,
  height: 1,
  rgb: new Uint8Array(colour),
})

const run = (
  input: ReturnType<typeof strip>,
  background: readonly [number, number, number],
  foreground: readonly [number, number, number],
  options = DEFAULT_MATTE,
): ReturnType<typeof colourMatte> =>
  colourMatte(
    input.rgba,
    input.mask,
    input.size,
    { background: constant(background), foreground: constant(foreground) },
    options,
  )

describe('colourMatte', () => {
  test('clears a band pixel that is the background colour', () => {
    // The mask claims 40% coverage where the image is pure background.
    const input = strip([WHITE, WHITE, WHITE, BLACK, BLACK], [0, 0, 102, 255, 255])
    expect(run(input, WHITE, BLACK)).toEqual(ok(undefined))
    expect(input.mask[2]).toBe(0)
  })

  test('fills a band pixel that is the subject colour', () => {
    const input = strip([WHITE, WHITE, BLACK, BLACK, BLACK], [0, 0, 102, 255, 255])
    expect(run(input, WHITE, BLACK)).toEqual(ok(undefined))
    expect(input.mask[2]).toBe(255)
  })

  test('reads a genuine half-covered pixel as half covered', () => {
    const input = strip([WHITE, WHITE, GREY, BLACK, BLACK], [0, 0, 10, 255, 255])
    expect(run(input, WHITE, BLACK)).toEqual(ok(undefined))
    expect(input.mask[2]).toBeGreaterThan(120)
    expect(input.mask[2]).toBeLessThan(136)
  })

  test('leaves confident pixels exactly as the model left them', () => {
    const input = strip([WHITE, WHITE, GREY, BLACK, BLACK], [0, 0, 102, 255, 255])
    run(input, WHITE, BLACK)
    expect(input.mask[0]).toBe(0)
    expect(input.mask[1]).toBe(0)
    expect(input.mask[3]).toBe(255)
    expect(input.mask[4]).toBe(255)
  })

  /**
   * The white-shirt case. When the subject and the background are the same
   * colour the equation has nothing to divide by, and a confident wrong answer
   * is worse than the model's uncertain one.
   */
  test('keeps the model where the subject and the background are the same colour', () => {
    const NEARLY = [250, 250, 249] as const
    const input = strip([WHITE, WHITE, NEARLY, NEARLY, NEARLY], [0, 0, 102, 255, 255])
    run(input, WHITE, NEARLY)
    expect(input.mask[2]).toBe(102)
  })

  test('honours a lower separation limit when told to', () => {
    const NEARLY = [250, 250, 249] as const
    const input = strip([WHITE, WHITE, NEARLY, NEARLY, NEARLY], [0, 0, 102, 255, 255])
    run(input, WHITE, NEARLY, { ...DEFAULT_MATTE, minSeparation: 1 })
    expect(input.mask[2]).not.toBe(102)
  })

  /**
   * The whole point, end to end: the model's ten-pixel ramp over what is
   * actually flat background collapses to an edge, using fields measured from
   * the image rather than handed in.
   */
  test('collapses a ramp the model spread over flat background', () => {
    const width = 96
    const rgba = new Uint8ClampedArray(width * 4)
    const mask = new Uint8Array(width)
    for (let x = 0; x < width; x += 1) {
      const subject = x >= 64
      rgba[x * 4] = subject ? 0 : 255
      rgba[x * 4 + 1] = subject ? 0 : 255
      rgba[x * 4 + 2] = subject ? 0 : 255
      rgba[x * 4 + 3] = 255
      // The model ramps from 54 to 64 although nothing changes until 64.
      mask[x] = x < 54 ? 0 : x < 64 ? Math.round(((x - 54) / 10) * 255) : 255
    }

    const size = { width, height: 1 }
    const background = estimateField(rgba, size, mask, BACKGROUND_FIELD)
    const foreground = estimateField(rgba, size, mask, FOREGROUND_FIELD)
    expect(colourMatte(rgba, mask, size, { background, foreground })).toEqual(ok(undefined))

    for (let x = 54; x < 64; x += 1) expect(mask[x]).toBe(0)
    expect(mask[64]).toBe(255)
  })

  test('reports a mask that does not match the image', () => {
    const input = strip([WHITE, WHITE], [0, 255])
    const field = { cell: 1, width: 1, height: 1, rgb: new Uint8Array([0, 0, 0]) }
    expect(
      colourMatte(
        input.rgba,
        new Uint8Array(3),
        input.size,
        { background: field, foreground: field },
        DEFAULT_MATTE,
      ),
    ).toEqual(
      err({ code: KirilyErrorCode.SizeMismatch, detail: 'colourMatte: mask 3, expected 2' }),
    )
  })

  test('reports pixels that do not match the image', () => {
    const field = { cell: 1, width: 1, height: 1, rgb: new Uint8Array([0, 0, 0]) }
    expect(
      colourMatte(
        new Uint8ClampedArray(12),
        new Uint8Array(2),
        { width: 2, height: 1 },
        { background: field, foreground: field },
        DEFAULT_MATTE,
      ),
    ).toEqual(
      err({ code: KirilyErrorCode.SizeMismatch, detail: 'colourMatte: rgba 12, expected 8' }),
    )
  })
})
