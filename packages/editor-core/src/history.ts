/**
 * Undo / redo (kirily-design.md §10).
 *
 * A history entry stores the *previous* bytes of the region a command was
 * about to change, not a copy of the whole mask. A brush stroke on a 4000×3000
 * image then costs the stroke's bounding box — a few tens of kilobytes —
 * instead of 12 MB.
 */
import type { MaskLayers } from '@kirily/contract/mask'
import type { Rect } from '@kirily/contract/geometry'
import type { KirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { ok } from '@kirily/contract/result'
import type { EditorCommand } from './commands.ts'
import { affectedRect, applyCommand, targetLayer } from './commands.ts'

type Patch = {
  readonly layer: Uint8Array
  readonly rect: Rect
  readonly before: Uint8Array
}

export type HistoryEntry = {
  readonly command: EditorCommand
  readonly patch: Patch | null
}

export type History = {
  readonly undoStack: readonly HistoryEntry[]
  readonly redoStack: readonly HistoryEntry[]
}

export const emptyHistory: History = { undoStack: [], redoStack: [] }

/** Keeps memory bounded on a long session; the oldest step is dropped first. */
export const MAX_HISTORY_DEPTH = 50

const readRegion = (layer: Uint8Array, layers: MaskLayers, rect: Rect): Uint8Array => {
  const out = new Uint8Array(rect.width * rect.height)
  for (let row = 0; row < rect.height; row++) {
    const from = (rect.y + row) * layers.width + rect.x
    out.set(layer.subarray(from, from + rect.width), row * rect.width)
  }
  return out
}

const writeRegion = (
  layer: Uint8Array,
  layers: MaskLayers,
  rect: Rect,
  bytes: Uint8Array,
): void => {
  for (let row = 0; row < rect.height; row++) {
    const to = (rect.y + row) * layers.width + rect.x
    layer.set(bytes.subarray(row * rect.width, (row + 1) * rect.width), to)
  }
}

/**
 * Applies a command and records how to take it back.
 *
 * Doing anything new clears the redo stack — the branch the user walked away
 * from is gone, which is what every editor does and what users expect.
 */
export const execute = (
  history: History,
  command: EditorCommand,
  layers: MaskLayers,
): Result<History, KirilyError> => {
  const layer = targetLayer(command, layers)
  const rect = affectedRect(command, layers)
  const patch: Patch | null =
    layer !== null && rect !== null
      ? { layer, rect, before: readRegion(layer, layers, rect) }
      : null

  const applied = applyCommand(command, layers)
  if (!applied.ok) return applied

  const undoStack = [...history.undoStack, { command, patch }].slice(-MAX_HISTORY_DEPTH)
  return ok({ undoStack, redoStack: [] })
}

export const canUndo = (history: History): boolean => history.undoStack.length > 0

export const canRedo = (history: History): boolean => history.redoStack.length > 0

export const undo = (history: History, layers: MaskLayers): History => {
  const entry = history.undoStack.at(-1)
  if (entry === undefined) return history

  if (entry.patch !== null) {
    const { layer, rect, before } = entry.patch
    // Swap: what is there now becomes what redo has to put back.
    const current = readRegion(layer, layers, rect)
    writeRegion(layer, layers, rect, before)
    return {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [
        ...history.redoStack,
        { command: entry.command, patch: { layer, rect, before: current } },
      ],
    }
  }

  return {
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, entry],
  }
}

export const redo = (history: History, layers: MaskLayers): History => {
  const entry = history.redoStack.at(-1)
  if (entry === undefined) return history

  if (entry.patch !== null) {
    const { layer, rect, before } = entry.patch
    const current = readRegion(layer, layers, rect)
    writeRegion(layer, layers, rect, before)
    return {
      undoStack: [
        ...history.undoStack,
        { command: entry.command, patch: { layer, rect, before: current } },
      ],
      redoStack: history.redoStack.slice(0, -1),
    }
  }

  return {
    undoStack: [...history.undoStack, entry],
    redoStack: history.redoStack.slice(0, -1),
  }
}
