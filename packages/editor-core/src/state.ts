/**
 * The editor's source of truth (IMPLEMENTATION.md §9, Rule 1).
 *
 * The canvas is a rendering surface, never the state. This module owns the
 * state and knows nothing about Svelte, so the same logic is testable without
 * a DOM and reusable if the UI is ever replaced.
 */
import type { SourceImage } from '@kirily/contract/image'
import type { BrushSettings, BucketSettings, MaskLayers } from '@kirily/contract/mask'
import { DEFAULT_BRUSH, DEFAULT_BUCKET } from '@kirily/contract/mask'
import type { Rect, Viewport } from '@kirily/contract/geometry'
import { IDENTITY_VIEWPORT } from '@kirily/contract/geometry'
import type { KirilyError } from '@kirily/contract/error'
import type { BrushMode } from '@kirily/contract/mask'
import type { Result } from '@kirily/contract/result'
import { assertNever, ok } from '@kirily/contract/result'
import { createMaskLayers } from '@kirily/image-core/mask'
import type { EditorCommand } from './commands.ts'
import type { History } from './history.ts'
import { emptyHistory, execute, redo, undo } from './history.ts'

export const EditorTool = {
  Pan: 'pan',
  BrushKeep: 'brush-keep',
  BrushRemove: 'brush-remove',
  BucketKeep: 'bucket-keep',
  BucketRemove: 'bucket-remove',
  Crop: 'crop',
} as const

export type EditorTool = (typeof EditorTool)[keyof typeof EditorTool]

/**
 * What the editor is busy with. A single `isProcessing: boolean` cannot say
 * whether to show "AI を準備しています…" or "きりり中…", and allows the
 * meaningless combination of "loading and exporting" (IMPLEMENTATION.md §65).
 */
export type EditorStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'decoding' }
  | { readonly kind: 'ai-loading'; readonly progress: number }
  | { readonly kind: 'ai-processing' }
  | { readonly kind: 'exporting' }
  | { readonly kind: 'error'; readonly error: KirilyError }

export type EditorState = {
  readonly source: SourceImage
  readonly mask: MaskLayers
  readonly crop: Rect | null
  readonly viewport: Viewport
  readonly tool: EditorTool
  readonly brush: BrushSettings
  readonly bucket: BucketSettings
  readonly status: EditorStatus
  readonly history: History
}

export const createEditorState = (source: SourceImage): EditorState => ({
  source,
  mask: createMaskLayers(source.width, source.height),
  crop: null,
  viewport: IDENTITY_VIEWPORT,
  tool: EditorTool.BrushRemove,
  brush: DEFAULT_BRUSH,
  bucket: DEFAULT_BUCKET,
  status: { kind: 'idle' },
  history: emptyHistory,
})

/**
 * Runs a command and returns the next state.
 *
 * The mask buffers are mutated in place — copying them per edit is what the
 * command/patch design exists to avoid — while everything else is replaced, so
 * a UI that compares object identity still re-renders.
 */
export const dispatch = (
  state: EditorState,
  command: EditorCommand,
): Result<EditorState, KirilyError> => {
  const history = execute(state.history, command, state.mask)
  if (!history.ok) return history

  const crop = command.kind === 'set-crop' ? command.rect : state.crop
  return ok({
    ...state,
    crop,
    mask: { ...state.mask, version: state.mask.version + 1 },
    history: history.value,
  })
}

export const undoState = (state: EditorState): EditorState => ({
  ...state,
  mask: { ...state.mask, version: state.mask.version + 1 },
  history: undo(state.history, state.mask),
})

export const redoState = (state: EditorState): EditorState => ({
  ...state,
  mask: { ...state.mask, version: state.mask.version + 1 },
  history: redo(state.history, state.mask),
})

export const withStatus = (state: EditorState, status: EditorStatus): EditorState => ({
  ...state,
  status,
})

export const withViewport = (state: EditorState, viewport: Viewport): EditorState => ({
  ...state,
  viewport,
})

export const withTool = (state: EditorState, tool: EditorTool): EditorState => ({
  ...state,
  tool,
})

export const withBrush = (state: EditorState, brush: BrushSettings): EditorState => ({
  ...state,
  brush,
})

export const withBucket = (state: EditorState, bucket: BucketSettings): EditorState => ({
  ...state,
  bucket,
})

/** Which mask layer a tool writes to, or null when it paints nothing. */
export const modeOf = (tool: EditorTool): BrushMode | null => {
  switch (tool) {
    case EditorTool.BrushKeep:
    case EditorTool.BucketKeep:
      return 'keep'
    case EditorTool.BrushRemove:
    case EditorTool.BucketRemove:
      return 'remove'
    case EditorTool.Pan:
    case EditorTool.Crop:
      return null
    default:
      return assertNever(tool)
  }
}

/** True when the tool fills a region from a single click. */
export const isBucket = (tool: EditorTool): boolean =>
  tool === EditorTool.BucketKeep || tool === EditorTool.BucketRemove

/** The rectangle the export pipeline reads — the crop, or the whole image. */
export const exportRect = (state: EditorState): Rect =>
  state.crop ?? { x: 0, y: 0, width: state.source.width, height: state.source.height }
