import { describe, expect, test } from 'bun:test'
import { imagePoint } from '@kirily/contract/geometry'
import type { BrushMode } from '@kirily/contract/mask'
import { DEFAULT_BUCKET } from '@kirily/contract/mask'
import { createMaskLayers } from '@kirily/image-core/mask'
import type { EditorCommand } from './commands.ts'
import {
  canRedo,
  canUndo,
  emptyHistory,
  execute,
  MAX_HISTORY_DEPTH,
  redo,
  undo,
} from './history.ts'

const stroke = (x: number): EditorCommand => ({
  kind: 'brush-stroke',
  mode: 'remove',
  brush: { size: 2, hardness: 1, opacity: 1 },
  points: [imagePoint(x, 4.5)],
})

describe('execute / undo / redo', () => {
  test('undo restores the exact bytes a stroke overwrote', () => {
    const layers = createMaskLayers(9, 9)
    const before = new Uint8Array(layers.remove)

    const afterExecute = execute(emptyHistory, stroke(4.5), layers)
    expect(afterExecute.ok).toBe(true)
    if (!afterExecute.ok) return
    expect(layers.remove[4 * 9 + 4]).toBe(255)

    const afterUndo = undo(afterExecute.value, layers)
    expect([...layers.remove]).toEqual([...before])
    expect(canUndo(afterUndo)).toBe(false)
    expect(canRedo(afterUndo)).toBe(true)
  })

  test('redo puts the stroke back', () => {
    const layers = createMaskLayers(9, 9)
    const executed = execute(emptyHistory, stroke(4.5), layers)
    if (!executed.ok) return

    const undone = undo(executed.value, layers)
    const redone = redo(undone, layers)

    expect(layers.remove[4 * 9 + 4]).toBe(255)
    expect(canRedo(redone)).toBe(false)
    expect(canUndo(redone)).toBe(true)
  })

  test('a new edit discards the redo branch', () => {
    const layers = createMaskLayers(9, 9)
    const first = execute(emptyHistory, stroke(4.5), layers)
    if (!first.ok) return
    const undone = undo(first.value, layers)

    const second = execute(undone, stroke(2.5), layers)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(canRedo(second.value)).toBe(false)
  })

  test('undo on an empty history is a no-op', () => {
    const layers = createMaskLayers(4, 4)
    expect(undo(emptyHistory, layers)).toEqual(emptyHistory)
    expect(redo(emptyHistory, layers)).toEqual(emptyHistory)
  })

  test('undoing three strokes rewinds them one at a time', () => {
    const layers = createMaskLayers(9, 9)
    let history = emptyHistory
    for (const x of [1.5, 4.5, 7.5]) {
      const result = execute(history, stroke(x), layers)
      if (!result.ok) return
      history = result.value
    }

    history = undo(history, layers)
    expect(layers.remove[4 * 9 + 7]).toBe(0)
    expect(layers.remove[4 * 9 + 4]).toBe(255)

    history = undo(history, layers)
    expect(layers.remove[4 * 9 + 4]).toBe(0)
    expect(layers.remove[4 * 9 + 1]).toBe(255)
  })

  test('history is bounded so a long session cannot grow without limit', () => {
    const layers = createMaskLayers(9, 9)
    let history = emptyHistory
    for (let i = 0; i < MAX_HISTORY_DEPTH + 10; i++) {
      const result = execute(history, stroke(4.5), layers)
      if (!result.ok) return
      history = result.value
    }
    expect(history.undoStack.length).toBe(MAX_HISTORY_DEPTH)
  })

  test('replacing the AI mask is one undo step', () => {
    const layers = createMaskLayers(4, 4)
    const alpha = new Uint8Array(16).fill(0)
    const executed = execute(emptyHistory, { kind: 'replace-base-mask', alpha }, layers)
    if (!executed.ok) return

    expect([...layers.base].every((v) => v === 0)).toBe(true)
    undo(executed.value, layers)
    expect([...layers.base].every((v) => v === 255)).toBe(true)
  })
})

describe('bucket fill', () => {
  const SIZE = 16

  /** White canvas, red square in the middle, white dot inside the square. */
  const scene = (): Uint8ClampedArray => {
    const rgba = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255)
    const paint = (x: number, y: number, r: number, g: number, b: number): void => {
      const at = (y * SIZE + x) * 4
      rgba[at] = r
      rgba[at + 1] = g
      rgba[at + 2] = b
      rgba[at + 3] = 255
    }
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) paint(x, y, 220, 40, 40)
    paint(8, 8, 255, 255, 255)
    return rgba
  }

  const fill = (x: number, y: number, mode: BrushMode = 'remove'): EditorCommand => ({
    kind: 'bucket-fill',
    guide: null,
    mode,
    at: imagePoint(x, y),
    settings: DEFAULT_BUCKET,
    rgba: scene(),
  })

  test('takes the whole clicked region in one step', () => {
    const layers = createMaskLayers(SIZE, SIZE)
    const result = execute(emptyHistory, fill(0, 0), layers)

    expect(result.ok).toBe(true)
    expect(layers.remove[0]).toBe(255)
    expect(layers.remove[15 * SIZE + 15]).toBe(255)
    // The red square is a different colour, so it stays.
    expect(layers.remove[6 * SIZE + 6]).toBe(0)
  })

  test('undo puts back exactly what the fill overwrote', () => {
    const layers = createMaskLayers(SIZE, SIZE)
    const before = new Uint8Array(layers.remove)

    const executed = execute(emptyHistory, fill(0, 0), layers)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    undo(executed.value, layers)
    expect(Array.from(layers.remove)).toEqual(Array.from(before))
  })

  test('snapshots only the region it filled, not the whole layer', () => {
    const layers = createMaskLayers(SIZE, SIZE)
    // Clicking inside the red square touches an 8x8 box, not the 16x16 image.
    const executed = execute(emptyHistory, fill(6, 6), layers)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return

    const entry = executed.value.undoStack.at(-1)
    expect(entry?.patch?.rect).toEqual({ x: 4, y: 4, width: 8, height: 8 })
  })

  test('is one undo step even though it changed many pixels', () => {
    const layers = createMaskLayers(SIZE, SIZE)
    const executed = execute(emptyHistory, fill(0, 0), layers)
    if (!executed.ok) return
    expect(executed.value.undoStack.length).toBe(1)
  })

  test('accumulates rather than toggling when clicked twice', () => {
    const layers = createMaskLayers(SIZE, SIZE)
    let history = emptyHistory
    for (let i = 0; i < 2; i++) {
      const result = execute(history, fill(0, 0), layers)
      if (!result.ok) return
      history = result.value
    }
    expect(layers.remove[0]).toBe(255)
  })

  test('records nothing when the click lands outside the image', () => {
    const layers = createMaskLayers(SIZE, SIZE)
    const executed = execute(emptyHistory, fill(-5, -5), layers)
    expect(executed.ok).toBe(true)
    if (!executed.ok) return
    expect(executed.value.undoStack.at(-1)?.patch).toBeNull()
  })

  test('writes to the layer the mode selects', () => {
    const layers = createMaskLayers(SIZE, SIZE)
    execute(emptyHistory, fill(0, 0, 'keep'), layers)

    expect(layers.keep[0]).toBe(255)
    expect(layers.remove[0]).toBe(0)
  })
})
