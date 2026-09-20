/**
 * The onnxruntime-web adapter.
 *
 * This is the only file in Kirily that imports the runtime. Everything the
 * provider does — preprocessing, postprocessing, fallback — is tested without
 * it; what is left here is the part that can only be verified by running a
 * real model in a real browser.
 *
 * Two things are read from the session rather than assumed, because they
 * differ between exports of the same architecture:
 *   - the input and output tensor names,
 *   - whether the graph wants float16 or float32.
 */
import type * as Ort from 'onnxruntime-web'
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import { decodeFloat16Array, encodeFloat16Array } from './float16.ts'
import type { ModelSpec } from './model-spec.ts'
import type { Session, SessionFactory } from './onnx-provider.ts'

export type OrtBackend = 'webgpu' | 'wasm'

export type OrtRuntimeConfig = {
  readonly backend: OrtBackend
}

type OrtModule = typeof Ort

/**
 * Each entry point carries its own WebAssembly build, and the bundler emits
 * that build as a same-origin asset — which is why the page can run a model
 * without `connect-src` ever leaving `'self'` (ADR-0004).
 *
 * The WebGPU path uses the JSPI build rather than the default one. Both run
 * WebGPU; the default reaches async GPU readback through Asyncify, whose
 * binary is 25.5 MiB and does not fit Cloudflare's 25 MiB asset limit, while
 * the JSPI binary is 16 MiB (ADR-0007). JSPI ships in the same Chromium
 * versions that ship a usable WebGPU adapter, so nothing is lost.
 */
const loadRuntime = async (backend: OrtBackend): Promise<OrtModule> =>
  backend === 'webgpu' ? await import('onnxruntime-web/jspi') : await import('onnxruntime-web/wasm')

const runtimes = new Map<OrtBackend, Promise<Result<OrtModule, KirilyError>>>()

const prepareRuntime = async (backend: OrtBackend): Promise<Result<OrtModule, KirilyError>> => {
  const cached = runtimes.get(backend)
  if (cached !== undefined) return cached

  const pending = (async (): Promise<Result<OrtModule, KirilyError>> => {
    try {
      const ort = await loadRuntime(backend)
      // Multi-threading needs SharedArrayBuffer, which needs COOP/COEP headers
      // on every response. Those break embedding for a gain WebGPU already
      // provides where it matters, so Kirily stays single-threaded (ADR-0007).
      ort.env.wasm.numThreads = 1
      ort.env.logLevel = 'error'
      return ok(ort)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'unknown'
      return err(kirilyError(KirilyErrorCode.AiInitializationFailed, detail))
    }
  })()

  runtimes.set(backend, pending)
  const result = await pending
  // Let a later attempt retry rather than caching a failure forever.
  if (!result.ok) runtimes.delete(backend)
  return result
}

/**
 * What the GPU on this machine can actually do.
 *
 * `available` is not `navigator.gpu !== undefined`: headless Chromium and
 * several real configurations expose the object and then hand back no adapter.
 *
 * `maxStorageBuffersPerShaderStage` decides which models are worth offering.
 * BiRefNet's decoder contains a Split that binds 11 storage buffers in one
 * shader stage; Apple GPUs cap the stage at 10, so on a Mac that model fails
 * at the first inference — after a 109 MiB download. Asking the adapter first
 * turns a wasted download into a model that is simply not offered (ADR-0007).
 */
export type GpuCapabilities = {
  readonly available: boolean
  readonly maxStorageBuffersPerShaderStage: number
}

export const NO_GPU: GpuCapabilities = {
  available: false,
  maxStorageBuffersPerShaderStage: 0,
}

export const detectGpu = async (): Promise<GpuCapabilities> => {
  const gpu: unknown = typeof navigator === 'undefined' ? undefined : Reflect.get(navigator, 'gpu')
  if (gpu === undefined || gpu === null) return NO_GPU

  const requestAdapter: unknown = Reflect.get(gpu, 'requestAdapter')
  if (typeof requestAdapter !== 'function') return NO_GPU

  try {
    const adapter: unknown = await Reflect.apply(requestAdapter, gpu, [])
    if (adapter === null || adapter === undefined) return NO_GPU

    const limits: unknown = Reflect.get(adapter, 'limits')
    const max: unknown =
      limits === null || limits === undefined
        ? undefined
        : Reflect.get(limits, 'maxStorageBuffersPerShaderStage')

    return {
      available: true,
      // The WebGPU spec guarantees at least 8; assume only that when the
      // adapter does not say.
      maxStorageBuffersPerShaderStage: typeof max === 'number' ? max : 8,
    }
  } catch {
    return NO_GPU
  }
}

export const createOrtSessionFactory =
  (config: OrtRuntimeConfig): SessionFactory =>
  async (
    weights: Uint8Array<ArrayBuffer>,
    spec: ModelSpec,
    onProgress?: (fraction: number) => void,
  ): Promise<Result<Session, KirilyError>> => {
    const runtime = await prepareRuntime(config.backend)
    if (!runtime.ok) return runtime
    onProgress?.(0.2)

    const ort = runtime.value

    try {
      const session = await ort.InferenceSession.create(weights, {
        executionProviders: config.backend === 'webgpu' ? ['webgpu'] : ['wasm'],
        graphOptimizationLevel: 'all',
      })
      onProgress?.(1)

      const inputName = session.inputNames[0]
      const outputName = session.outputNames[0]
      if (inputName === undefined || outputName === undefined) {
        return err(
          kirilyError(KirilyErrorCode.AiInitializationFailed, `${spec.id} exposes no tensors`),
        )
      }

      const wantsHalf = inputTypeOf(session, inputName) === 'float16'

      return ok({
        run: async (input, shape) => {
          const dims = Array.from(shape)
          const tensor = wantsHalf
            ? new ort.Tensor('float16', encodeFloat16Array(input), dims)
            : new ort.Tensor('float32', input, dims)

          const outputs = await session.run({ [inputName]: tensor })
          const output = outputs[outputName]
          if (output === undefined) {
            throw new Error(`${spec.id} produced no '${outputName}' output`)
          }
          return toFloat32(output.data)
        },
        release: async () => {
          await session.release()
        },
      })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'unknown'
      return err(kirilyError(KirilyErrorCode.AiInitializationFailed, `${spec.id}: ${detail}`))
    }
  }

const inputTypeOf = (session: Ort.InferenceSession, name: string): string | undefined => {
  // `inputMetadata` is present from onnxruntime-web 1.21 but is not in every
  // type definition; reading it defensively avoids pinning the provider to one
  // runtime version.
  const metadata: unknown = Reflect.get(session, 'inputMetadata')
  if (!Array.isArray(metadata)) return undefined

  const found = metadata.find(
    (entry: unknown) =>
      typeof entry === 'object' && entry !== null && Reflect.get(entry, 'name') === name,
  )
  if (found === undefined) return undefined

  const type: unknown = Reflect.get(found, 'type')
  return typeof type === 'string' ? type : undefined
}

const toFloat32 = (data: Ort.Tensor['data']): Float32Array => {
  if (data instanceof Float32Array) return data
  if (data instanceof Uint16Array) return decodeFloat16Array(data)
  if (data instanceof Float64Array) return Float32Array.from(data)
  throw new Error(`Unexpected output tensor type: ${data.constructor.name}`)
}
