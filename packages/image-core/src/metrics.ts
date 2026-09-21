/**
 * How close a mask is to the right answer.
 *
 * Kirily's quality claims have so far been single probes in an end-to-end test
 * ("this pixel is above 223"). That catches a mask that collapses; it says
 * nothing about a change that trades a cleaner shoulder for a worse hairline.
 * These three numbers are what `tests/e2e/specs/quality.spec.ts` records so a
 * trade can be seen instead of argued about.
 *
 * - `iou` — the silhouette. Blind to soft edges by construction.
 * - `boundaryFScore` — the outline, with a tolerance, so being one pixel off
 *   is not scored the same as missing the edge entirely.
 * - `meanAbsoluteError` — the alpha itself, which is the only one of the three
 *   that can see a hardened edge or a half-transparent interior.
 *
 * No Rust mirror: nothing in the product calls these, so a second copy would
 * be code that only its own tests ever run.
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'

export type Size = { readonly width: number; readonly height: number }

/** At and above this, a pixel counts as part of the subject. */
const INSIDE = 128

const sameLength = (a: Uint8Array, b: Uint8Array, where: string): Result<void, KirilyError> =>
  a.length === b.length
    ? ok(undefined)
    : err(kirilyError(KirilyErrorCode.SizeMismatch, `${where}: ${a.length} vs ${b.length}`))

/**
 * Intersection over union of the two silhouettes.
 *
 * Two empty masks score 1: there was nothing to find and nothing was claimed,
 * which is agreement, not failure.
 */
export const iou = (predicted: Uint8Array, truth: Uint8Array): Result<number, KirilyError> => {
  const checked = sameLength(predicted, truth, 'iou')
  if (!checked.ok) return checked

  let intersection = 0
  let union = 0
  for (let i = 0; i < predicted.length; i += 1) {
    const a = (predicted[i] ?? 0) >= INSIDE
    const b = (truth[i] ?? 0) >= INSIDE
    if (a && b) intersection += 1
    if (a || b) union += 1
  }
  return ok(union === 0 ? 1 : intersection / union)
}

/** Mean absolute difference in alpha, as a fraction of full range. */
export const meanAbsoluteError = (
  predicted: Uint8Array,
  truth: Uint8Array,
): Result<number, KirilyError> => {
  const checked = sameLength(predicted, truth, 'meanAbsoluteError')
  if (!checked.ok) return checked
  if (predicted.length === 0) return ok(0)

  let total = 0
  for (let i = 0; i < predicted.length; i += 1) {
    total += Math.abs((predicted[i] ?? 0) - (truth[i] ?? 0))
  }
  return ok(total / (predicted.length * 255))
}

/**
 * Marks the inside pixels that touch the outside.
 *
 * A neighbour off the image does not make a boundary. A subject cropped by the
 * frame has no visible edge there, and counting the frame would reward a model
 * for simply stopping at it.
 */
const boundaryOf = (mask: Uint8Array, size: Size): Uint8Array => {
  const { width, height } = size
  const edges = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if ((mask[index] ?? 0) < INSIDE) continue
      const open =
        (x > 0 && (mask[index - 1] ?? 0) < INSIDE)
        || (x + 1 < width && (mask[index + 1] ?? 0) < INSIDE)
        || (y > 0 && (mask[index - width] ?? 0) < INSIDE)
        || (y + 1 < height && (mask[index + width] ?? 0) < INSIDE)
      if (open) edges[index] = 1
    }
  }
  return edges
}

/** The fraction of `from`'s boundary that has a `to` boundary pixel within `tolerance`. */
const covered = (
  from: Uint8Array,
  to: Uint8Array,
  size: Size,
  tolerance: number,
): [number, number] => {
  const { width, height } = size
  const reach = Math.ceil(tolerance)
  const limit = tolerance * tolerance
  let matched = 0
  let total = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (from[y * width + x] !== 1) continue
      total += 1

      const top = Math.max(0, y - reach)
      const bottom = Math.min(height - 1, y + reach)
      const left = Math.max(0, x - reach)
      const right = Math.min(width - 1, x + reach)
      for (let ny = top; ny <= bottom; ny += 1) {
        const dy = ny - y
        for (let nx = left; nx <= right; nx += 1) {
          const dx = nx - x
          if (dx * dx + dy * dy > limit) continue
          if (to[ny * width + nx] === 1) {
            matched += 1
            ny = bottom
            break
          }
        }
      }
    }
  }
  return [matched, total]
}

/**
 * The DAVIS boundary F-score: precision and recall over boundary pixels that
 * are allowed to be `tolerance` pixels apart.
 *
 * `defaultTolerance` scales with the image, because "two pixels off" means
 * something different at 400px and at 4000px.
 */
export const boundaryFScore = (
  predicted: Uint8Array,
  truth: Uint8Array,
  size: Size,
  tolerance: number,
): Result<number, KirilyError> => {
  const checked = sameLength(predicted, truth, 'boundaryFScore')
  if (!checked.ok) return checked
  if (predicted.length !== size.width * size.height) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `boundaryFScore: ${predicted.length} vs ${size.width}x${size.height}`,
      ),
    )
  }

  const predictedEdges = boundaryOf(predicted, size)
  const truthEdges = boundaryOf(truth, size)

  const [matchedPredicted, totalPredicted] = covered(predictedEdges, truthEdges, size, tolerance)
  const [matchedTruth, totalTruth] = covered(truthEdges, predictedEdges, size, tolerance)

  // Neither has an outline: nothing to align, so nothing is wrong.
  if (totalPredicted === 0 && totalTruth === 0) return ok(1)
  if (totalPredicted === 0 || totalTruth === 0) return ok(0)

  const precision = matchedPredicted / totalPredicted
  const recall = matchedTruth / totalTruth
  return ok(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall))
}

/** 0.75% of the diagonal — the DAVIS benchmark's figure. */
export const defaultTolerance = (size: Size): number =>
  Math.max(1, Math.round(0.0075 * Math.hypot(size.width, size.height)))
