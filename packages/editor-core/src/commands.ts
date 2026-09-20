/**
 * Editing as commands (kirily-design.md §10).
 *
 * The UI never mutates the mask. It builds a command and hands it to the
 * store, which is what makes undo, redo and a future command log possible
 * without copying an 8 MB mask on every pointer move.
 *
 * A command carries everything needed to replay it. Undo is done by restoring
 * the affected layer's previous bytes — bounded by the stroke's bounding box,
 * not the image — so history costs the area the user touched.
 */
import type { BrushSettings, MaskLayers } from '@kirily/contract/mask'
import type { BrushMode } from '@kirily/contract/mask'
import type { ImagePoint, Rect } from '@kirily/contract/geometry'
import type { KirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { assertNever, ok } from '@kirily/contract/result'
import { layerFor, stampBrush } from '@kirily/image-core/mask'

/**
 * One stroke, not one pointer move: a drag is a single undo step
 * (IMPLEMENTATION.md §30).
 */
export type BrushStrokeCommand = {
  readonly kind: 'brush-stroke'
  readonly mode: BrushMode
  readonly brush: BrushSettings
  readonly points: readonly ImagePoint[]
}

/** Replacing the AI layer. One AI run is one undo step. */
export type ReplaceBaseMaskCommand = {
  readonly kind: 'replace-base-mask'
  readonly alpha: Uint8Array
}

export type SetCropCommand = {
  readonly kind: 'set-crop'
  readonly rect: Rect | null
}

export type EditorCommand = BrushStrokeCommand | ReplaceBaseMaskCommand | SetCropCommand

/** Which mask layer a command writes to, or null when it writes none. */
export const targetLayer = (command: EditorCommand, layers: MaskLayers): Uint8Array | null => {
  switch (command.kind) {
    case 'brush-stroke':
      return layerFor(layers, command.mode)
    case 'replace-base-mask':
      return layers.base
    case 'set-crop':
      return null
    default:
      return assertNever(command)
  }
}

/**
 * The pixels a command can possibly change, in image coordinates. Used to
 * snapshot only what is about to be overwritten.
 */
export const affectedRect = (command: EditorCommand, layers: MaskLayers): Rect | null => {
  switch (command.kind) {
    case 'brush-stroke': {
      if (command.points.length === 0) return null
      const radius = command.brush.size + 1
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const point of command.points) {
        minX = Math.min(minX, point.x - radius)
        minY = Math.min(minY, point.y - radius)
        maxX = Math.max(maxX, point.x + radius)
        maxY = Math.max(maxY, point.y + radius)
      }
      const x = Math.max(0, Math.floor(minX))
      const y = Math.max(0, Math.floor(minY))
      const right = Math.min(layers.width, Math.ceil(maxX))
      const bottom = Math.min(layers.height, Math.ceil(maxY))
      if (right <= x || bottom <= y) return null
      return { x, y, width: right - x, height: bottom - y }
    }
    case 'replace-base-mask':
      return { x: 0, y: 0, width: layers.width, height: layers.height }
    case 'set-crop':
      return null
    default:
      return assertNever(command)
  }
}

/** Applies a command to the mask layers, in place. */
export const applyCommand = (
  command: EditorCommand,
  layers: MaskLayers,
): Result<void, KirilyError> => {
  switch (command.kind) {
    case 'brush-stroke': {
      const layer = layerFor(layers, command.mode)
      for (const point of command.points) {
        const result = stampBrush(layer, layers, point, command.brush)
        if (!result.ok) return result
      }
      return ok(undefined)
    }
    case 'replace-base-mask':
      layers.base.set(command.alpha)
      return ok(undefined)
    case 'set-crop':
      return ok(undefined)
    default:
      return assertNever(command)
  }
}

/**
 * Turns a pointer path into a stroke. Points closer together than a third of
 * the brush radius are dropped: they cost time and change nothing visible.
 */
export const resample = (
  points: readonly ImagePoint[],
  brush: BrushSettings,
): readonly ImagePoint[] => {
  const minimumStep = Math.max(0.5, brush.size / 3)
  const kept: ImagePoint[] = []
  for (const point of points) {
    const previous = kept.at(-1)
    if (previous === undefined) {
      kept.push(point)
      continue
    }
    const dx = point.x - previous.x
    const dy = point.y - previous.y
    if (Math.sqrt(dx * dx + dy * dy) >= minimumStep) kept.push(point)
  }
  return kept
}
