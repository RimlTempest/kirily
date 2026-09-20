/**
 * Perceptual colour distance.
 *
 * A bucket tool keyed on RGB distance cannot separate this project's hardest
 * case: in `tests/fixtures/pale-subject-on-white.png` the background (#fbfbfa)
 * and the skin (#fff8f2) sit 9.4 apart in RGB, so any tolerance wide enough to
 * catch the background also swallows the face — and the white highlight in the
 * hair is *closer* to the background than the skin is.
 *
 * OKLab is built so that a given step means roughly the same amount of visible
 * change anywhere in the space. Measured on those colours, the hair stands out
 * 30x further than the skin does, against 19x in RGB.
 */

/** Lightness, green–red, blue–yellow. Lightness runs 0..1. */
export type Oklab = readonly [number, number, number]

/**
 * sRGB is stored gamma-encoded; the matrices below expect linear light.
 *
 * A table, not a formula: the conversion has only 256 possible inputs, and the
 * bucket runs it three times per pixel over a full-resolution image. The `**`
 * was the single biggest cost in that loop.
 */
const LINEAR = new Float64Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LINEAR[i] = c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export const toOklab = (red: number, green: number, blue: number): Oklab => {
  const r = LINEAR[red] ?? 0
  const g = LINEAR[green] ?? 0
  const b = LINEAR[blue] ?? 0

  const long = 0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b
  const medium = 0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b
  const short = 0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b

  const l = Math.cbrt(long)
  const m = Math.cbrt(medium)
  const s = Math.cbrt(short)

  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  ]
}

/**
 * Distance between two sRGB colours, in OKLab units.
 *
 * Roughly: 0.01 is a difference you have to look for, 0.1 is obvious. The
 * bucket's tolerance is expressed in these units so the slider means the same
 * thing on a dark photo and a pale illustration.
 */
export const perceptualDistance = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): number => {
  const a = toOklab(from[0], from[1], from[2])
  const b = toOklab(to[0], to[1], to[2])
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
