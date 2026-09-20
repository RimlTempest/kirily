/**
 * The bridge between Svelte and the editor core.
 *
 * Everything that decides *what* an edit means lives in `@kirily/editor-core`.
 * This file owns only what Svelte needs: reactive references, the decoded
 * pixels, and the buffers the renderer reuses. Components call these actions;
 * they never reach for the mask or the canvas themselves (Rule 1, Rule 6).
 */
import type { BackgroundRemovalProvider } from '@kirily/ai/provider'
import type { KirilyError } from '@kirily/contract/error'
import { exportFileName } from '@kirily/contract/image'
import type { ImagePoint } from '@kirily/contract/geometry'
import type { BrushMode, BucketSettings } from '@kirily/contract/mask'
import type { EditorState, EditorStatus } from '@kirily/editor-core/state'
import {
  createEditorState,
  dispatch,
  exportRect,
  redoState,
  undoState,
  withBrush,
  withBucket,
  withStatus,
} from '@kirily/editor-core/state'
import { canRedo, canUndo } from '@kirily/editor-core/history'
import { resample } from '@kirily/editor-core/commands'
import { composeMask, resampleMask } from '@kirily/image-core/mask'
import { WHITE } from '@kirily/image-core/composite'
import { budgetFor } from '@kirily/image-core/preview'
import type { ImageEngine } from '@kirily/wasm'
import { loadImageEngine } from '@kirily/wasm'
import { createWorkerProvider, spawnAiWorker } from './ai-client.ts'
import type { DecodedImage } from './decode.ts'
import { removeBackground as removeBackgroundFlow } from './remove-background.ts'
import { decodeFile } from './decode.ts'
import type { ExportFormat } from './export.ts'
import { downloadBlob, exportImage, extensionFor } from './export.ts'

export type EditorStore = ReturnType<typeof createEditorStore>

export const createEditorStore = (
  provider: BackgroundRemovalProvider = createWorkerProvider({ createWorker: spawnAiWorker }),
) => {
  // `$state.raw`, not `$state`: both hold multi-megabyte pixel and mask
  // buffers and are always replaced wholesale, never mutated field by field.
  // Deep proxying them would cost on every read and buy nothing.
  let decoded = $state.raw<DecodedImage | null>(null)
  let editor = $state.raw<EditorState | null>(null)
  /** Set when a file could not be opened at all — before there is any state. */
  let lastError = $state<KirilyError | null>(null)
  /**
   * Which model last produced a mask. Mirrored into reactive state because the
   * provider's own `info` is a plain object: the chain updates it when it
   * falls back, and nothing would re-render.
   */
  let providerId = $state('')
  let engine: ImageEngine | null = null

  /** Composed mask at original resolution. Reused; never reallocated per edit. */
  let fullMask: Uint8Array = new Uint8Array(0)
  /**
   * The same mask at preview resolution, for the canvas. Raw and mutated in
   * place — `previewVersion` is what the renderer watches, because comparing
   * several megabytes of mask on every edit is the thing to avoid.
   */
  let previewMask = $state.raw(new Uint8Array(0))
  let previewVersion = $state(0)

  const engineOrLoad = async (): Promise<ImageEngine> => {
    engine ??= await loadImageEngine()
    return engine
  }

  const recompose = (): void => {
    if (editor === null || decoded === null) return
    composeMask(editor.mask, fullMask)
    resampleMask(fullMask, editor.mask, decoded.preview, previewMask)
    previewVersion += 1
  }

  const fail = (error: KirilyError): void => {
    if (editor === null) return
    editor = withStatus(editor, { kind: 'error', error })
  }

  return {
    get image(): DecodedImage | null {
      return decoded
    },
    get state(): EditorState | null {
      return editor
    },
    get previewMask(): Uint8Array {
      return previewMask
    },
    /** Bumped on every mask change so the canvas knows to redraw. */
    get previewVersion(): number {
      return previewVersion
    },
    get status(): EditorStatus {
      return editor?.status ?? { kind: 'idle' }
    },
    get canUndo(): boolean {
      return editor !== null && canUndo(editor.history)
    },
    get canRedo(): boolean {
      return editor !== null && canRedo(editor.history)
    },
    /** What the UI tells the user about where their image goes. */
    get privacyLabel(): string {
      return provider.info.label
    },
    /** Which model actually ran. Surfaced so "why is this coarse?" is answerable. */
    get providerId(): string {
      return providerId
    },

    open: async (file: File): Promise<void> => {
      const budget = budgetFor({
        isMobile: globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
        deviceMemoryGb: readDeviceMemory(),
      })

      const result = await decodeFile(file, budget)
      if (!result.ok) {
        decoded = null
        editor = null
        lastError = result.error
        return
      }

      lastError = null
      decoded = result.value
      editor = createEditorState(result.value.source)
      fullMask = new Uint8Array(result.value.source.width * result.value.source.height)
      previewMask = new Uint8Array(result.value.preview.width * result.value.preview.height)
      recompose()
    },

    /** "背景をきりり" — runs the provider and replaces the AI layer. */
    removeBackground: async (): Promise<void> => {
      if (editor === null || decoded === null) return
      editor = withStatus(editor, { kind: 'ai-loading', progress: 0 })

      const result = await removeBackgroundFlow(
        {
          provider,
          engine: engineOrLoad,
          onLoadProgress: (progress) => {
            if (editor !== null) editor = withStatus(editor, { kind: 'ai-loading', progress })
          },
          onInferenceStart: () => {
            if (editor !== null) editor = withStatus(editor, { kind: 'ai-processing' })
          },
          onRefineSkipped: (error) => console.warn('[kirily] mask refinement skipped:', error.code),
        },
        decoded,
      )
      providerId = provider.info.id
      if (!result.ok) return fail(result.error)

      const next = dispatch(editor, { kind: 'replace-base-mask', alpha: result.value.alpha })
      if (!next.ok) return fail(next.error)

      editor = withStatus(next.value, { kind: 'idle' })
      recompose()
    },

    paint: (points: readonly ImagePoint[], mode: BrushMode): void => {
      if (editor === null) return
      const brush = editor.brush
      const resampled = resample(points, brush)
      if (resampled.length === 0) return

      const next = dispatch(editor, { kind: 'brush-stroke', mode, brush, points: resampled })
      if (!next.ok) return fail(next.error)
      editor = next.value
      recompose()
    },

    /** One click takes the whole region in or out. */
    bucketFill: (at: ImagePoint, mode: BrushMode): void => {
      if (editor === null || decoded === null) return

      const next = dispatch(editor, {
        kind: 'bucket-fill',
        mode,
        at,
        settings: editor.bucket,
        // The original pixels, not the preview: a click at 25% zoom has to
        // pick the same region as one at 100%.
        rgba: decoded.rgba,
      })
      if (!next.ok) return fail(next.error)
      editor = next.value
      recompose()
    },

    setBucket: (bucket: BucketSettings): void => {
      if (editor === null) return
      editor = withBucket(editor, bucket)
    },

    setBrushSize: (size: number): void => {
      if (editor === null) return
      editor = withBrush(editor, { ...editor.brush, size: Math.max(1, Math.min(400, size)) })
    },

    undo: (): void => {
      if (editor === null) return
      editor = undoState(editor)
      recompose()
    },

    redo: (): void => {
      if (editor === null) return
      editor = redoState(editor)
      recompose()
    },

    download: async (format: ExportFormat): Promise<void> => {
      if (editor === null || decoded === null) return
      editor = withStatus(editor, { kind: 'exporting' })

      const result = await exportImage(
        await engineOrLoad(),
        {
          width: decoded.source.width,
          height: decoded.source.height,
          rgba: decoded.rgba,
          mask: fullMask,
        },
        {
          format,
          quality: 0.92,
          background: WHITE,
          rect: exportRect(editor),
        },
      )
      if (!result.ok) return fail(result.error)

      downloadBlob(result.value, exportFileName(decoded.source.fileName, extensionFor(format)))
      editor = withStatus(editor, { kind: 'idle' })
    },

    reset: (): void => {
      decoded = null
      editor = null
      lastError = null
      fullMask = new Uint8Array(0)
      previewMask = new Uint8Array(0)
    },

    get lastError(): KirilyError | null {
      return lastError
    },
  }
}

/**
 * `navigator.deviceMemory` is Chromium-only. Read defensively rather than
 * assuming a shape the type definitions do not promise.
 */
const readDeviceMemory = (): number | undefined => {
  const value = Reflect.get(globalThis.navigator ?? {}, 'deviceMemory')
  return typeof value === 'number' ? value : undefined
}
