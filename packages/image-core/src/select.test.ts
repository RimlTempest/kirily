import { describe, expect, test } from 'bun:test'
import { refineSelection } from './select.ts'

const WIDTH = 64
const HEIGHT = 64
const size = { width: WIDTH, height: HEIGHT }
/** Halfway down, away from the edges, so the reading is about the boundary. */
const ROW = 32

/**
 * A field whose colour ramps over four pixels, the way an anti-aliased edge
 * does, with a selection that stops dead in the middle of the ramp.
 */
const ramp = (): { rgba: Uint8ClampedArray; selection: Uint8Array } => {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  const selection = new Uint8Array(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x
      const coverage = Math.min(1, Math.max(0, (x - 30) / 4))
      const value = Math.round(255 * (1 - coverage))
      rgba[index * 4] = value
      rgba[index * 4 + 1] = value
      rgba[index * 4 + 2] = value
      rgba[index * 4 + 3] = 255
      // The flood took everything up to the midpoint of the ramp and nothing
      // after it: fully on, then fully off, in one step.
      selection[index] = x < 32 ? 255 : 0
    }
  }
  return { rgba, selection }
}

const at = (selection: Uint8Array, x: number): number => selection[ROW * WIDTH + x] ?? 0

describe('refineSelection', () => {
  test('turns a step into a ramp that follows the image', () => {
    const { rgba, selection } = ramp()
    expect(refineSelection(rgba, selection, size).ok).toBe(true)

    const partial = [...selection].filter((value) => value > 0 && value < 255)
    expect(partial.length).toBeGreaterThan(0)
  })

  test('leaves the far side of the selection alone', () => {
    const { rgba, selection } = ramp()
    refineSelection(rgba, selection, size)
    expect(at(selection, 0)).toBe(255)
    expect(at(selection, WIDTH - 1)).toBe(0)
  })

  test('the ramp runs the right way round', () => {
    const { rgba, selection } = ramp()
    refineSelection(rgba, selection, size)
    // The selection follows the background, which is bright on the left.
    expect(at(selection, 28)).toBeGreaterThan(at(selection, 36))
  })

  test('a selection that takes nothing is left as nothing', () => {
    const { rgba } = ramp()
    const empty = new Uint8Array(WIDTH * HEIGHT)
    expect(refineSelection(rgba, empty, size).ok).toBe(true)
    expect([...empty].every((value) => value === 0)).toBe(true)
  })

  test('a selection that takes everything is left as everything', () => {
    const { rgba } = ramp()
    const all = new Uint8Array(WIDTH * HEIGHT).fill(255)
    expect(refineSelection(rgba, all, size).ok).toBe(true)
    expect([...all].every((value) => value === 255)).toBe(true)
  })

  test('reports a selection that does not match the image', () => {
    const { rgba } = ramp()
    expect(refineSelection(rgba, new Uint8Array(3), size).ok).toBe(false)
  })
})
