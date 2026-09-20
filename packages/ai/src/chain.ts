/**
 * Trying providers in order.
 *
 * Kirily degrades per capability rather than all at once (kirily-design.md
 * §24): a device that cannot run the quality model still gets the small one,
 * and a device that can run neither still gets a usable mask rather than an
 * error. The chain is what makes that a single decision the editor does not
 * have to know about.
 *
 * The caller decides which candidates go in. A provider that uploads the image
 * must not be added unless the user has agreed to it — the chain will happily
 * fall through to whatever it is given.
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { BackgroundRemovalProvider, ImageInput, SegmentationResult } from './provider.ts'

export type ChainDeps = {
  /**
   * Called when a candidate is skipped. Wired to telemetry so "everyone is
   * silently falling back to the small model" is visible rather than guessed.
   */
  readonly onFallback?: (from: string, error: KirilyError) => void
}

export const createProviderChain = (
  candidates: readonly BackgroundRemovalProvider[],
  deps: ChainDeps = {},
): BackgroundRemovalProvider => {
  if (candidates.length === 0) {
    throw new Error('A provider chain needs at least one candidate.')
  }

  let active: BackgroundRemovalProvider | null = null
  let index = 0

  const first = candidates[0]
  if (first === undefined) throw new Error('A provider chain needs at least one candidate.')

  const initializeFrom = async (
    start: number,
    onProgress?: (value: number) => void,
  ): Promise<Result<BackgroundRemovalProvider, KirilyError>> => {
    let lastError = kirilyError(KirilyErrorCode.AiInitializationFailed, 'no candidates')

    for (let i = start; i < candidates.length; i++) {
      const candidate = candidates[i]
      if (candidate === undefined) continue

      const ready = await candidate.initialize(onProgress)
      if (ready.ok) {
        active = candidate
        index = i
        return ok(candidate)
      }

      lastError = ready.error
      deps.onFallback?.(candidate.info.id, ready.error)
    }

    return err(lastError)
  }

  return {
    get info() {
      return (active ?? first).info
    },

    initialize: async (onProgress): Promise<Result<void, KirilyError>> => {
      const ready = await initializeFrom(0, onProgress)
      return ready.ok ? ok(undefined) : err(ready.error)
    },

    removeBackground: async (
      input: ImageInput,
    ): Promise<Result<SegmentationResult, KirilyError>> => {
      if (active === null) {
        const ready = await initializeFrom(0)
        if (!ready.ok) return err(ready.error)
      }
      if (active === null) {
        return err(kirilyError(KirilyErrorCode.AiInitializationFailed, 'no provider'))
      }

      const result = await active.removeBackground(input)
      if (result.ok) return result

      // A model that loaded but cannot run — out of GPU memory on this image,
      // say — is still a reason to step down rather than to give up.
      deps.onFallback?.(active.info.id, result.error)
      const next = await initializeFrom(index + 1)
      if (!next.ok) return err(result.error)

      return next.value.removeBackground(input)
    },
  }
}
