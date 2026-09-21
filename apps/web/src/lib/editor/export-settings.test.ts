import { describe, expect, test } from 'bun:test'
import { WHITE } from '@kirily/image-core/composite'
import { ExportFormat } from './export.ts'
import {
  BACKGROUND_PRESETS,
  DEFAULT_EXPORT,
  carriesAlpha,
  isLossy,
  needsBackground,
  withBackground,
  withFormat,
  withQuality,
  toHex,
  fromHex,
} from './export-settings.ts'

describe('what each format needs', () => {
  test('PNG is lossless, so quality means nothing to it', () => {
    expect(isLossy(ExportFormat.Png)).toBe(false)
  })

  test('WebP and JPEG both take a quality', () => {
    expect(isLossy(ExportFormat.WebP)).toBe(true)
    expect(isLossy(ExportFormat.Jpeg)).toBe(true)
  })

  test('only JPEG needs somewhere for the transparency to go', () => {
    expect(needsBackground(ExportFormat.Jpeg)).toBe(true)
    expect(needsBackground(ExportFormat.Png)).toBe(false)
    expect(needsBackground(ExportFormat.WebP)).toBe(false)
  })

  test('PNG and WebP keep the transparency, JPEG cannot', () => {
    expect(carriesAlpha(ExportFormat.Png)).toBe(true)
    expect(carriesAlpha(ExportFormat.WebP)).toBe(true)
    expect(carriesAlpha(ExportFormat.Jpeg)).toBe(false)
  })
})

describe('changing a setting', () => {
  test('switching format keeps the quality the user chose', () => {
    const chosen = withQuality(DEFAULT_EXPORT, 0.6)
    expect(withFormat(chosen, ExportFormat.Jpeg).quality).toBe(0.6)
  })

  test('switching format keeps the background the user chose', () => {
    const chosen = withBackground(DEFAULT_EXPORT, { r: 0, g: 0, b: 0 })
    expect(withFormat(chosen, ExportFormat.Jpeg).background).toEqual({ r: 0, g: 0, b: 0 })
  })

  test('quality is held between 0 and 1', () => {
    expect(withQuality(DEFAULT_EXPORT, 2).quality).toBe(1)
    expect(withQuality(DEFAULT_EXPORT, -1).quality).toBe(0)
  })

  test('a quality that is not a number is ignored rather than stored', () => {
    expect(withQuality(DEFAULT_EXPORT, Number.NaN).quality).toBe(DEFAULT_EXPORT.quality)
  })
})

describe('defaults', () => {
  test('PNG, because it is the only one that loses nothing', () => {
    expect(DEFAULT_EXPORT.format).toBe(ExportFormat.Png)
  })

  test('white, because that is what a transparent cut-out is usually put on', () => {
    expect(DEFAULT_EXPORT.background).toEqual({ r: 255, g: 255, b: 255 })
  })

  test('the presets offer white and black', () => {
    const colours = BACKGROUND_PRESETS.map((preset) => preset.rgb)
    expect(colours).toContainEqual({ r: 255, g: 255, b: 255 })
    expect(colours).toContainEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('hex', () => {
  test('round-trips a colour', () => {
    expect(fromHex(toHex({ r: 18, g: 52, b: 86 }), WHITE)).toEqual({ r: 18, g: 52, b: 86 })
  })

  test('pads a channel that needs it', () => {
    expect(toHex({ r: 0, g: 10, b: 255 })).toBe('#000aff')
  })

  test('keeps the current colour when the text is not one', () => {
    expect(fromHex('red', WHITE)).toEqual(WHITE)
    expect(fromHex('#12345', WHITE)).toEqual(WHITE)
  })
})
