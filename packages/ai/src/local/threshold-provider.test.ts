import { describe, expect, test } from 'bun:test'
import {
  borderColour,
  createThresholdProvider,
  segmentByBorderColour,
} from './threshold-provider.ts'

/** A red square centred on a white background. */
const subjectOnWhite = (size: number, squareFrom: number, squareTo: number) => {
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let y = squareFrom; y < squareTo; y++) {
    for (let x = squareFrom; x < squareTo; x++) {
      const i = (y * size + x) * 4
      rgba[i] = 255
      rgba[i + 1] = 0
      rgba[i + 2] = 0
    }
  }
  return { width: size, height: size, rgba }
}

describe('borderColour', () => {
  test('reads the background from the image edges', () => {
    const colour = borderColour(subjectOnWhite(10, 3, 7))
    expect(colour).toEqual({ r: 255, g: 255, b: 255 })
  })
})

describe('segmentByBorderColour', () => {
  test('keeps the subject and removes the connected background', () => {
    const result = segmentByBorderColour(subjectOnWhite(10, 3, 7), { tolerance: 32 })

    expect(result.alpha[0]).toBe(0)
    expect(result.alpha[5 * 10 + 5]).toBe(255)
    expect(result.width).toBe(10)
  })

  test('keeps a background-coloured area that the background does not reach', () => {
    // A white dot inside the red square: the same colour as the background,
    // but not connected to it, so it must stay part of the subject.
    const input = subjectOnWhite(10, 3, 7)
    const i = (5 * 10 + 5) * 4
    input.rgba[i] = 255
    input.rgba[i + 1] = 255
    input.rgba[i + 2] = 255

    const result = segmentByBorderColour(input, { tolerance: 32 })
    expect(result.alpha[5 * 10 + 5]).toBe(255)
  })

  test('a uniform image is removed entirely', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    const result = segmentByBorderColour({ width: 4, height: 4, rgba }, { tolerance: 32 })
    expect([...result.alpha].every((v) => v === 0)).toBe(true)
  })
})

describe('createThresholdProvider', () => {
  test('declares that it does not upload', () => {
    expect(createThresholdProvider().info.requiresUpload).toBe(false)
  })

  test('returns a mask the size of the input', async () => {
    const provider = createThresholdProvider()
    await provider.initialize()
    const result = await provider.removeBackground(subjectOnWhite(8, 2, 6))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.alpha.length).toBe(64)
  })
})
