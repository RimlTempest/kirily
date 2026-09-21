/**
 * The evaluation set: images whose correct alpha is known exactly.
 *
 * A photograph has no ground truth that is not itself someone's opinion, so
 * every case here is composited from a subject and a background that this file
 * chose. `alpha` is not a traced mask — it is the coverage that produced the
 * pixels, which makes "the model is 3 points worse at hair" a statement about
 * the model rather than about whoever drew the outline.
 *
 * Each case exists to fail in one specific way. Adding one without naming the
 * failure it catches makes the suite slower without making it stricter.
 */
export type Rgb = readonly [number, number, number]

export type Case = {
  readonly name: string
  /** What a regression here would mean. */
  readonly catches: string
  readonly width: number
  readonly height: number
  /** The composited image, opaque. */
  readonly rgb: Uint8Array
  /** The coverage that produced it: the answer. */
  readonly alpha: Uint8Array
}

/** Coverage is measured by sampling each pixel this many times per axis. */
const SUPERSAMPLE = 4

const SIZE = 384

type Scene = {
  readonly catches: string
  /** True where the subject covers this point, in continuous coordinates. */
  readonly covers: (x: number, y: number) => boolean
  readonly subject: (x: number, y: number) => Rgb
  readonly background: (x: number, y: number) => Rgb
}

const flat =
  (colour: Rgb) =>
  (): Rgb =>
    colour

const disc =
  (cx: number, cy: number, radius: number) =>
  (x: number, y: number): boolean =>
    (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius

/**
 * A rounded body with tapering strands off the top — a stand-in for hair.
 *
 * Strands are what separates a segmentation mask from a matte, and they are
 * the one feature a 320² model physically cannot resolve, so this case is
 * expected to score worst. That is the point of keeping it.
 */
const strands = (x: number, y: number): boolean => {
  const cx = SIZE / 2
  if (disc(cx, SIZE * 0.62, SIZE * 0.26)(x, y)) return true
  if (y > SIZE * 0.62) return false

  for (let i = 0; i < 14; i += 1) {
    const angle = -Math.PI / 2 + (i - 6.5) * 0.13
    const length = SIZE * (0.3 + 0.12 * Math.cos(i))
    const along = (x - cx) * Math.cos(angle) + (y - SIZE * 0.62) * Math.sin(angle)
    if (along < 0 || along > length) continue
    const across = -(x - cx) * Math.sin(angle) + (y - SIZE * 0.62) * Math.cos(angle)
    // Tapers to nothing: the tip is under a pixel wide.
    const halfWidth = 2.6 * (1 - along / length)
    if (Math.abs(across) <= halfWidth) return true
  }
  return false
}

const SCENES: readonly Scene[] = [
  {
    catches: 'a silhouette that collapses on the easiest possible input',
    covers: disc(SIZE / 2, SIZE / 2, SIZE * 0.3),
    subject: flat([200, 60, 50]),
    background: flat([240, 240, 238]),
  },
  {
    catches: 'a subject lost when it is barely brighter than its background',
    covers: disc(SIZE / 2, SIZE / 2, SIZE * 0.3),
    subject: flat([253, 240, 236]),
    background: flat([248, 248, 246]),
  },
  {
    catches: 'thin detail dropped, which is what a matte would recover',
    covers: strands,
    subject: flat([60, 45, 40]),
    background: flat([238, 240, 243]),
  },
  {
    catches: 'a genuine hole filled in by whatever closes half-transparent interiors',
    covers: (x, y) =>
      disc(SIZE / 2, SIZE / 2, SIZE * 0.34)(x, y) && !disc(SIZE / 2, SIZE / 2, SIZE * 0.15)(x, y),
    subject: flat([70, 110, 190]),
    background: flat([242, 241, 237]),
  },
  {
    catches: 'a halo left behind when the background was never one colour',
    covers: disc(SIZE / 2, SIZE * 0.55, SIZE * 0.28),
    subject: flat([245, 246, 248]),
    background: (_x, y) => {
      const t = y / SIZE
      return [Math.round(30 + 150 * t), Math.round(90 + 90 * t), Math.round(160 - 40 * t)]
    },
  },
]

const NAMES = ['solid-disc', 'low-contrast', 'thin-strands', 'ring-with-hole', 'gradient-backdrop']

const render = (scene: Scene, name: string): Case => {
  const alpha = new Uint8Array(SIZE * SIZE)
  const rgb = new Uint8Array(SIZE * SIZE * 3)
  const step = 1 / SUPERSAMPLE
  const samples = SUPERSAMPLE * SUPERSAMPLE

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let covered = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          if (scene.covers(x + (sx + 0.5) * step, y + (sy + 0.5) * step)) covered += 1
        }
      }

      const a = covered / samples
      const index = y * SIZE + x
      alpha[index] = Math.round(a * 255)

      const front = scene.subject(x, y)
      const back = scene.background(x, y)
      for (let c = 0; c < 3; c += 1) {
        rgb[index * 3 + c] = Math.round((front[c] ?? 0) * a + (back[c] ?? 0) * (1 - a))
      }
    }
  }

  return { name, catches: scene.catches, width: SIZE, height: SIZE, rgb, alpha }
}

export const evaluationCases = (): readonly Case[] =>
  SCENES.map((scene, i) => render(scene, NAMES[i] ?? `case-${i}`))
