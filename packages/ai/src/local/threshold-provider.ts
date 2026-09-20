/**
 * A placeholder provider that runs entirely in the browser.
 *
 * It is *not* the product's background removal — it flood-fills from the image
 * border by colour distance, which works on a flat studio background and fails
 * on hair, as expected. It exists so the whole pipeline (upload → mask →
 * brush → undo → export) can be built, tested and demoed before a segmentation
 * model is chosen, and so the first real model has a green test suite to land
 * against (kirily-design.md §17).
 *
 * Replacing it means writing one new file that satisfies
 * `BackgroundRemovalProvider`. Nothing in the editor changes.
 */
import type { KirilyError } from '@kirily/contract/error'
import { MASK_OPAQUE, MASK_TRANSPARENT } from '@kirily/contract/mask'
import type { Result } from '@kirily/contract/result'
import { ok } from '@kirily/contract/result'
import type { BackgroundRemovalProvider, ImageInput, SegmentationResult } from '../provider.ts'

export type ThresholdOptions = {
  /** 0..255. How far a pixel's colour may sit from the border colour and still
   *  count as background. */
  readonly tolerance: number
}

export const DEFAULT_THRESHOLD: ThresholdOptions = { tolerance: 32 }

const colourDistance = (
  rgba: Uint8ClampedArray,
  index: number,
  r: number,
  g: number,
  b: number,
): number => {
  const dr = (rgba[index] ?? 0) - r
  const dg = (rgba[index + 1] ?? 0) - g
  const db = (rgba[index + 2] ?? 0) - b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** Average colour of the four image borders — the best guess at "background". */
export const borderColour = (input: ImageInput): { r: number; g: number; b: number } => {
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  const sample = (x: number, y: number): void => {
    const index = (y * input.width + x) * 4
    r += input.rgba[index] ?? 0
    g += input.rgba[index + 1] ?? 0
    b += input.rgba[index + 2] ?? 0
    count++
  }

  for (let x = 0; x < input.width; x++) {
    sample(x, 0)
    sample(x, input.height - 1)
  }
  for (let y = 0; y < input.height; y++) {
    sample(0, y)
    sample(input.width - 1, y)
  }

  return { r: r / count, g: g / count, b: b / count }
}

export const segmentByBorderColour = (
  input: ImageInput,
  options: ThresholdOptions,
): SegmentationResult => {
  const { r, g, b } = borderColour(input)
  const pixels = input.width * input.height
  const alpha = new Uint8Array(pixels).fill(MASK_OPAQUE)

  // Flood fill inward from the border: a pixel is background only if it is
  // both close to the border colour *and* connected to the border. A white
  // shirt in the middle of the frame then stays part of the subject.
  const queue: number[] = []
  const push = (index: number): void => {
    if (alpha[index] === MASK_TRANSPARENT) return
    if (colourDistance(input.rgba, index * 4, r, g, b) > options.tolerance) return
    alpha[index] = MASK_TRANSPARENT
    queue.push(index)
  }

  for (let x = 0; x < input.width; x++) {
    push(x)
    push((input.height - 1) * input.width + x)
  }
  for (let y = 0; y < input.height; y++) {
    push(y * input.width)
    push(y * input.width + input.width - 1)
  }

  while (queue.length > 0) {
    const index = queue.pop()
    if (index === undefined) break
    const x = index % input.width
    const y = Math.floor(index / input.width)
    if (x > 0) push(index - 1)
    if (x < input.width - 1) push(index + 1)
    if (y > 0) push(index - input.width)
    if (y < input.height - 1) push(index + input.width)
  }

  return { width: input.width, height: input.height, alpha }
}

export const createThresholdProvider = (
  options: ThresholdOptions = DEFAULT_THRESHOLD,
): BackgroundRemovalProvider => ({
  info: {
    id: 'local-threshold',
    label: 'この画像はブラウザ内で処理されます。',
    requiresUpload: false,
  },
  initialize: async (onProgress): Promise<Result<void, KirilyError>> => {
    onProgress?.(1)
    return ok(undefined)
  },
  removeBackground: async (input): Promise<Result<SegmentationResult, KirilyError>> =>
    ok(segmentByBorderColour(input, options)),
})
