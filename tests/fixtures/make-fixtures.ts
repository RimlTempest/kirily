/**
 * Regenerates the test images. They are committed so the suite does not depend
 * on a generator, but the generator is kept so a new case is one edit away.
 *
 * Run with: bun run tests/fixtures/make-fixtures.ts
 */
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xff_ff_ff_ff;
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xff_ff_ff_ff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);

  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
};

/** A red square centred on white — flat enough for the placeholder provider. */
const render = (size: number): Uint8Array => {
  const raw = new Uint8Array(size * (size * 3 + 1));
  const from = Math.floor(size / 4);
  const to = size - from;

  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inside = x >= from && x < to && y >= from && y < to;
      const at = row + 1 + x * 3;
      raw[at] = 255;
      raw[at + 1] = inside ? 40 : 255;
      raw[at + 2] = inside ? 40 : 255;
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];

  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
};

await Bun.write(new URL('subject-on-white.png', import.meta.url), render(120));
console.log('wrote tests/fixtures/subject-on-white.png');
