import { describe, expect, test } from 'bun:test'
import type { ModelSpec } from './model-spec.ts'
import { BIREFNET_LITE, U2NETP } from './model-spec.ts'
import { toAlphaMask, toInputTensor } from './tensor.ts'

/** A tiny model spec keeps the expected values calculable by hand. */
const tiny = (overrides: Partial<ModelSpec> = {}): ModelSpec => ({
  id: 'tiny',
  label: 'tiny',
  inputSize: 2,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  outputActivation: 'none',
  rescaleOutput: false,
  provenance: { source: 'test', license: 'none' },
  ...overrides,
})

describe('toInputTensor', () => {
  test('lays the channels out planar, not interleaved', () => {
    const rgba = new Uint8ClampedArray([
      255,
      0,
      0,
      255, // red
      0,
      255,
      0,
      255, // green
      0,
      0,
      255,
      255, // blue
      255,
      255,
      255,
      255, // white
    ])

    const tensor = toInputTensor(rgba, { width: 2, height: 2 }, tiny())

    expect(tensor.length).toBe(12)
    expect(Array.from(tensor.slice(0, 4))).toEqual([1, 0, 0, 1]) // R plane
    expect(Array.from(tensor.slice(4, 8))).toEqual([0, 1, 0, 1]) // G plane
    expect(Array.from(tensor.slice(8, 12))).toEqual([0, 0, 1, 1]) // B plane
  })

  test('drops the alpha channel', () => {
    const opaque = new Uint8ClampedArray([10, 20, 30, 255])
    const transparent = new Uint8ClampedArray([10, 20, 30, 0])
    const spec = tiny({ inputSize: 1 })

    expect(Array.from(toInputTensor(opaque, { width: 1, height: 1 }, spec))).toEqual(
      Array.from(toInputTensor(transparent, { width: 1, height: 1 }, spec)),
    )
  })

  test('applies the ImageNet normalisation the models were trained with', () => {
    const grey = new Uint8ClampedArray([128, 128, 128, 255])
    const spec = tiny({ inputSize: 1, mean: BIREFNET_LITE.mean, std: BIREFNET_LITE.std })

    const tensor = toInputTensor(grey, { width: 1, height: 1 }, spec)

    expect(tensor[0]).toBeCloseTo((128 / 255 - 0.485) / 0.229, 5)
    expect(tensor[1]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 5)
    expect(tensor[2]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5)
  })

  test('resizes an arbitrary image to the model input', () => {
    const rgba = new Uint8ClampedArray(7 * 3 * 4).fill(255)
    const tensor = toInputTensor(rgba, { width: 7, height: 3 }, U2NETP)
    expect(tensor.length).toBe(3 * 320 * 320)
  })

  test('writes into a caller-provided buffer so it can be reused', () => {
    const out = new Float32Array(3 * 4)
    const result = toInputTensor(new Uint8ClampedArray(16), { width: 2, height: 2 }, tiny(), out)
    expect(result).toBe(out)
  })
})

describe('toAlphaMask', () => {
  test('passes probabilities straight through when the graph applied sigmoid', () => {
    const output = new Float32Array([0, 0.5, 1, 1])
    const mask = toAlphaMask(output, tiny(), { width: 2, height: 2 })
    expect(Array.from(mask)).toEqual([0, 128, 255, 255])
  })

  test('squashes logits when the graph did not', () => {
    const output = new Float32Array([-10, 0, 10, 10])
    const mask = toAlphaMask(output, tiny({ outputActivation: 'sigmoid' }), {
      width: 2,
      height: 2,
    })
    expect(mask[0]).toBe(0)
    expect(mask[1]).toBe(128)
    expect(mask[2]).toBe(255)
  })

  test('stretches a low-contrast saliency map to the full range', () => {
    const output = new Float32Array([0.2, 0.3, 0.5, 0.6])
    const mask = toAlphaMask(output, tiny({ rescaleOutput: true }), { width: 2, height: 2 })
    expect(mask[0]).toBe(0)
    expect(mask[3]).toBe(255)
  })

  test('leaves a flat output alone rather than amplifying noise', () => {
    const output = new Float32Array([0.5, 0.5, 0.5, 0.5])
    const mask = toAlphaMask(output, tiny({ rescaleOutput: true }), { width: 2, height: 2 })
    expect(Array.from(mask)).toEqual([128, 128, 128, 128])
  })

  test('resamples up to the image the user opened', () => {
    const output = new Float32Array([0, 1, 0, 1])
    const mask = toAlphaMask(output, tiny(), { width: 8, height: 4 })

    expect(mask.length).toBe(32)
    expect(mask[0]).toBe(0)
    expect(mask[7]).toBe(255)
  })

  test('keeps a hard edge hard when the target is the same size', () => {
    const output = new Float32Array([0, 0, 1, 1])
    const mask = toAlphaMask(output, tiny(), { width: 2, height: 2 })
    expect(Array.from(mask)).toEqual([0, 0, 255, 255])
  })
})
