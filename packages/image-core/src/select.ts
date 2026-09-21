/**
 * Giving a selection the edge the image has, not the one a threshold left.
 *
 * A flood fill decides reachability pixel by pixel, so its frontier is a
 * stair-step: measured on `pale-subject-on-white.png`, only 0.3% of the
 * bucket's selection was partial, and the boundary went 255 to 0 in a single
 * step along a visibly ragged line.
 *
 * A selection is a mask, and masks in Kirily get their edges from the image.
 * This is the same two steps the AI's mask goes through — the guided filter
 * pulls the boundary onto the real edge (ADR-0008), then the compositing
 * equation decides the alpha from the pixels (ADR-0013) — applied to what the
 * bucket selected.
 *
 * The selection is inverted first because both of those read a mask as
 * "foreground", and what the bucket usually takes is the background.
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { Size } from './field.ts'
import { BACKGROUND_FIELD, FOREGROUND_FIELD, estimateField } from './field.ts'
import { DEFAULT_REFINE, refineMask, refineRadiusFor } from './guided.ts'
import { colourMatte } from './matte.ts'

export const refineSelection = (
  rgba: Uint8ClampedArray,
  selection: Uint8Array,
  size: Size,
): Result<void, KirilyError> => {
  const pixels = size.width * size.height
  if (selection.length !== pixels) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `refineSelection: selection ${selection.length}, expected ${pixels}`,
      ),
    )
  }
  if (rgba.length !== pixels * 4) {
    return err(
      kirilyError(
        KirilyErrorCode.SizeMismatch,
        `refineSelection: rgba ${rgba.length}, expected ${pixels * 4}`,
      ),
    )
  }

  // Nothing selected, or everything: there is no boundary to put on an edge,
  // and running the filter over a flat mask is work that can only add error.
  let lowest = 255
  let highest = 0
  for (let i = 0; i < pixels; i += 1) {
    const value = selection[i] ?? 0
    if (value < lowest) lowest = value
    if (value > highest) highest = value
  }
  if (lowest === highest) return ok(undefined)

  const inverted = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i += 1) inverted[i] = 255 - (selection[i] ?? 0)

  refineMask(rgba, inverted, size, { ...DEFAULT_REFINE, radius: refineRadiusFor(size) })

  const background = estimateField(rgba, size, inverted, BACKGROUND_FIELD)
  const foreground = estimateField(rgba, size, inverted, FOREGROUND_FIELD)
  const matted = colourMatte(rgba, inverted, size, { background, foreground })
  if (!matted.ok) return matted

  for (let i = 0; i < pixels; i += 1) selection[i] = 255 - (inverted[i] ?? 0)
  return ok(undefined)
}
