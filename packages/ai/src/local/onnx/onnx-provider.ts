/**
 * A background-removal provider backed by an ONNX segmentation model.
 *
 * The runtime itself is a parameter (`SessionFactory`), not an import. That is
 * what lets this file — the part with the actual logic — be unit-tested
 * without onnxruntime-web, a GPU, or 110 MiB of weights, and what lets the
 * same provider run on WebGPU or WASM without knowing which.
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { BackgroundRemovalProvider, ImageInput, SegmentationResult } from '../../provider.ts'
import type { ModelSpec } from './model-spec.ts'
import { toAlphaMask, toInputTensor } from './tensor.ts'
import type { LoadWeightsDeps } from './weights.ts'
import { Stage } from '@kirily/contract/timing'
import { loadWeights } from './weights.ts'

/** `performance` exists in workers and in Node; a missing one must not break loading. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now())

/** The slice of an inference session this provider needs. */
export type Session = {
  /** Fed in order; the provider does not assume a tensor name. */
  readonly run: (input: Float32Array, shape: readonly number[]) => Promise<Float32Array>
  readonly release?: () => Promise<void>
}

export type SessionFactory = (
  weights: Uint8Array<ArrayBuffer>,
  spec: ModelSpec,
  /** Reports the runtime download and graph build, as a 0..1 fraction. */
  onProgress?: (fraction: number) => void,
) => Promise<Result<Session, KirilyError>>

export type OnnxProviderDeps = LoadWeightsDeps & {
  readonly createSession: SessionFactory
  /** Where the sharded weights live, e.g. `/models/birefnet-lite`. */
  readonly weightsBaseUrl: string
}

export const createOnnxProvider = (
  deps: OnnxProviderDeps,
  spec: ModelSpec,
): BackgroundRemovalProvider => {
  let session: Session | null = null

  return {
    info: {
      id: spec.id,
      label: 'この画像はブラウザ内で処理されます。',
      requiresUpload: false,
    },

    initialize: async (onProgress): Promise<Result<void, KirilyError>> => {
      if (session !== null) {
        onProgress?.(1)
        return ok(undefined)
      }

      // The weights dominate, but the runtime is tens of megabytes on its
      // first use, so the bar has to keep moving through both.
      const weights = await loadWeights(deps, deps.weightsBaseUrl, (fraction) => {
        onProgress?.(fraction * 0.7)
      })
      if (!weights.ok) return weights

      const startedCompile = now()
      const created = await deps.createSession(weights.value, spec, (fraction) => {
        onProgress?.(0.7 + fraction * 0.3)
      })
      deps.record?.(Stage.AiCompile, now() - startedCompile)
      if (!created.ok) return created

      session = created.value
      onProgress?.(1)
      return ok(undefined)
    },

    removeBackground: async (
      input: ImageInput,
    ): Promise<Result<SegmentationResult, KirilyError>> => {
      if (session === null) {
        return err(kirilyError(KirilyErrorCode.AiInferenceFailed, `${spec.id} was not initialised`))
      }
      if (input.rgba.length !== input.width * input.height * 4) {
        return err(
          kirilyError(
            KirilyErrorCode.SizeMismatch,
            `expected ${input.width * input.height * 4} bytes, got ${input.rgba.length}`,
          ),
        )
      }

      const tensor = toInputTensor(input.rgba, input, spec)
      const shape = [1, 3, spec.inputSize, spec.inputSize] as const

      let output: Float32Array
      try {
        output = await session.run(tensor, shape)
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : 'unknown'
        return err(kirilyError(KirilyErrorCode.AiInferenceFailed, detail))
      }

      const expected = spec.inputSize * spec.inputSize
      if (output.length < expected) {
        return err(
          kirilyError(
            KirilyErrorCode.AiInferenceFailed,
            `model returned ${output.length} values, expected at least ${expected}`,
          ),
        )
      }

      return ok({
        width: input.width,
        height: input.height,
        alpha: toAlphaMask(output, spec, input),
      })
    },
  }
}
