import { describe, expect, test } from 'bun:test'
import { budgetFor, PREVIEW_BUDGET, previewSizeFor } from './preview.ts'

describe('previewSizeFor', () => {
  test('shrinks a 4K photo to the budget long edge', () => {
    const preview = previewSizeFor({ width: 4000, height: 3000 }, PREVIEW_BUDGET.Mobile)
    expect(preview.width).toBe(1600)
    expect(preview.height).toBe(1200)
    expect(preview.scale).toBe(0.4)
  })

  test('never enlarges a small image', () => {
    const preview = previewSizeFor({ width: 640, height: 480 }, PREVIEW_BUDGET.Desktop)
    expect(preview).toEqual({ width: 640, height: 480, scale: 1 })
  })

  test('keeps the short edge at least one pixel', () => {
    const preview = previewSizeFor({ width: 8000, height: 3 }, PREVIEW_BUDGET.Low)
    expect(preview.height).toBeGreaterThanOrEqual(1)
  })

  test('uses the long edge whichever way the image is turned', () => {
    const landscape = previewSizeFor({ width: 4000, height: 1000 }, PREVIEW_BUDGET.Low)
    const portrait = previewSizeFor({ width: 1000, height: 4000 }, PREVIEW_BUDGET.Low)
    expect(landscape.width).toBe(1024)
    expect(portrait.height).toBe(1024)
  })
})

describe('budgetFor', () => {
  test('drops to the low budget on a memory-constrained device', () => {
    expect(budgetFor({ deviceMemoryGb: 4, isMobile: false })).toBe(PREVIEW_BUDGET.Low)
  })

  test('assumes the middle when the browser does not report memory', () => {
    expect(budgetFor({ isMobile: true })).toBe(PREVIEW_BUDGET.Mobile)
    expect(budgetFor({ isMobile: false })).toBe(PREVIEW_BUDGET.Desktop)
  })
})
