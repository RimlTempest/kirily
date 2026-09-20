/**
 * Preview sizing.
 *
 * The preview exists to keep the UI responsive; it is never the source of the
 * export (kirily-design.md §2.1). Keeping the decision in one pure function
 * means the rule "export reads the original" can be checked by reading one
 * file rather than auditing the renderer.
 */

/** Long-edge budgets, in image pixels, by how much room the device has. */
export const PREVIEW_BUDGET = {
  Low: 1024,
  Mobile: 1600,
  Desktop: 2048,
} as const

export type PreviewBudget = (typeof PREVIEW_BUDGET)[keyof typeof PREVIEW_BUDGET]

export type PreviewSize = {
  readonly width: number
  readonly height: number
  /** Preview pixels per image pixel. 1 means the preview is the original. */
  readonly scale: number
}

/**
 * Shrinks to fit the budget's long edge, never enlarges. An image smaller than
 * the budget is previewed at 1:1 so nothing is resampled for no reason.
 */
export const previewSizeFor = (
  image: { readonly width: number; readonly height: number },
  budget: PreviewBudget,
): PreviewSize => {
  const longEdge = Math.max(image.width, image.height)
  if (longEdge <= budget) return { width: image.width, height: image.height, scale: 1 }

  const scale = budget / longEdge
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
    scale,
  }
}

/**
 * Picks a budget from what the device reports. `deviceMemory` is only exposed
 * by Chromium, so absence means "assume the middle", not "assume the worst".
 */
export const budgetFor = (device: {
  readonly deviceMemoryGb?: number | undefined
  readonly isMobile: boolean
}): PreviewBudget => {
  if (device.deviceMemoryGb !== undefined && device.deviceMemoryGb <= 4) return PREVIEW_BUDGET.Low
  return device.isMobile ? PREVIEW_BUDGET.Mobile : PREVIEW_BUDGET.Desktop
}
