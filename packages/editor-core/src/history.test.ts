import { describe, expect, test } from 'bun:test'
import { imagePoint } from '@kirily/contract/geometry'
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
