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
import type { Recorder } from '@kirily/contract/timing'
import { Stage, createStopwatch, replayTimings } from '@kirily/contract/timing'
import type { ColourField } from '@kirily/image-core/field'
import { BACKGROUND_FIELD, FOREGROUND_FIELD, estimateField } from '@kirily/image-core/field'
import { DEFAULT_REFINE, refineRadiusFor } from '@kirily/image-core/guided'
import { colourMatte } from '@kirily/image-core/matte'
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
  /** Where the mask stages report to. Defaults to nowhere. */
  readonly record?: Recorder
}

export type RemovedBackground = {
  /** Original-resolution alpha, already refined when refinement succeeded. */
  readonly alpha: Uint8Array<ArrayBuffer>
  /** Which provider produced it — the chain may have stepped down. */
  readonly providerId: string
  /** False when the guided filter could not run. */
  readonly refined: boolean
  /**
   * The old background's colour, measured here because the matting pass needs
   * it anyway. Handing it back saves the store a second full-image scan.
   */
  readonly background: ColourField
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
  const clock = createStopwatch(() => performance.now())
  const engine = await deps.engine()
  const refined = clock.measure(Stage.MaskRefine, () =>
    engine.refineMask(image.rgba, alpha, image.source, {
      ...DEFAULT_REFINE,
      radius: refineRadiusFor(image.source),
    }),
  )
  if (!refined.ok) deps.onRefineSkipped?.(refined.error)

  // Last, and at full resolution: the guided filter pulls the model's outline
  // towards the image's, and this decides the outline from the image's own
  // pixels. Running it before refinement would hand the filter an edge it
  // would then soften again.
  // Both fields are inside the measurement: estimating them is most of the
  // cost, and the background one is only computed here because matting needs
  // it — decontamination gets it for free afterwards.
  const background = estimateField(image.rgba, image.source, alpha, BACKGROUND_FIELD)
  const matted = clock.measure(Stage.MaskMatte, () => {
    const foreground = estimateField(image.rgba, image.source, alpha, FOREGROUND_FIELD)
    return colourMatte(image.rgba, alpha, image.source, { background, foreground })
  })
  if (!matted.ok) deps.onRefineSkipped?.(matted.error)

  if (deps.record !== undefined) replayTimings(clock.timings(), deps.record)

  return ok({ alpha, providerId: deps.provider.info.id, refined: refined.ok, background })
}
