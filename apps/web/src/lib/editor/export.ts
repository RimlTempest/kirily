/**
 * The export pipeline (kirily-design.md §17, Rule 2).
 *
 * It starts from the original pixels every time. The preview canvas is never
 * read: it is a downscaled, already-composited approximation, and using it
 * would silently throw away the resolution the user came here to keep.
 */
import type { Rect } from '@kirily/contract/geometry'
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { Rgb } from '@kirily/image-core/composite'
import type { Backdrop } from '@kirily/image-core/backdrop'
import { compositeBackdrop } from '@kirily/image-core/backdrop'
import type { Placement } from '@kirily/image-core/placement'
import { isPlaced, placedSample } from '@kirily/image-core/placement'
import { decontaminate } from '@kirily/image-core/decontaminate'
import type { ColourField } from '@kirily/image-core/field'
import type { ImageEngine } from '@kirily/wasm'

export const ExportFormat = {
  Png: 'image/png',
  WebP: 'image/webp',
  Jpeg: 'image/jpeg',
} as const

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat]

export const extensionFor = (format: ExportFormat): string =>
  format === ExportFormat.Png ? 'png' : format === ExportFormat.WebP ? 'webp' : 'jpg'

export type ExportRequest = {
  readonly format: ExportFormat
  /** 0..1. Ignored for PNG, which is lossless. */
  readonly quality: number
  /** Where transparency goes: a flat colour, unless `backdrop` supplies pixels. */
  readonly background: Rgb
  /** An image to put behind the cut-out, framed to cover the whole picture. */
  readonly backdrop: Backdrop | null
  /** Where that image was dragged to, on top of the cover fit. */
  readonly backdropPlacement: Placement
  /** Where the cut-out was dragged to, in the original's pixels. */
  readonly subjectPlacement: Placement
  /** True to flatten onto `background` even in a format that could keep alpha. */
  readonly flatten: boolean
  readonly rect: Rect
}

export type ExportSource = {
  readonly width: number
  readonly height: number
  /** The original pixels. Not modified. */
  readonly rgba: Uint8ClampedArray
  /** The composed mask at original resolution. */
  readonly mask: Uint8Array
  /**
   * The old background, as measured when the AI last ran. Without it the soft
   * edge keeps the colour it was mixed with, which is invisible against the
   * editor's checkerboard and obvious on someone else's slide.
   */
  readonly background: ColourField | null
}

/**
 * Renders at the original resolution and encodes once.
 *
 * The image is encoded exactly once, at the end: re-encoding between steps is
 * what turns an edit session into a generation-loss machine
 * (kirily-design.md §2.3).
 */
export const exportImage = async (
  engine: ImageEngine,
  source: ExportSource,
  request: ExportRequest,
): Promise<Result<Blob, KirilyError>> => {
  const { rect } = request
  const cropped = new Uint8ClampedArray(rect.width * rect.height * 4)
  const croppedMask = new Uint8Array(rect.width * rect.height)

  if (isPlaced(request.subjectPlacement)) {
    // The cut-out has been dragged, so the crop is no longer a rectangle of
    // the original: each output pixel has to be told where to read from.
    gather(source, rect, request.subjectPlacement, cropped, croppedMask)
  } else {
    const crop = engine.cropRgba(source.rgba, source, rect, cropped)
    if (!crop.ok) return crop
    croppedMask.set(cropMask(source.mask, source, rect))
  }

  const masked = engine.applyAlphaMask(cropped, croppedMask, rect)
  if (!masked.ok) return masked

  if (source.background !== null) {
    // After the alpha is in place and before anything reads the colour: the
    // correction needs the coverage, and JPEG's flatten would bake the halo in.
    const cleaned = decontaminate(cropped, croppedMask, rect, source.background, rect)
    if (!cleaned.ok) return cleaned
  }

  // Ordered so each step sees what it needs: the alpha has to be in place for
  // the correction, the correction has to be done before anything reads the
  // colour, and flattening throws the alpha away so it goes last.
  if (request.backdrop !== null) {
    compositeBackdrop(cropped, rect, request.backdrop, rect, source, request.backdropPlacement)
  } else if (request.flatten || request.format === ExportFormat.Jpeg) {
    const flattened = engine.flattenOnto(cropped, rect, request.background)
    if (!flattened.ok) return flattened
  }

  return encode(cropped, rect, request)
}

/**
 * Reads the moved cut-out into the output rectangle.
 *
 * Nearest neighbour rather than a resample: at scale 1 — a plain move, which
 * is what this is for — the mapping is exact and anything else would soften
 * an edge the rest of the pipeline works to keep sharp.
 */
const gather = (
  source: ExportSource,
  rect: Rect,
  placement: Placement,
  colour: Uint8ClampedArray,
  mask: Uint8Array,
): void => {
  const image = { width: source.width, height: source.height }
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const from = placedSample(placement, rect.x + x, rect.y + y, image)
      const sx = Math.round(from.x)
      const sy = Math.round(from.y)
      const at = (y * rect.width + x) * 4
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue

      const read = (sy * source.width + sx) * 4
      colour[at] = source.rgba[read] ?? 0
      colour[at + 1] = source.rgba[read + 1] ?? 0
      colour[at + 2] = source.rgba[read + 2] ?? 0
      colour[at + 3] = 255
      mask[y * rect.width + x] = source.mask[sy * source.width + sx] ?? 0
    }
  }
}

const cropMask = (
  mask: Uint8Array,
  size: { readonly width: number; readonly height: number },
  rect: Rect,
): Uint8Array => {
  if (rect.x === 0 && rect.y === 0 && rect.width === size.width && rect.height === size.height) {
    return mask
  }
  const out = new Uint8Array(rect.width * rect.height)
  for (let row = 0; row < rect.height; row++) {
    const from = (rect.y + row) * size.width + rect.x
    out.set(mask.subarray(from, from + rect.width), row * rect.width)
  }
  return out
}

const encode = async (
  // `ImageData` insists on a buffer that is not shared. Saying so here is
  // better than asserting it at the call site.
  rgba: Uint8ClampedArray<ArrayBuffer>,
  size: { readonly width: number; readonly height: number },
  request: ExportRequest,
): Promise<Result<Blob, KirilyError>> => {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (context === null) {
    return err(kirilyError(KirilyErrorCode.ExportFailed, 'no 2d context'))
  }
  context.putImageData(new ImageData(rgba, size.width, size.height), 0, 0)

  try {
    // PNG is lossless, so a quality value is meaningless there — and passing
    // `undefined` explicitly is not the same as omitting the key.
    const options: ImageEncodeOptions =
      request.format === ExportFormat.Png
        ? { type: request.format }
        : { type: request.format, quality: request.quality }
    const blob = await canvas.convertToBlob(options)
    // Safari has historically fallen back to PNG rather than failing loudly.
    if (blob.type !== request.format) {
      return err(kirilyError(KirilyErrorCode.ExportFailed, `got ${blob.type}`))
    }
    return ok(blob)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown'
    return err(kirilyError(KirilyErrorCode.ExportFailed, detail))
  }
}

/** Hands the blob to the browser's download flow and releases it again. */
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
