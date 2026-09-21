/**
 * Takes the old background's colour back out of the soft edge.
 *
 * A partially covered pixel holds `subject·a + background·(1-a)`. Dropping the
 * background without undoing that mix leaves the familiar halo: a dark subject
 * cut from a light page keeps a pale rim, and it only becomes visible once the
 * cut-out is placed somewhere else (kirily-design.md §7.3).
 *
 * Measured on `tests/fixtures/cases.ts` before this existed: the mean channel
 * error over partially covered pixels was 0.38 on the thin strands and 0.24 on
 * the gradient backdrop. `edgeColourError` is what keeps it honest.
 *
 * The background it corrects against is a `ColourField`, not one sampled
 * colour: correcting a whole photograph against a single sample works on a
 * studio backdrop and smears a tint across everything else (ADR-0011).
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { ColourField, Size } from './field.ts'
import { sampleField } from './field.ts'

/**
 * The colour the subject had before it was mixed, clamped to what a byte can
 * hold.
 *
 * Small alphas amplify: at a = 0.05 a one-unit error in the estimate becomes
 * twenty. Clamping bounds the damage, and such a pixel contributes almost
 * nothing once it is composited again.
 */
export const unmix = (observed: number, background: number, alpha: number): number => {
  if (alpha <= 0) return observed
  const recovered = (observed - background * (1 - alpha)) / alpha
  return Math.round(Math.min(255, Math.max(0, recovered)))
}

/**
 * Corrects the partially covered pixels of `rgba` in place.
 *
 * In place because the caller already owns a copy: the export pipeline works
 * on the cropped buffer it is about to encode, and the renderer corrects the
 * pixels it has just sampled. Neither touches the decoded original.
 *
 * `origin` is where this buffer sits in the full image. A crop carries its own
 * coordinates but the field was measured on the whole picture, so without it a
 * crop would be corrected against the wrong part of the background.
 */
export const decontaminate = (
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  size: Size,
  field: ColourField,
  origin: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): Result<void, KirilyError> => {
  const pixels = size.width * size.height
  if (mask.length !== pixels) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `decontaminate: mask ${mask.length}, expected ${pixels}`,
      ),
    )
  }
  if (rgba.length !== pixels * 4) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `decontaminate: rgba ${rgba.length}, expected ${pixels * 4}`,
      ),
    )
  }

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x
      const coverage = mask[index] ?? 0
      // An untouched pixel holds no background, and an invisible one is never
      // composited: only the band between them carries a halo.
      if (coverage === 0 || coverage === 255) continue

      const background = sampleField(field, origin.x + x, origin.y + y)
      const alpha = coverage / 255
      for (let c = 0; c < 3; c += 1) {
        rgba[index * 4 + c] = unmix(rgba[index * 4 + c] ?? 0, background[c] ?? 0, alpha)
      }
    }
  }
  return ok(undefined)
}
