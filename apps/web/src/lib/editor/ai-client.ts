/**
 * The main-thread side of the AI worker.
 *
 * It satisfies `BackgroundRemovalProvider`, so the editor cannot tell that the
 * work happens in another thread — and the same editor code keeps working if
 * the model ever moves back inline or out to a server (kirily-design.md §21).
 */
import type { BackgroundRemovalProvider, ImageInput, SegmentationResult } from '@kirily/ai/provider'
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'
import type { AiRequest, AiResponse } from '../workers/ai-protocol.ts'

export type WorkerProviderDeps = {
  /** Creating the worker is injected so this can be tested without one. */
  readonly createWorker: () => Worker
}

export const createWorkerProvider = (deps: WorkerProviderDeps): BackgroundRemovalProvider => {
  let worker: Worker | null = null
  let info = {
    id: 'worker',
    label: 'この画像はブラウザ内で処理されます。',
    requiresUpload: false,
  }

  const ensureWorker = (): Worker => {
    worker ??= deps.createWorker()
    return worker
  }

  /**
   * Sends one request and settles on the first terminal reply. Progress
   * messages are forwarded rather than resolving, so a long download keeps the
   * UI honest instead of looking stuck.
   */
  const send = async <T>(
    request: AiRequest,
    transfer: Transferable[],
    onProgress: ((value: number) => void) | undefined,
    settle: (response: AiResponse) => Result<T, KirilyError> | null,
  ): Promise<Result<T, KirilyError>> => {
    const target = ensureWorker()

    return new Promise<Result<T, KirilyError>>((resolve) => {
      const cleanUp = (): void => {
        target.removeEventListener('message', onMessage)
        target.removeEventListener('error', onError)
      }

      const onMessage = (event: MessageEvent<AiResponse>): void => {
        const response = event.data
        if (response.type === 'progress') {
          onProgress?.(response.value)
          return
        }
        if (response.type === 'error') {
          cleanUp()
          resolve(err(kirilyError(response.code, response.detail)))
          return
        }
        const settled = settle(response)
        if (settled === null) return
        cleanUp()
        resolve(settled)
      }

      const onError = (event: ErrorEvent): void => {
        cleanUp()
        // A worker that dies is not recoverable in place; drop it so the next
        // attempt starts a fresh one.
        worker?.terminate()
        worker = null
        resolve(err(kirilyError(KirilyErrorCode.AiInitializationFailed, event.message)))
      }

      target.addEventListener('message', onMessage)
      target.addEventListener('error', onError)
      target.postMessage(request, transfer)
    })
  }

  return {
    get info() {
      return info
    },

    initialize: async (onProgress): Promise<Result<void, KirilyError>> =>
      send<void>({ type: 'initialize' }, [], onProgress, (response) => {
        if (response.type !== 'ready') return null
        info = { id: response.providerId, label: response.label, requiresUpload: false }
        return ok(undefined)
      }),

    removeBackground: async (
      input: ImageInput,
    ): Promise<Result<SegmentationResult, KirilyError>> => {
      // The buffer is transferred, so a copy is made first: the original is
      // the preview the canvas is still drawing from.
      const copy = input.rgba.slice()

      return send<SegmentationResult>(
        {
          type: 'remove-background',
          width: input.width,
          height: input.height,
          rgba: copy.buffer,
        },
        [copy.buffer],
        undefined,
        (response) => {
          if (response.type !== 'result') return null
          info = { ...info, id: response.providerId }
          return ok({
            width: response.width,
            height: response.height,
            alpha: new Uint8Array(response.alpha),
          })
        },
      )
    },
  }
}

/**
 * The real worker. Kept apart from the provider so the provider stays testable
 * and so Vite's worker transform sees a static, analysable URL.
 */
export const spawnAiWorker = (): Worker =>
  new Worker(new URL('../workers/ai.worker.ts', import.meta.url), {
    type: 'module',
    name: 'kirily-ai',
  })
