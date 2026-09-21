import { describe, expect, test } from 'bun:test'
import { DEFAULT_BUCKET } from '@kirily/contract/mask'
import { floodSelect } from './flood.ts'

const SIZE = 16

/**
 * A white canvas with a red square in the middle, and a white dot inside the
 * square that the background cannot reach.
 */
const scene = (): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255)
  const paint = (x: number, y: number, r: number, g: number, b: number): void => {
    const at = (y * SIZE + x) * 4
    rgba[at] = r
    rgba[at + 1] = g
    rgba[at + 2] = b
    rgba[at + 3] = 255
  }
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) paint(x, y, 220, 40, 40)
  paint(8, 8, 255, 255, 255)
  return rgba
}

const size = { width: SIZE, height: SIZE }
const at = (selection: Uint8Array, x: number, y: number): number => selection[y * SIZE + x] ?? 0

describe('floodSelect', () => {
  test('selects the region the click landed in', () => {
    const selection = floodSelect(scene(), size, { x: 0, y: 0 }, DEFAULT_BUCKET)

    expect(at(selection, 0, 0)).toBe(255)
    expect(at(selection, 15, 15)).toBe(255)
    expect(at(selection, 8, 6)).toBe(0)
  })

  test('stops at a colour the tolerance does not cover', () => {
    const selection = floodSelect(scene(), size, { x: 6, y: 6 }, DEFAULT_BUCKET)

    expect(at(selection, 6, 6)).toBe(255)
    expect(at(selection, 0, 0)).toBe(0)
  })

  test('does not leak into an enclosed region of the same colour', () => {
    // The dot at (8,8) is the same white as the background but walled in.
    const selection = floodSelect(scene(), size, { x: 0, y: 0 }, DEFAULT_BUCKET)
    expect(at(selection, 8, 8)).toBe(0)
  })

  test('reaches it when contiguity is turned off', () => {
    const selection = floodSelect(
      scene(),
      size,
      { x: 0, y: 0 },
      {
        ...DEFAULT_BUCKET,
        contiguous: false,
      },
    )
    expect(at(selection, 8, 8)).toBe(255)
  })

  test('fades the boundary instead of cutting it hard', () => {
    // A gentle left-to-right ramp, 200 to 255. Gentle on purpose: a full
    // black-to-white ramp crosses the whole tolerance band in two pixels, so
    // it cannot show whether the falloff is gradual or abrupt.
    const ramp = new Uint8ClampedArray(SIZE * SIZE * 4)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const at4 = (y * SIZE + x) * 4
        const value = 200 + Math.round((x / (SIZE - 1)) * 55)
        ramp[at4] = value
        ramp[at4 + 1] = value
        ramp[at4 + 2] = value
        ramp[at4 + 3] = 255
      }
    }

    const selection = floodSelect(
      ramp,
      size,
      { x: 0, y: 8 },
      {
        tolerance: 0.05,
        feather: 0.6,
        contiguous: true,
        guided: false,
      },
    )

    const values = Array.from({ length: SIZE }, (_, x) => at(selection, x, 8))
    const partial = values.filter((v) => v > 0 && v < 255)
    expect(partial.length).toBeGreaterThan(2)
    // And it never goes back up once it has started falling.
    for (let i = 1; i < values.length; i++) {
      expect(values[i] ?? 0).toBeLessThanOrEqual(values[i - 1] ?? 0)
    }
  })

  test('selects everything at a tolerance that covers the whole image', () => {
    const selection = floodSelect(
      scene(),
      size,
      { x: 0, y: 0 },
      {
        ...DEFAULT_BUCKET,
        tolerance: 2,
      },
    )
    expect(Array.from(selection).every((v) => v === 255)).toBe(true)
  })

  test('selects only the clicked pixel at zero tolerance', () => {
    const selection = floodSelect(
      scene(),
      size,
      { x: 5, y: 5 },
      {
        tolerance: 0,
        feather: 0,
        contiguous: true,
        guided: false,
      },
    )
    expect(at(selection, 5, 5)).toBe(255)
    // The neighbours are the same colour, so they come too — but nothing
    // outside the square does.
    expect(at(selection, 0, 0)).toBe(0)
  })

  test('returns an empty selection when the click is outside the image', () => {
    const selection = floodSelect(scene(), size, { x: -1, y: 99 }, DEFAULT_BUCKET)
    expect(Array.from(selection).every((v) => v === 0)).toBe(true)
  })

  test('reports the bounding box of what it selected', () => {
    const out = new Uint8Array(SIZE * SIZE)
    const bounds = { x: 0, y: 0, width: 0, height: 0 }
    floodSelect(scene(), size, { x: 6, y: 6 }, DEFAULT_BUCKET, out, bounds)

    expect(bounds).toEqual({ x: 4, y: 4, width: 8, height: 8 })
  })

  test('reports an empty box when nothing was selected', () => {
    const bounds = { x: 0, y: 0, width: 0, height: 0 }
    floodSelect(scene(), size, { x: -1, y: -1 }, DEFAULT_BUCKET, undefined, bounds)
    expect(bounds.width).toBe(0)
    expect(bounds.height).toBe(0)
  })
})

describe('the default settings, against the case they were measured on', () => {
  /**
   * A backdrop with the same spread as the project's hardest fixture, and a
   * subject only slightly further away in colour. Both numbers come from
   * measuring `pale-subject-on-white.png`; see `DEFAULT_BUCKET`.
   */
  const almostUniform = (): Uint8ClampedArray => {
    const rgba = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const at4 = (y * SIZE + x) * 4
        // Background: 251,251,250 with a couple of levels of drift.
        const drift = (x + y) % 3
        rgba[at4] = 251 - drift
        rgba[at4 + 1] = 251 - drift
        rgba[at4 + 2] = 250 - drift
        rgba[at4 + 3] = 255
      }
    }
    // The subject: as pale as skin in that fixture.
    for (let y = 6; y < 10; y++) {
      for (let x = 6; x < 10; x++) {
        const at4 = (y * SIZE + x) * 4
        rgba[at4] = 255
        rgba[at4 + 1] = 248
        rgba[at4 + 2] = 242
      }
    }
    return rgba
  }

  test('selects a drifting backdrop fully, not half-way', () => {
    const selection = floodSelect(almostUniform(), size, { x: 0, y: 0 }, DEFAULT_BUCKET)

    // Every background pixel: solidly selected, not a ghost.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (x >= 6 && x < 10 && y >= 6 && y < 10) continue
        expect(at(selection, x, y)).toBeGreaterThan(223)
      }
    }
  })

  test('leaves the subject alone even though it is only barely different', () => {
    const selection = floodSelect(almostUniform(), size, { x: 0, y: 0 }, DEFAULT_BUCKET)
    expect(at(selection, 8, 8)).toBe(0)
  })
})

/** Eight pixels of one colour: the case a colour fill cannot divide. */
const sameColour = (): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(8 * 4)
  for (let i = 0; i < 8; i += 1) {
    rgba[i * 4] = 250
    rgba[i * 4 + 1] = 250
    rgba[i * 4 + 2] = 249
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

describe('floodSelect with an AI guide', () => {
  /**
   * Two halves the same colour, which is the case that defeats a colour fill:
   * a white collar against a white background. The mask is the only thing that
   * knows where one stops.
   */
  const strip = { width: 8, height: 1 }
  /** Left half background, right half subject. */
  const guide = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255])
  const settings = { tolerance: 0.05, feather: 0.2, contiguous: true, guided: true }

  test('without a guide the fill runs straight through into the subject', () => {
    const selection = floodSelect(
      sameColour(),
      strip,
      { x: 0, y: 0 },
      { ...settings, guided: false },
    )
    expect(selection[7]).toBeGreaterThan(0)
  })

  test('with a guide it stops where the subject starts', () => {
    const selection = floodSelect(
      sameColour(),
      strip,
      { x: 0, y: 0 },
      settings,
      undefined,
      undefined,
      guide,
    )
    expect(selection[3]).toBeGreaterThan(0)
    expect(selection[4]).toBe(0)
    expect(selection[7]).toBe(0)
  })

  test('seeded inside the subject it takes the subject, not the background', () => {
    const selection = floodSelect(
      sameColour(),
      strip,
      { x: 7, y: 0 },
      settings,
      undefined,
      undefined,
      guide,
    )
    expect(selection[7]).toBeGreaterThan(0)
    expect(selection[4]).toBeGreaterThan(0)
    expect(selection[3]).toBe(0)
  })

  test('a guide is ignored when the setting is off', () => {
    const selection = floodSelect(
      sameColour(),
      strip,
      { x: 0, y: 0 },
      { ...settings, guided: false },
      undefined,
      undefined,
      guide,
    )
    expect(selection[7]).toBeGreaterThan(0)
  })

  test('a guide of the wrong size is ignored rather than trusted', () => {
    const selection = floodSelect(
      sameColour(),
      strip,
      { x: 0, y: 0 },
      settings,
      undefined,
      undefined,
      new Uint8Array(3),
    )
    expect(selection[7]).toBeGreaterThan(0)
  })
})
