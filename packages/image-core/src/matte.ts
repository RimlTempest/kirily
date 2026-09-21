/**
 * Works the alpha out from the pixels instead of trusting the model's mask.
 *
 * A segmentation mask is the model's outline at the model's resolution.
 * Stretched to the image it arrives as a ramp: measured on
 * `pale-subject-on-white.png`, the edge takes ten pixels to go from alpha 1 to
 * alpha 240, and the pixels inside that ramp read as pure background. Against
 * the editor's checkerboard it is invisible; on a dark slide it is a glow
 * around the whole subject (ADR-0011).
 *
 * The compositing equation says what those pixels should be:
 *
 *     I = a·F + (1 - a)·B
 *
 * With F and B taken as locally constant, a is what you get by projecting the
 * observed colour onto the line between them:
 *
 *     a = dot(I - B, F - B) / |F - B|²
 *
 * B is already measured for decontamination; F is the same estimator looking
 * at the other side of the mask. So the edge is decided by the image's own
 * pixels, at the image's own resolution, and a model that is a quarter of the
 * resolution stops setting the sharpness of the result.
 *
 * Only the band is touched. Where the model is sure, it is left alone: this
 * corrects an outline, it does not re-segment.
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { ColourField, Size } from './field.ts'
import { sampleField } from './field.ts'

export type MatteFields = {
  readonly background: ColourField
  readonly foreground: ColourField
}

export type MatteOptions = {
  /**
   * How far apart F and B must be, in sRGB distance, before colour is allowed
   * to overrule the model.
   */
  readonly minSeparation: number
}

export const DEFAULT_MATTE: MatteOptions = {
  // Measured on `pale-subject-on-white.png`: across the band, |F - B| has a
  // median of 173 and only 0.8% of pixels fall below 24. Those few are the
  // white-collar-on-white-background case, where the equation has nothing to
  // divide by — and there a confident wrong answer is worse than the model's
  // uncertain one, so it keeps the model (ADR-0013).
  minSeparation: 24,
}

export const colourMatte = (
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  size: Size,
  fields: MatteFields,
  options: MatteOptions = DEFAULT_MATTE,
): Result<void, KirilyError> => {
  const pixels = size.width * size.height
  if (mask.length !== pixels) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `colourMatte: mask ${mask.length}, expected ${pixels}`,
      ),
    )
  }
  if (rgba.length !== pixels * 4) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `colourMatte: rgba ${rgba.length}, expected ${pixels * 4}`,
      ),
    )
  }

  const floor = options.minSeparation * options.minSeparation

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const index = y * size.width + x
      const coverage = mask[index] ?? 0
      if (coverage === 0 || coverage === 255) continue

      const background = sampleField(fields.background, x, y)
      const foreground = sampleField(fields.foreground, x, y)

      let along = 0
      let span = 0
      for (let c = 0; c < 3; c += 1) {
        const axis = (foreground[c] ?? 0) - (background[c] ?? 0)
        span += axis * axis
        along += ((rgba[index * 4 + c] ?? 0) - (background[c] ?? 0)) * axis
      }

      // The two sides are the same colour here; the projection would be
      // dividing noise by noise.
      if (span < floor) continue

      const alpha = along / span
      mask[index] = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    }
  }
  return ok(undefined)
}
