/**
 * Putting something behind the cut-out.
 *
 * Removing a background is rarely the end of the job — the cut-out goes on
 * something. Kirily could already flatten onto a colour, but only for JPEG and
 * only because JPEG has no choice. This is the same thing offered on purpose,
 * for any format, and with an image as well as a colour.
 *
 * The framing is a `cover` fit, the rule everyone already knows from CSS: fill
 * the frame, keep the proportions, let the overflow fall off the sides. It is
 * a pure function so the preview and the export can agree on where the
 * backdrop sits without either of them asking the other.
 *
 * The frame is the *whole image*, not the crop. A backdrop that re-framed
 * itself every time the crop moved would slide around underneath the subject
 * (ADR-0022).
 */
import type { Size } from './field.ts'
import type { Placement } from './placement.ts'
import { DEFAULT_PLACEMENT, placedSample } from './placement.ts'

export type Cover = {
  /** Multiply the backdrop's pixels by this. */
  readonly scale: number
  /** Then add these, in the frame's coordinates. */
  readonly offsetX: number
  readonly offsetY: number
}

export type Backdrop = {
  // Not `ArrayBufferLike`: these pixels are handed to `ImageData` to be shown
  // behind the canvas, and that refuses a view onto a SharedArrayBuffer.
  readonly rgba: Uint8ClampedArray<ArrayBuffer>
  readonly width: number
  readonly height: number
}

export const coverTransform = (frame: Size, backdrop: Size): Cover => {
  if (backdrop.width <= 0 || backdrop.height <= 0) return { scale: 1, offsetX: 0, offsetY: 0 }

  const scale = Math.max(frame.width / backdrop.width, frame.height / backdrop.height)
  return {
    scale,
    offsetX: (frame.width - backdrop.width * scale) / 2,
    offsetY: (frame.height - backdrop.height * scale) / 2,
  }
}

/**
 * Composites `backdrop` under `target`, in place, and leaves it opaque.
 *
 * `origin` is where `target` sits in the full image, so a crop reads the part
 * of the backdrop it is actually over rather than a re-framed copy.
 */
export const compositeBackdrop = (
  target: Uint8ClampedArray,
  size: Size,
  backdrop: Backdrop,
  origin: { readonly x: number; readonly y: number },
  image: Size,
  /** Where the user dragged and zoomed it to, on top of the cover fit. */
  placement: Placement = DEFAULT_PLACEMENT,
): void => {
  if (target.length !== size.width * size.height * 4) return
  if (backdrop.rgba.length !== backdrop.width * backdrop.height * 4) return

  const cover = coverTransform(image, backdrop)
  if (cover.scale <= 0) return

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const at = (y * size.width + x) * 4
      const alpha = (target[at + 3] ?? 0) / 255
      if (alpha === 1) {
        target[at + 3] = 255
        continue
      }

      // Two steps, outermost first: undo where the user put it, then undo the
      // cover fit that framed it.
      const placed = placedSample(placement, origin.x + x, origin.y + y, image)
      const sourceX = Math.min(
        backdrop.width - 1,
        Math.max(0, Math.floor((placed.x - cover.offsetX) / cover.scale)),
      )
      const sourceY = Math.min(
        backdrop.height - 1,
        Math.max(0, Math.floor((placed.y - cover.offsetY) / cover.scale)),
      )
      const from = (sourceY * backdrop.width + sourceX) * 4

      for (let c = 0; c < 3; c += 1) {
        const above = target[at + c] ?? 0
        const below = backdrop.rgba[from + c] ?? 0
        target[at + c] = Math.round(above * alpha + below * (1 - alpha))
      }
      target[at + 3] = 255
    }
  }
}
