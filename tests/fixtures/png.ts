/**
 * A minimal PNG writer.
 *
 * The fixtures are the ground truth the quality suite is measured against, so
 * they must not depend on an image library that could change its resampling or
 * its gamma handling between versions and move every number at once.
 */
import { deflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xff_ff_ff_ff
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xff_ff_ff_ff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const body = new Uint8Array(4 + data.length)
  body.set(new TextEncoder().encode(type), 0)
  body.set(data, 4)

  const out = new Uint8Array(8 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(body, 4)
  view.setUint32(8 + data.length, crc32(body))
  return out
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * Encodes interleaved samples as a PNG. `channels` is 3 for RGB and 4 for RGBA.
 *
 * Filter type 0 on every row: these images are written once and read by a
 * browser, so a smaller file is not worth a filter heuristic that could differ
 * from run to run.
 */
export const encodePng = (
  samples: Uint8Array,
  width: number,
  height: number,
  channels: 3 | 4,
): Uint8Array => {
  const stride = width * channels
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    raw.set(samples.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }

  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = channels === 4 ? 6 : 2

  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}
