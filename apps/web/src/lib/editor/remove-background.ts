/**
 * The "背景をきりり" flow, without Svelte.
 *
 * It lives outside `editor-store.svelte.ts` because it is the part worth
 * testing: it sequences four fallible steps, reports progress through two of
 * them, and has to decide what a failure in each one costs the user. Runes
 * cannot be compiled by the unit-test runner, so anything that matters has to
 * sit on this side of the boundary.
 *
 * Everything it touches arrives as a parameter. There is no module state.
 */
import type { BackgroundRemovalProvider } from '@kirily/ai/provider'
import type { KirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import { DEFAULT_REFINE, refineRadiusFor } from '@kirily/image-core/guided'
import type { ImageEngine } from '@kirily/wasm'
import type { DecodedImage } from './decode.ts'

export type RemoveBackgroundDeps = {
  readonly provider: BackgroundRemovalProvider
  /** Loaded lazily: the WASM engine is only needed once a mask exists. */
  readonly engine: () => Promise<ImageEngine>
  /** 0..1 while the model loads. */
  readonly onLoadProgress: (progress: number) => void
  /** Called once the weights are in and inference starts. */
  readonly onInferenceStart: () => void
  /** Called when refinement is skipped. Separated so tests can observe it. */
  readonly onRefineSkipped?: (error: KirilyError) => void
}

export type RemovedBackground = {
  /** Original-resolution alpha, already refined when refinement succeeded. */
  readonly alpha: Uint8Array<ArrayBuffer>
  /** Which provider produced it — the chain may have stepped down. */
  readonly providerId: string
  /** False when the guided filter could not run. */
  readonly refined: boolean
}

/**
 * Loads the model if needed, segments the original image, and pulls the mask's
 * edges onto the image's.
 *
 * A refinement failure is reported but not fatal: a slightly loose mask is
 * worth more to the user than an error and no mask at all.
 */
export const removeBackground = async (
  deps: RemoveBackgroundDeps,
  image: DecodedImage,
): Promise<Result<RemovedBackground, KirilyError>> => {
  const ready = await deps.provider.initialize(deps.onLoadProgress)
  if (!ready.ok) return err(ready.error)

  deps.onInferenceStart()

  // The original pixels, not the preview. The preview has already been shrunk
  // once for the screen; feeding it to the model would resample the image
  // twice before inference and again on the way back, and each pass costs
  // detail the model then cannot see (kirily-design.md §7.2).
  const segmented = await deps.provider.removeBackground({
    width: image.source.width,
    height: image.source.height,
    rgba: image.rgba,
  })
  if (!segmented.ok) return err(segmented.error)

  const alpha = segmented.value.alpha
  const refined = (await deps.engine()).refineMask(image.rgba, alpha, image.source, {
    ...DEFAULT_REFINE,
    radius: refineRadiusFor(image.source),
  })
  if (!refined.ok) deps.onRefineSkipped?.(refined.error)

  return ok({ alpha, providerId: deps.provider.info.id, refined: refined.ok })
}
