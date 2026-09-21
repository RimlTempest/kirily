/// <reference lib="webworker" />
/**
 * Runs segmentation off the main thread.
 *
 * Inference on a 1024² model takes hundreds of milliseconds at best; doing it
 * on the main thread would freeze the canvas and the toolbar for that whole
 * time (kirily-design.md §19). The worker also isolates the runtime: if WebGPU
 * falls over, it takes this worker with it and not the editor.
 *
 * The chain is assembled here because this is where the device's capabilities
 * are actually known.
 */
import { createProviderChain } from '@kirily/ai/chain'
import { createThresholdProvider } from '@kirily/ai/local'
import type { BackgroundRemovalProvider } from '@kirily/ai/provider'
import { createOnnxProvider } from '@kirily/ai/onnx'
import type { GpuCapabilities, OrtBackend } from '@kirily/ai/onnx/ort'
import { createOrtSessionFactory, detectGpu } from '@kirily/ai/onnx/ort'
import { planModels } from '@kirily/ai/onnx/plan'
import type { ModelSpec } from '@kirily/ai/onnx/spec'
import { Stage, createStopwatch } from '@kirily/contract/timing'
import type { AiRequest, AiResponse } from './ai-protocol.ts'

/**
 * `self` is typed as `Window` by the DOM lib the app is compiled with. Rather
 * than assert the type away, check for the thing this file actually needs —
 * which also fails loudly if the module is ever imported outside a worker.
 */
const isWorkerScope = (value: unknown): value is DedicatedWorkerGlobalScope =>
  typeof value === 'object'
  && value !== null
  && typeof Reflect.get(value, 'postMessage') === 'function'
  && typeof Reflect.get(value, 'addEventListener') === 'function'

const globalScope: unknown = globalThis
if (!isWorkerScope(globalScope)) {
  throw new Error('ai.worker.ts must run inside a dedicated worker.')
}
const scope = globalScope

const post = (message: AiResponse, transfer: Transferable[] = []): void => {
  scope.postMessage(message, transfer)
}

const onnx = (spec: ModelSpec, backend: OrtBackend): BackgroundRemovalProvider =>
  createOnnxProvider(
    {
      fetch: (url) => fetch(url),
      weightsBaseUrl: `/models/${spec.id}`,
      createSession: createOrtSessionFactory({ backend }),
    },
    spec,
  )

const buildChain = (gpu: GpuCapabilities): BackgroundRemovalProvider => {
  const candidates: BackgroundRemovalProvider[] = planModels(gpu).map((planned) =>
    onnx(planned.spec, planned.backend),
  )

  // Last resort. Not a good background remover, but it keeps the editor usable
  // where no model can run — and it is what the E2E suite falls back to, so
  // the tests do not depend on a 100 MiB download.
  candidates.push(createThresholdProvider())

  return createProviderChain(candidates, {
    onFallback: (from, error) => {
      // The image itself is never logged — only which model stepped aside and
      // why (IMPLEMENTATION.md §57).
      console.warn(`[kirily] ${from} unavailable: ${error.code} ${error.detail ?? ''}`)
    },
  })
}

/**
 * Built once, lazily: probing for a GPU adapter is async, and every request has
 * to wait for the same answer rather than racing to build its own chain.
 */
let chainPromise: Promise<BackgroundRemovalProvider> | null = null

const getChain = async (): Promise<BackgroundRemovalProvider> => {
  chainPromise ??= detectGpu().then(buildChain)
  return chainPromise
}

scope.addEventListener('message', (event: MessageEvent<AiRequest>) => {
  void handle(event.data)
})

/**
 * Timed here, not on the main thread. A caller can only see how long the
 * round trip took, which folds the download, the compile and the forward pass
 * into one number — and those three call for entirely different work.
 */
const watch = createStopwatch(() => performance.now())

const handle = async (request: AiRequest): Promise<void> => {
  const chain = await getChain()

  switch (request.type) {
    case 'initialize': {
      watch.clear()
      const ready = await watch.measureAsync(Stage.AiLoad, () =>
        chain.initialize((value) => post({ type: 'progress', value })),
      )
      if (!ready.ok) {
        post({ type: 'error', code: ready.error.code, detail: ready.error.detail })
        return
      }
      post({
        type: 'ready',
        providerId: chain.info.id,
        label: chain.info.label,
        timings: watch.timings(),
      })
      return
    }

    case 'remove-background': {
      watch.clear()
      const result = await watch.measureAsync(Stage.AiInference, () =>
        chain.removeBackground({
          width: request.width,
          height: request.height,
          rgba: new Uint8ClampedArray(request.rgba),
        }),
      )
      if (!result.ok) {
        post({ type: 'error', code: result.error.code, detail: result.error.detail })
        return
      }

      const alpha = result.value.alpha
      post(
        {
          type: 'result',
          width: result.value.width,
          height: result.value.height,
          alpha: alpha.buffer,
          providerId: chain.info.id,
          timings: watch.timings(),
        },
        [alpha.buffer],
      )
      return
    }
  }
}
