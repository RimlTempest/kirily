/**
 * float32 ↔ float16 conversion.
 *
 * The quality model ships as fp16 weights to halve the download, and its
 * exported graph takes fp16 tensors. JavaScript has no Float16Array here, so
 * the halves travel as raw `Uint16Array` bit patterns and are converted at the
 * boundary.
 *
 * Written out by hand rather than via `DataView`: this runs once per pixel of
 * a 1024² tensor, three times over.
 */

const buffer = new ArrayBuffer(4)
const asFloat = new Float32Array(buffer)
const asBits = new Uint32Array(buffer)

/** IEEE-754 binary32 → binary16, round-to-nearest-even. */
export const toFloat16 = (value: number): number => {
  asFloat[0] = value
  const bits = asBits[0] ?? 0

  const sign = (bits >>> 16) & 0x80_00
  const exponent = (bits >>> 23) & 0xff
  const mantissa = bits & 0x7f_ff_ff

  // NaN and infinity keep their meaning rather than saturating to a number.
  if (exponent === 0xff) {
    return sign | 0x7c_00 | (mantissa === 0 ? 0 : 0x02_00)
  }

  const unbiased = exponent - 127 + 15

  if (unbiased >= 0x1f) return sign | 0x7c_00 // overflows to infinity
  if (unbiased <= 0) {
    // Subnormal, or too small to represent at all.
    if (unbiased < -10) return sign
    const subnormal = (mantissa | 0x80_00_00) >>> (1 - unbiased + 13)
    return sign | subnormal
  }

  const rounded = mantissa + 0x00_10_00
  // Rounding can carry into the exponent; letting it do so is correct.
  if ((rounded & 0x80_00_00) !== 0) {
    return sign | ((unbiased + 1) << 10)
  }
  return sign | (unbiased << 10) | (rounded >>> 13)
}

/** IEEE-754 binary16 → binary32. */
export const fromFloat16 = (half: number): number => {
  const sign = (half & 0x80_00) << 16
  const exponent = (half >>> 10) & 0x1f
  const mantissa = half & 0x03_ff

  if (exponent === 0) {
    if (mantissa === 0) {
      asBits[0] = sign
      return asFloat[0] ?? 0
    }
    // Subnormal: normalise it into a binary32 exponent.
    let value = mantissa
    let shift = 0
    while ((value & 0x04_00) === 0) {
      value <<= 1
      shift += 1
    }
    // A half subnormal is M × 2⁻²⁴. After `shift` left-shifts the leading bit
    // sits at position 10, so the value is 2^(−14 − shift) × 1.mantissa.
    asBits[0] = sign | ((127 - 14 - shift) << 23) | ((value & 0x03_ff) << 13)
    return asFloat[0] ?? 0
  }

  if (exponent === 0x1f) {
    asBits[0] = sign | 0x7f_80_00_00 | (mantissa << 13)
    return asFloat[0] ?? 0
  }

  asBits[0] = sign | ((exponent - 15 + 127) << 23) | (mantissa << 13)
  return asFloat[0] ?? 0
}

export const encodeFloat16Array = (
  values: Float32Array,
  out: Uint16Array = new Uint16Array(values.length),
): Uint16Array => {
  for (let i = 0; i < values.length; i++) out[i] = toFloat16(values[i] ?? 0)
  return out
}

export const decodeFloat16Array = (
  halves: Uint16Array,
  out: Float32Array = new Float32Array(halves.length),
): Float32Array => {
  for (let i = 0; i < halves.length; i++) out[i] = fromFloat16(halves[i] ?? 0)
  return out
}
