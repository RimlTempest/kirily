/**
 * Composites exactly what is on screen, and nothing else.
 *
 * The obvious way to draw an editor is to composite the whole preview and then
 * let CSS scale it. That costs the same whether the user is looking at the
 * whole image or at twenty pixels of hair, and it means a zoomed-in view shows
 * an enlarged preview rather than the image — which is the one thing someone
 * zooms in to check.
 *
 * Sampling through the viewport instead bounds the work by the size of the
 * canvas rather than the size of the image, and lets a zoomed-in view read the
 * original pixels. It also removes the need to keep a preview-resolution copy
 * of the mask in step with the real one on every brush stroke.
 */
import type { Viewport } from '@kirily/contract/geometry'
import { toImagePoint, screenPoint } from '@kirily/contract/geometry'
import { unmix } from './decontaminate.ts'
import type { ColourField } from './field.ts'
import { sampleField } from './field.ts'
import type { Placement } from './placement.ts'
import { DEFAULT_PLACEMENT, isPlaced, placedSample } from './placement.ts'

export type Size = { readonly width: number; readonly height: number }

/**
 * Where the colour comes from. It may be smaller than the image it stands for
 * — the preview is — because it is addressed in image coordinates either way.
 */
export type ColorSource = {
  readonly rgba: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

/**
 * Past this zoom the user is inspecting individual pixels, so they are shown
 * as squares rather than smoothed into each other.
 */
const NEAREST_ABOVE = 1.5

export const renderViewport = (
  color: ColorSource,
  mask: Uint8Array,
  image: Size,
  viewport: Viewport,
  target: Size,
  out: Uint8ClampedArray = new Uint8ClampedArray(target.width * target.height * 4),
  /**
   * When known, the old background is taken back out of the soft edge as it is
   * drawn. The canvas sits on a checkerboard, so an uncorrected halo is nearly
   * invisible here and obvious the moment the file is used somewhere else —
   * which is the worst possible time to find out.
   */
  background: ColourField | null = null,
  /** Where the cut-out has been moved to, in image pixels. */
  placement: Placement = DEFAULT_PLACEMENT,
): Uint8ClampedArray => {
  if (color.rgba.length !== color.width * color.height * 4) return out
  if (mask.length !== image.width * image.height) return out
  if (out.length !== target.width * target.height * 4) return out

  // Colour and mask are addressed in image coordinates, then scaled into
  // whatever resolution each one happens to be stored at.
  const colorScaleX = color.width / image.width
  const colorScaleY = color.height / image.height
  const nearest = viewport.scale >= NEAREST_ABOVE
  const scale = viewport.scale === 0 ? 1 : viewport.scale
  const placed = isPlaced(placement)

  const turned = viewport.rotation !== 0

  for (let y = 0; y < target.height; y++) {
    const rowOut = y * target.width * 4

    for (let x = 0; x < target.width; x++) {
      // A turned view is undone here, before anything is sampled, so the
      // colour, the mask and the fields below all stay in the image's own
      // coordinates and know nothing about it.
      const viewed = turned ? toImagePoint(screenPoint(x + 0.5, y + 0.5), viewport) : null
      const imageY = viewed === null ? (y + 0.5 - viewport.offsetY) / scale : viewed.y
      const viewX = viewed === null ? (x + 0.5 - viewport.offsetX) / scale : viewed.x
      const at = rowOut + x * 4

      // The placement is undone before anything is read, so everything below
      // — colour, mask, and the decontamination field — stays in the
      // cut-out's own coordinates.
      const moved = placed ? placedSample(placement, viewX, imageY, image) : null
      const imageX = moved === null ? viewX : moved.x
      const sampleY = moved === null ? imageY : moved.y

      if (imageX < 0 || sampleY < 0 || imageX >= image.width || sampleY >= image.height) {
        out[at] = 0
        out[at + 1] = 0
        out[at + 2] = 0
        out[at + 3] = 0
        continue
      }

      const cx = imageX * colorScaleX
      const cy = sampleY * colorScaleY

      if (nearest) {
        const sx = Math.min(color.width - 1, Math.floor(cx))
        const sy = Math.min(color.height - 1, Math.floor(cy))
        const from = (sy * color.width + sx) * 4
        out[at] = color.rgba[from] ?? 0
        out[at + 1] = color.rgba[from + 1] ?? 0
        out[at + 2] = color.rgba[from + 2] ?? 0
        out[at + 3] = sampleMaskNearest(mask, image, imageX, sampleY)
        if (background !== null) correct(out, at, background, imageX, sampleY)
        continue
      }

      sampleColorBilinear(color, cx, cy, out, at)
      out[at + 3] = sampleMaskBilinear(mask, image, imageX, sampleY)
      if (background !== null) correct(out, at, background, imageX, sampleY)
    }
  }

  return out
}

const correct = (
  out: Uint8ClampedArray,
  at: number,
  field: ColourField,
  imageX: number,
  imageY: number,
): void => {
  const coverage = out[at + 3] ?? 0
  if (coverage === 0 || coverage === 255) return
  const sampled = sampleField(field, imageX, imageY)
  const alpha = coverage / 255
  for (let channel = 0; channel < 3; channel++) {
    out[at + channel] = unmix(out[at + channel] ?? 0, sampled[channel] ?? 0, alpha)
  }
}

const sampleColorBilinear = (
  color: ColorSource,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  at: number,
): void => {
  const cx = Math.min(color.width - 1, Math.max(0, x - 0.5))
  const cy = Math.min(color.height - 1, Math.max(0, y - 0.5))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(color.width - 1, x0 + 1)
  const y1 = Math.min(color.height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0

  const topLeft = (y0 * color.width + x0) * 4
  const topRight = (y0 * color.width + x1) * 4
  const bottomLeft = (y1 * color.width + x0) * 4
  const bottomRight = (y1 * color.width + x1) * 4

  for (let channel = 0; channel < 3; channel++) {
    const top = mix(color.rgba[topLeft + channel] ?? 0, color.rgba[topRight + channel] ?? 0, fx)
    const bottom = mix(
      color.rgba[bottomLeft + channel] ?? 0,
      color.rgba[bottomRight + channel] ?? 0,
      fx,
    )
    out[at + channel] = Math.round(mix(top, bottom, fy))
  }
}

const sampleMaskNearest = (mask: Uint8Array, image: Size, x: number, y: number): number => {
  const sx = Math.min(image.width - 1, Math.floor(x))
  const sy = Math.min(image.height - 1, Math.floor(y))
  return mask[sy * image.width + sx] ?? 0
}

const sampleMaskBilinear = (mask: Uint8Array, image: Size, x: number, y: number): number => {
  const cx = Math.min(image.width - 1, Math.max(0, x - 0.5))
  const cy = Math.min(image.height - 1, Math.max(0, y - 0.5))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(image.width - 1, x0 + 1)
  const y1 = Math.min(image.height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0

  const top = mix(mask[y0 * image.width + x0] ?? 0, mask[y0 * image.width + x1] ?? 0, fx)
  const bottom = mix(mask[y1 * image.width + x0] ?? 0, mask[y1 * image.width + x1] ?? 0, fx)
  return Math.round(mix(top, bottom, fy))
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
