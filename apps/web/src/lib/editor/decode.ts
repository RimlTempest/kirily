/**
 * Decoding a file into pixels.
 *
 * This is the one place that touches the DOM's image APIs. Everything
 * downstream works on plain buffers, which is what lets the mask and export
 * code be unit-tested without a browser (Rule 5).
 */
import type { SourceImage } from '@kirily/contract/image'
import { describeSource } from '@kirily/contract/image'
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { Recorder } from '@kirily/contract/timing'
import { Stage, createStopwatch, replayTimings } from '@kirily/contract/timing'
import type { PreviewBudget } from '@kirily/image-core/preview'
import { previewSizeFor } from '@kirily/image-core/preview'

export type DecodedImage = {
  readonly source: SourceImage
  /** Full-resolution pixels. The export path reads these, never the preview. */
  readonly rgba: Uint8ClampedArray
  /** Downscaled copy for the editor canvas. */
  readonly preview: {
    readonly width: number
    readonly height: number
    readonly rgba: Uint8ClampedArray
  }
}

const readPixels = (
  bitmap: ImageBitmap,
  width: number,
  height: number,
  // Not `ArrayBufferLike`: a canvas never hands back a shared buffer, and
  // saying so is what lets these pixels go to `ImageData` without an assertion.
): Result<Uint8ClampedArray<ArrayBuffer>, KirilyError> => {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) {
    return err(kirilyError(KirilyErrorCode.ImageDecodeFailed, 'no 2d context'))
  }
  context.drawImage(bitmap, 0, 0, width, height)
  return ok(context.getImageData(0, 0, width, height).data)
}

export const decodeFile = async (
  file: File,
  budget: PreviewBudget,
  /** Split in two because they scale differently: one with the file, one with the screen. */
  record: Recorder = () => undefined,
): Promise<Result<DecodedImage, KirilyError>> => {
  const clock = createStopwatch(() => performance.now())
  const report = (): void => replayTimings(clock.timings(), record)
  // The extension is not trusted: only what the browser managed to decode is
  // (IMPLEMENTATION.md §7).
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown'
    return err(kirilyError(KirilyErrorCode.ImageDecodeFailed, detail))
  }

  const described = describeSource({
    width: bitmap.width,
    height: bitmap.height,
    mimeType: file.type,
    fileName: file.name,
    fileSize: file.size,
  })
  if (!described.ok) {
    bitmap.close()
    return described
  }

  const full = clock.measure(Stage.Decode, () => readPixels(bitmap, bitmap.width, bitmap.height))
  if (!full.ok) {
    bitmap.close()
    return full
  }

  const previewSize = previewSizeFor(described.value, budget)
  const preview = clock.measure(Stage.Preview, () =>
    readPixels(bitmap, previewSize.width, previewSize.height),
  )
  report()
  // The bitmap has done its job; holding it would keep a third full-resolution
  // copy of the image alive.
  bitmap.close()
  if (!preview.ok) return preview

  return ok({
    source: described.value,
    rgba: full.value,
    preview: { width: previewSize.width, height: previewSize.height, rgba: preview.value },
  })
}

/**
 * Decodes a picture to put behind the cut-out.
 *
 * Separate from `decodeFile` because it answers to nothing: it is not the
 * thing being edited, so it has no preview, no size budget beyond what the
 * browser will decode, and no `SourceImage` describing it. The only thing that
 * matters is its pixels and its shape.
 */
export const decodeBackdrop = async (
  file: File,
): Promise<
  Result<{ rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }, KirilyError>
> => {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown'
    return err(kirilyError(KirilyErrorCode.ImageDecodeFailed, detail))
  }

  const pixels = readPixels(bitmap, bitmap.width, bitmap.height)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  if (!pixels.ok) return pixels
  return ok({ rgba: pixels.value, ...size })
}
