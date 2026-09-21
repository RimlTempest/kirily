/**
 * What the three formats each need from the user.
 *
 * The export pipeline has handled PNG, WebP and JPEG since the beginning; only
 * PNG had a button. The other two need an answer first — a quality, and for
 * JPEG somewhere for the transparency to go — and those answers are what this
 * file models.
 *
 * Kept apart from `export.ts` because that file needs an `OffscreenCanvas` and
 * this one is arithmetic: the rules about which format needs what are worth
 * testing without a browser.
 */
import type { Rgb } from '@kirily/image-core/composite'
import { BLACK, WHITE } from '@kirily/image-core/composite'
import { ExportFormat } from './export.ts'

export type ExportSettings = {
  readonly format: ExportFormat
  /** 0..1. Ignored by PNG. */
  readonly quality: number
  /** Where transparency goes. Only JPEG uses it. */
  readonly background: Rgb
}

export const DEFAULT_EXPORT: ExportSettings = {
  // The only one that loses nothing, so it is what someone gets if they never
  // open the panel.
  format: ExportFormat.Png,
  // High enough that the difference is hard to see on a cut-out edge, low
  // enough to be worth choosing a lossy format for at all.
  quality: 0.92,
  background: WHITE,
}

export const isLossy = (format: ExportFormat): boolean => format !== ExportFormat.Png

/** JPEG has no alpha channel, so something has to be decided for it. */
export const needsBackground = (format: ExportFormat): boolean => format === ExportFormat.Jpeg

export const carriesAlpha = (format: ExportFormat): boolean => format !== ExportFormat.Jpeg

/**
 * Quality and background survive a format change.
 *
 * Someone who turned the quality down, looked at JPEG, and came back to WebP
 * did not mean to undo it.
 */
export const withFormat = (settings: ExportSettings, format: ExportFormat): ExportSettings => ({
  ...settings,
  format,
})

export const withQuality = (settings: ExportSettings, quality: number): ExportSettings =>
  Number.isFinite(quality) ? { ...settings, quality: Math.min(1, Math.max(0, quality)) } : settings

export const withBackground = (settings: ExportSettings, background: Rgb): ExportSettings => ({
  ...settings,
  background,
})

export const BACKGROUND_PRESETS: readonly { readonly label: string; readonly rgb: Rgb }[] = [
  { label: '白', rgb: WHITE },
  { label: '黒', rgb: BLACK },
  { label: 'グレー', rgb: { r: 128, g: 128, b: 128 } },
]

/** `#rrggbb`, for a CSS colour and for the native colour picker. */
export const toHex = (rgb: Rgb): string =>
  `#${[rgb.r, rgb.g, rgb.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`

/** Parses `#rrggbb`. Anything else leaves the colour alone. */
export const fromHex = (hex: string, fallback: Rgb): Rgb => {
  const match = /^#([\da-f]{6})$/i.exec(hex)
  if (match === null) return fallback
  const value = Number.parseInt(match[1] ?? '', 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}
