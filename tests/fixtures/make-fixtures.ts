/**
 * Regenerates the committed test images.
 *
 * They are committed so the suite does not depend on a generator, but the
 * generator is kept so a new case is one edit away. The evaluation set in
 * `cases.ts` is the other way round — generated at test time, because its
 * images exist only to be measured against and would otherwise be five PNGs
 * nobody ever looks at.
 *
 * Run with: bun run tests/fixtures/make-fixtures.ts
 */
import { encodePng } from './png.ts'

/** A red square centred on white — flat enough for the placeholder provider. */
const render = (size: number): Uint8Array => {
  const rgb = new Uint8Array(size * size * 3)
  const from = Math.floor(size / 4)
  const to = size - from

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = x >= from && x < to && y >= from && y < to
      const at = (y * size + x) * 3
      rgb[at] = 255
      rgb[at + 1] = inside ? 40 : 255
      rgb[at + 2] = inside ? 40 : 255
    }
  }
  return encodePng(rgb, size, size, 3)
}

await Bun.write(new URL('subject-on-white.png', import.meta.url), render(120))
console.log('wrote tests/fixtures/subject-on-white.png')
