/**
 * The bucket's selection.
 *
 * A scanline flood fill: it walks whole runs of pixels at a time instead of
 * pushing every neighbour, which keeps the stack small and the inner loop
 * tight enough to run on a full-resolution image while the user waits for a
 * click to land.
 *
 * The result is a *soft* selection, not a set of pixels. A hard 0/255 fill
 * stair-steps along every boundary, which is exactly the edge quality Kirily
 * exists to protect (ADR-0008); pixels near the tolerance edge come back
 * partially selected instead.
 *
 * Measured at 1254²: 360ms before the distance cache and the sRGB table below,
 * 70ms after. That is why this stayed in TypeScript — a Rust mirror would buy
 * little, and `applyCommand` runs in `editor-core`, which has no WASM engine.
 */
import type { BucketSettings } from '@kirily/contract/mask'
import type { Oklab } from './color.ts'
import { toOklab } from './color.ts'

export type Size = { readonly width: number; readonly height: number }
export type Seed = { readonly x: number; readonly y: number }

/** Filled in place so the caller can snapshot only what the fill touched. */
export type Bounds = { x: number; y: number; width: number; height: number }

export const floodSelect = (
  rgba: Uint8ClampedArray,
  size: Size,
  seed: Seed,
  settings: BucketSettings,
  out: Uint8Array = new Uint8Array(size.width * size.height),
  bounds?: Bounds,
  /**
   * The AI's alpha, when there is one. A pixel on the other side of the
   * subject's edge is out of reach however close its colour is, which is the
   * only thing that separates a white collar from a white page.
   *
   * A guide that does not match the image is ignored rather than trusted.
   */
  guide?: Uint8Array,
): Uint8Array => {
  const { width, height } = size
  const seedX = Math.floor(seed.x)
  const seedY = Math.floor(seed.y)

  const empty = (): Uint8Array => {
    if (bounds !== undefined) {
      bounds.x = 0
      bounds.y = 0
      bounds.width = 0
      bounds.height = 0
    }
    return out
  }

  if (rgba.length !== width * height * 4 || out.length !== width * height) return empty()
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return empty()

  const seedIndex = seedY * width + seedX
  const target = colourAt(rgba, seedIndex)

  // A guide that does not describe this image says nothing about it.
  const usable = settings.guided && guide !== undefined && guide.length === width * height
  // Which side of the subject's edge the click landed on. Everything the fill
  // reaches has to be on that side.
  const seedSide = usable && (guide?.[seedIndex] ?? 0) >= 128
  // Below `inner` a pixel is fully selected; between there and `tolerance` it
  // fades out. Feather 0 collapses the two into a hard edge.
  const tolerance = Math.max(0, settings.tolerance)
  const inner = tolerance * (1 - Math.min(1, Math.max(0, settings.feather)))
  const falloff = tolerance - inner

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  // Each pixel's distance is asked for three or four times — once while
  // walking a run, once while filling it, once per neighbouring row. Computing
  // OKLab that many times was most of the cost, so it is memoised.
  const distances = new Float32Array(width * height)
  const measured = new Uint8Array(width * height)

  const strengthAt = (index: number): number => {
    let distance: number
    if (measured[index] === 1) {
      distance = distances[index] ?? 0
    } else {
      distance = distanceTo(rgba, index, target)
      distances[index] = distance
      measured[index] = 1
    }
    if (distance > tolerance) return 0
    // Checked after the colour, not before: the distance is memoised and the
    // guide is a single read, so this order costs nothing and keeps the cheap
    // rejection first.
    if (usable && (guide?.[index] ?? 0) >= 128 !== seedSide) return 0
    if (distance <= inner || falloff <= 0) return 255
    return Math.round(255 * (1 - (distance - inner) / falloff))
  }

  const take = (index: number, strength: number): void => {
    out[index] = strength
    const x = index % width
    const y = (index - x) / width
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  if (!settings.contiguous) {
    for (let i = 0; i < width * height; i++) {
      const strength = strengthAt(i)
      if (strength > 0) take(i, strength)
    }
    return report(out, bounds, minX, minY, maxX, maxY)
  }

  // `visited` is separate from `out`: a pixel selected at strength 0 would be
  // indistinguishable from an unvisited one, and the fill would loop.
  const visited = new Uint8Array(width * height)
  // Spans to explore, as [x, y] pairs. An Int32Array grows in one allocation
  // rather than the many a plain array would do on a large fill.
  const stack: number[] = [seedX, seedY]

  while (stack.length > 0) {
    const y = stack.pop() ?? 0
    const x = stack.pop() ?? 0
    const row = y * width
    if (visited[row + x] === 1) continue

    // Walk left and right to the ends of this run.
    let left = x
    while (left > 0 && visited[row + left - 1] === 0 && strengthAt(row + left - 1) > 0) {
      left -= 1
    }
    let right = x
    while (right < width - 1 && visited[row + right + 1] === 0 && strengthAt(row + right + 1) > 0) {
      right += 1
    }

    for (let i = left; i <= right; i++) {
      visited[row + i] = 1
      take(row + i, strengthAt(row + i))
    }

    // Push the runs above and below. One entry per run, not per pixel.
    for (const neighbourY of [y - 1, y + 1]) {
      if (neighbourY < 0 || neighbourY >= height) continue
      const neighbourRow = neighbourY * width
      let inRun = false
      for (let i = left; i <= right; i++) {
        const selectable = visited[neighbourRow + i] === 0 && strengthAt(neighbourRow + i) > 0
        if (selectable && !inRun) {
          stack.push(i, neighbourY)
          inRun = true
        } else if (!selectable) {
          inRun = false
        }
      }
    }
  }

  return report(out, bounds, minX, minY, maxX, maxY)
}

const report = (
  out: Uint8Array,
  bounds: Bounds | undefined,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Uint8Array => {
  if (bounds !== undefined) {
    const found = maxX >= minX && maxY >= minY
    bounds.x = found ? minX : 0
    bounds.y = found ? minY : 0
    bounds.width = found ? maxX - minX + 1 : 0
    bounds.height = found ? maxY - minY + 1 : 0
  }
  return out
}

const colourAt = (rgba: Uint8ClampedArray, pixel: number): Oklab => {
  const at = pixel * 4
  return toOklab(rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0)
}

const distanceTo = (rgba: Uint8ClampedArray, pixel: number, target: Oklab): number => {
  const [l, a, b] = colourAt(rgba, pixel)
  // `Math.hypot` guards against overflow the values here cannot reach, and it
  // is several times slower for it.
  const dl = l - target[0]
  const da = a - target[1]
  const db = b - target[2]
  return Math.sqrt(dl * dl + da * da + db * db)
}
