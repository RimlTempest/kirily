/**
 * The messages the AI worker understands.
 *
 * Shared by both sides so a change to the protocol breaks compilation rather
 * than producing a silent `undefined` at run time. Buffers travel as
 * `ArrayBuffer` because that is what `postMessage` can transfer; copying a
 * 7 MB preview on every run would show up as a stutter.
 */
import type { KirilyErrorCode } from '@kirily/contract/error'

export type AiRequest =
  | { readonly type: 'initialize' }
  | {
      readonly type: 'remove-background'
      readonly width: number
      readonly height: number
      readonly rgba: ArrayBuffer
    }

export type AiResponse =
  | { readonly type: 'progress'; readonly value: number }
  | { readonly type: 'ready'; readonly providerId: string; readonly label: string }
  | {
      readonly type: 'result'
      readonly width: number
      readonly height: number
      readonly alpha: ArrayBuffer
      readonly providerId: string
    }
  | {
      readonly type: 'error'
      readonly code: KirilyErrorCode
      readonly detail: string | undefined
    }
