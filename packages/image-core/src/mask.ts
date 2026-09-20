/**
 * Pure mask operations in TypeScript.
 *
 * These mirror `crates/kirily-mask` exactly and are the fallback for browsers
 * where WASM is unavailable (kirily-design.md §24). They are also the
 * executable specification: the Rust tests and these tests assert the same
 * behaviour, so a change to one that is not mirrored in the other is caught.
 *
 * Nothing here touches the DOM — `kirily/no-dom-in-core` enforces that — so it
 * runs in a Worker and in a plain unit test.
 */
import type { BrushMode, BrushSettings, MaskLayers } from '@kirily/contract/mask'
import { MASK_OPAQUE, MASK_TRANSPARENT } from '@kirily/contract/mask'
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { ImagePoint } from '@kirily/contract/geometry'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'

export const createMaskLayers = (width: number, height: number): MaskLayers => {
  const pixels = width * height
  return {
    width,
    height,
    // An all-opaque base means "nothing removed yet": the user sees their
    // image, not an empty checkerboard, before the AI has run.
    base: new Uint8Array(pixels).fill(MASK_OPAQUE),
    keep: new Uint8Array(pixels),
    remove: new Uint8Array(pixels),
    version: 0,
  }
}

const expectLength = (buffer: Uint8Array, expected: number): Result<void, KirilyError> =>
  buffer.length === expected
    ? ok(undefined)
    : err(
        kirilyError(
          KirilyErrorCode.SizeMismatch,
          `expected ${expected} bytes, got ${buffer.length}`,
        ),
      )

/**
 * Flattens the three layers into the mask the renderer and the exporter use.
 *
 * Manual edits win over the AI, always. Writes into `out` so the caller can
 * reuse one buffer instead of allocating 8 MB per frame.
 */
export const composeMask = (layers: MaskLayers, out: Uint8Array): Result<void, KirilyError> => {
  const pixels = layers.width * layers.height
  const sized = expectLength(out, pixels)
  if (!sized.ok) return sized

  for (let i = 0; i < pixels; i++) {
    const base = layers.base[i] ?? MASK_TRANSPARENT
    const keep = layers.keep[i] ?? MASK_TRANSPARENT
    const remove = layers.remove[i] ?? MASK_TRANSPARENT
    const kept = base > keep ? base : keep
    out[i] = kept > remove ? kept - remove : MASK_TRANSPARENT
  }
  return ok(undefined)
}

/**
 * Paints one brush dab into the layer `mode` selects.
 *
 * Only the dab's bounding box is visited, so a stroke costs the area of the
 * brush rather than the area of the image.
 */
export const stampBrush = (
  layer: Uint8Array,
  size: { readonly width: number; readonly height: number },
  at: ImagePoint,
  brush: BrushSettings,
): Result<void, KirilyError> => {
  const sized = expectLength(layer, size.width * size.height)
  if (!sized.ok) return sized
  if (!(brush.size > 0) || !(brush.opacity > 0)) return ok(undefined)

  const radius = brush.size
  const minX = Math.max(0, Math.floor(at.x - radius))
  const maxX = Math.min(size.width - 1, Math.ceil(at.x + radius))
  const minY = Math.max(0, Math.floor(at.y - radius))
  const maxY = Math.min(size.height - 1, Math.ceil(at.y + radius))

  const hardness = Math.min(1, Math.max(0, brush.hardness))
  const opacity = Math.min(1, Math.max(0, brush.opacity))
  const inner = radius * hardness
  const falloff = radius - inner

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - at.x
      const dy = y + 0.5 - at.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > radius) continue

      const strength =
        distance <= inner || falloff <= 0 ? opacity : opacity * (1 - (distance - inner) / falloff)
      if (strength <= 0) continue

      const index = y * size.width + x
      const current = layer[index] ?? MASK_TRANSPARENT
      // The override layers only ever accumulate towards opaque: "how strongly
      // did the user say this?", not "what colour is it now".
      const painted = Math.round(current + (MASK_OPAQUE - current) * strength)
      layer[index] = painted > MASK_OPAQUE ? MASK_OPAQUE : painted
    }
  }
  return ok(undefined)
}

export const layerFor = (layers: MaskLayers, mode: BrushMode): Uint8Array =>
  mode === 'keep' ? layers.keep : layers.remove

/**
 * Resamples a mask between resolutions with bilinear filtering.
 *
 * Both directions are needed and both are on a hot path: the AI runs at a
 * small input size and its result has to reach the original resolution, while
 * the renderer needs the composed mask at preview size. Nearest-neighbour is
 * cheaper but turns every soft edge into stair-steps, which is exactly the
 * quality Kirily is trying to protect.
 */
export const resampleMask = (
  source: Uint8Array,
  from: { readonly width: number; readonly height: number },
  to: { readonly width: number; readonly height: number },
  out: Uint8Array = new Uint8Array(to.width * to.height),
): Uint8Array => {
  if (from.width === to.width && from.height === to.height) {
    out.set(source)
    return out
  }

  const xRatio = from.width / to.width
  const yRatio = from.height / to.height

  for (let y = 0; y < to.height; y++) {
    // Clamped to the source: without this, the first and last row would get a
    // negative weight and extrapolate past the values that actually exist.
    const sourceY = Math.min(from.height - 1, Math.max(0, (y + 0.5) * yRatio - 0.5))
    const y0 = Math.max(0, Math.floor(sourceY))
    const y1 = Math.min(from.height - 1, y0 + 1)
    const wy = sourceY - y0

    for (let x = 0; x < to.width; x++) {
      const sourceX = Math.min(from.width - 1, Math.max(0, (x + 0.5) * xRatio - 0.5))
      const x0 = Math.max(0, Math.floor(sourceX))
      const x1 = Math.min(from.width - 1, x0 + 1)
      const wx = sourceX - x0

      const topLeft = source[y0 * from.width + x0] ?? 0
      const topRight = source[y0 * from.width + x1] ?? 0
      const bottomLeft = source[y1 * from.width + x0] ?? 0
      const bottomRight = source[y1 * from.width + x1] ?? 0

      const top = topLeft + (topRight - topLeft) * wx
      const bottom = bottomLeft + (bottomRight - bottomLeft) * wx
      out[y * to.width + x] = Math.round(top + (bottom - top) * wy)
    }
  }
  return out
}

export type SolidifyOptions = {
  /** Alpha at or below this is treated as background while tracing inward. */
  readonly backgroundBelow: number
  /** How many pixels around the traced background are left untouched. */
  readonly edgeBand: number
  /** How many pixels it takes to ramp from untouched to fully closed. */
  readonly ramp: number
}

export const DEFAULT_SOLIDIFY: SolidifyOptions = {
  backgroundBelow: 24,
  edgeBand: 6,
  ramp: 8,
}

/**
 * Makes the inside of the subject opaque without hardening its outline.
 *
 * Segmentation models return low confidence wherever the subject's interior
 * looks like the background — pale skin between hair strands on a near-white
 * background is the case this was written for. The result reads as a ghostly
 * hole in the cut-out even though the silhouette is correct.
 *
 * The fix is not a threshold: that would also flatten the anti-aliased hair
 * edges, which are the thing Kirily is trying to protect. Instead:
 *
 *   1. trace the background inward from the image border, through pixels the
 *      model is confident about;
 *   2. measure how far each remaining pixel sits from that background;
 *   3. leave the first `edgeBand` pixels exactly as the model left them, then
 *      ramp towards fully opaque over the next `ramp` pixels.
 *
 * The ramp matters: setting a hard 255 beyond the band leaves a visible seam
 * wherever the closed region reaches near the silhouette.
 *
 * Only pixels the model already leaned towards foreground are raised, which is
 * what keeps a genuine hole — a mug handle, a gap between arms — transparent.
 * The model reports near-zero there, not "unsure".
 *
 * Deliberately TypeScript-only, unlike the other pixel operations: it runs
 * once per AI run inside the AI worker, which does not load the WASM engine.
 * If it ever shows up in a profile, it belongs in `kirily-mask`.
 */
export const solidifyInterior = (
  mask: Uint8Array,
  size: { readonly width: number; readonly height: number },
  options: SolidifyOptions = DEFAULT_SOLIDIFY,
): Uint8Array => {
  const { width, height } = size
  const pixels = width * height
  if (mask.length !== pixels || pixels === 0) return mask

  // Rings out from the traced background: 0 = unvisited, 1 = background,
  // n = (n - 1) pixels away from it. Capped so it fits a byte.
  const MAX_RING = 255
  const ring = new Uint8Array(pixels)
  const queue = new Int32Array(pixels)
  let head = 0
  let tail = 0

  const seed = (index: number): void => {
    if (ring[index] !== 0) return
    if ((mask[index] ?? 0) > options.backgroundBelow) return
    ring[index] = 1
    queue[tail++] = index
  }

  for (let x = 0; x < width; x++) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    seed(y * width)
    seed(y * width + width - 1)
  }

  while (head < tail) {
    const index = queue[head++] ?? 0
    const x = index % width
    const y = (index - x) / width
    if (x > 0) seed(index - 1)
    if (x < width - 1) seed(index + 1)
    if (y > 0) seed(index - width)
    if (y < height - 1) seed(index + width)
  }

  const reach = Math.min(MAX_RING - 1, options.edgeBand + options.ramp)
  let frontierStart = 0
  let frontierEnd = tail
  for (let step = 0; step < reach; step++) {
    const nextRing = step + 2
    const nextStart = tail
    for (let i = frontierStart; i < frontierEnd; i++) {
      const index = queue[i] ?? 0
      const x = index % width
      const y = (index - x) / width
      const grow = (neighbour: number): void => {
        if (ring[neighbour] !== 0) return
        ring[neighbour] = nextRing
        queue[tail++] = neighbour
      }
      if (x > 0) grow(index - 1)
      if (x < width - 1) grow(index + 1)
      if (y > 0) grow(index - width)
      if (y < height - 1) grow(index + width)
    }
    frontierStart = nextStart
    frontierEnd = tail
    if (frontierStart === frontierEnd) break
  }

  for (let i = 0; i < pixels; i++) {
    const alpha = mask[i] ?? 0
    if (alpha <= options.backgroundBelow) continue

    const distance = ring[i] === 0 ? Infinity : (ring[i] ?? 1) - 1
    if (distance <= options.edgeBand) continue

    const strength =
      options.ramp <= 0 ? 1 : Math.min(1, (distance - options.edgeBand) / options.ramp)
    mask[i] = Math.round(alpha + (MASK_OPAQUE - alpha) * strength)
  }

  return mask
}
