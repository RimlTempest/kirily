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
import type { BrushSettings, BucketSettings, MaskLayers } from '@kirily/contract/mask'
import type { BrushMode } from '@kirily/contract/mask'
import type { ImagePoint, Rect } from '@kirily/contract/geometry'
import type { KirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { assertNever, ok } from '@kirily/contract/result'
import type { Bounds } from '@kirily/image-core/flood'
import { floodSelect } from '@kirily/image-core/flood'
import { refineSelection } from '@kirily/image-core/select'
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

/**
 * The bucket: one click takes a whole region in or out.
 *
 * It carries the click and the settings, not the pixels it selected. The
 * selection is several megabytes on a large image, and keeping it in the
 * command would keep it alive in the undo history for as long as the step
 * lives there.
 */
export type BucketFillCommand = {
  readonly kind: 'bucket-fill'
  readonly mode: BrushMode
  readonly at: ImagePoint
  readonly settings: BucketSettings
  /**
   * The image the selection is computed from — the original pixels, not the
   * preview, so a click at 25% zoom picks the same region as at 100%.
   */
  readonly rgba: Uint8ClampedArray
  /**
   * The AI's alpha, when it has run. The fill uses it to stay on the side of
   * the subject's edge the click landed on, which is the only thing that
   * separates a white collar from a white page.
   */
  readonly guide: Uint8Array | null
}

export type SetCropCommand = {
  readonly kind: 'set-crop'
  readonly rect: Rect | null
}

export type EditorCommand =
  | BrushStrokeCommand
  | ReplaceBaseMaskCommand
  | BucketFillCommand
  | SetCropCommand

/** Which mask layer a command writes to, or null when it writes none. */
export const targetLayer = (command: EditorCommand, layers: MaskLayers): Uint8Array | null => {
  switch (command.kind) {
    case 'brush-stroke':
      return layerFor(layers, command.mode)
    case 'replace-base-mask':
      return layers.base
    case 'bucket-fill':
      return layerFor(layers, command.mode)
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
    case 'bucket-fill':
      // Not knowable without running the fill. `prepareCommand` runs it once
      // and reports the real box; this conservative answer only shows up if
      // something calls `affectedRect` directly.
      return { x: 0, y: 0, width: layers.width, height: layers.height }
    case 'set-crop':
      return null
    default:
      return assertNever(command)
  }
}

/**
 * Works out what a command will touch and hands back a closure that does it.
 *
 * The bucket is why this exists. Its extent is only known once the flood fill
 * has run, and the history has to snapshot the affected region *before* the
 * command is applied. Without this, the fill would run twice — once to measure
 * and once to write — which on a full-resolution image is the difference
 * between a click that lands and one that stutters.
 */
export type PreparedCommand = {
  readonly layer: Uint8Array | null
  readonly rect: Rect | null
  readonly apply: () => Result<void, KirilyError>
}

export const prepareCommand = (command: EditorCommand, layers: MaskLayers): PreparedCommand => {
  if (command.kind !== 'bucket-fill') {
    return {
      layer: targetLayer(command, layers),
      rect: affectedRect(command, layers),
      apply: () => applyCommand(command, layers),
    }
  }

  const selection = new Uint8Array(layers.width * layers.height)
  const bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  floodSelect(
    command.rgba,
    layers,
    command.at,
    command.settings,
    selection,
    bounds,
    command.guide ?? undefined,
  )

  // A flood decides reachability pixel by pixel, so its frontier is a
  // stair-step. A selection is a mask, and masks here take their edge from the
  // image (ADR-0019).
  refineSelection(command.rgba, selection, layers)

  const layer = layerFor(layers, command.mode)
  const rect = bounds.width > 0 && bounds.height > 0 ? bounds : null

  return {
    layer,
    rect,
    apply: () => {
      if (rect === null) return ok(undefined)
      // The override layers accumulate towards opaque, like the brush: a
      // second click on the same region does not undo the first.
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          const index = y * layers.width + x
          const strength = selection[index] ?? 0
          if (strength === 0) continue
          const current = layer[index] ?? 0
          layer[index] = current > strength ? current : strength
        }
      }
      return ok(undefined)
    },
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
    case 'bucket-fill':
      return prepareCommand(command, layers).apply()
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
