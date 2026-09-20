/**
 * The AI boundary (kirily-design.md §7.1, §21).
 *
 * Kirily does not commit to a model. Every segmentation model, local or
 * remote, is reached through this one type, so swapping the model is a change
 * to one file rather than to the editor.
 *
 * Two rules keep it honest:
 *  - a provider returns an *alpha mask*, never an RGBA image, so the editor
 *    stays in charge of compositing and the user's manual edits survive;
 *  - a provider never sends the image anywhere without the caller having
 *    decided to — `requiresUpload` is what the UI reads to say so.
 */
import type { KirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'

/** Raw pixels, already decoded. Deliberately not an ImageBitmap: a provider
 *  must be runnable in a Worker and in a test. */
export type ImageInput = {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8ClampedArray
}

export type SegmentationResult = {
  readonly width: number
  readonly height: number
  /** One byte per pixel: 0 background, 255 foreground. */
  readonly alpha: Uint8Array
  /**
   * Per-pixel confidence, when the model exposes it. The edge-refinement stage
   * uses it to decide where to trust the mask (kirily-design.md §7.3).
   */
  readonly confidence?: Float32Array
}

export type ProviderInfo = {
  readonly id: string
  /** Shown to the user, e.g. "この画像はブラウザ内で処理されます。" */
  readonly label: string
  /** True when using this provider sends the image off the device. */
  readonly requiresUpload: boolean
}

export type BackgroundRemovalProvider = {
  readonly info: ProviderInfo
  /** Loads weights. Reports 0..1 so the UI can show real progress. */
  readonly initialize: (onProgress?: (value: number) => void) => Promise<Result<void, KirilyError>>
  readonly removeBackground: (input: ImageInput) => Promise<Result<SegmentationResult, KirilyError>>
}
