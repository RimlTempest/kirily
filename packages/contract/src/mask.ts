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

/**
 * The bucket: click a region and take the whole thing in or out at once.
 *
 * `tolerance` is a perceptual distance in OKLab, not an RGB one. The
 * difference decides whether the tool is usable on a pale subject against a
 * pale background — see `packages/image-core/src/color.ts`.
 */
export type BucketSettings = {
  /** 0..1 in OKLab. ~0.02 catches a flat backdrop; ~0.2 is very loose. */
  readonly tolerance: number
  /** 0..1. How much of the tolerance band fades rather than filling fully. */
  readonly feather: number
  /** False selects every matching pixel, not just the one clicked into. */
  readonly contiguous: boolean
  /**
   * Whether the fill may cross the AI's idea of the subject's edge.
   *
   * Colour alone cannot separate a white collar from a white page — measured
   * at 0.0187 in OKLab against the background's own spread of 0.0030, which is
   * inside any tolerance loose enough to be useful (ADR-0012). The mask knows,
   * so the fill can ask it.
   *
   * Off turns the bucket back into a pure colour fill, which is what is wanted
   * when the thing being corrected *is* the mask.
   */
  readonly guided: boolean
}

/**
 * Measured on `tests/fixtures/pale-subject-on-white.png`, which is the tightest
 * case the project has:
 *
 *   background's own spread   median 0.0026, 99th percentile 0.0070
 *   white highlight in hair   0.0093   ← the nearest thing that must survive
 *   skin                      0.0112
 *
 * So the usable window is 0.007–0.009. `tolerance` sits inside it, and
 * `feather` is small because a wide fade over a band this narrow leaves the
 * background half-selected — which reads as a ghost of the old backdrop.
 */
export const DEFAULT_BUCKET: BucketSettings = {
  tolerance: 0.008,
  feather: 0.2,
  contiguous: true,
  guided: true,
}
