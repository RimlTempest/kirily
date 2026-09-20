/**
 * The mask model (IMPLEMENTATION.md §13, §14).
 *
 * One byte per pixel at the *original* image resolution: 0 transparent, 255
 * opaque. The AI result and the user's edits are kept apart so that re-running
 * the AI never silently erases something the user painted
 * (kirily-design.md §8).
 */
export type MaskLayers = {
  readonly width: number
  readonly height: number
  /** What the AI produced. Replaced wholesale when the AI runs again. */
  readonly base: Uint8Array
  /** Where the user said "keep this", regardless of the AI. */
  readonly keep: Uint8Array
  /** Where the user said "remove this", regardless of the AI. */
  readonly remove: Uint8Array
  /**
   * Bumped whenever any layer changes. The renderer compares it instead of
   * diffing 8 MB of mask to decide whether to redraw.
   */
  readonly version: number
}

export const MASK_TRANSPARENT = 0
export const MASK_OPAQUE = 255

/** Which layer a brush writes to. */
export const BrushMode = {
  Keep: 'keep',
  Remove: 'remove',
} as const

export type BrushMode = (typeof BrushMode)[keyof typeof BrushMode]

export type BrushSettings = {
  /** Radius in image pixels. */
  readonly size: number
  /** 0 = fully soft edge, 1 = hard edge. */
  readonly hardness: number
  /** 0 = no effect, 1 = full strength. */
  readonly opacity: number
}

export const DEFAULT_BRUSH: BrushSettings = { size: 32, hardness: 0.8, opacity: 1 }
